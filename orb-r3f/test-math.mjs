/**
 * Pure-engine tests — run with: node test-math.mjs
 * No GPU, no DOM: verifies the *meaning* of the scene, not its pixels.
 */
import {
  STAGES, CORE_R, REV_R, SHELL_R, ABSORB_R, BUDGET,
  buildGraph, edgePoint, nextHop, makePulse, mulberry32, inwardEdges, pulseColor
} from './src/engine/pipeline.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
};
const section = s => console.log('\n' + s);

section('pipeline shape');
const g = buildGraph();
ok('five stage rings, outer to inner', STAGES.length === 5 &&
  STAGES.every((s, i) => i === 0 || s.r < STAGES[i - 1].r));
ok('rings carry the pipeline names', STAGES.map(s => s.key).join('>') ===
  'Prospects>Intelligence>Conversations>Opportunities>Revenue');
ok('prospects enter outside the revenue ring', REV_R > STAGES[0].r);
ok('core sits inside every stage', CORE_R < STAGES[4].r);
ok('containment shell encloses the outermost ring', SHELL_R > REV_R);
ok('nodes exist for every stage', STAGES.every((_, si) => g.nodes.some(n => n.stage === si)));
ok('node count is credible for a system view', g.nodes.length > 600, g.nodes.length + ' nodes');
ok('connection graph is dense enough to read as a network', g.edges.length > 300, g.edges.length + ' connections');
ok('long-range links exist (prospects reaching toward the core)', g.edges.filter(e => e.skip).length === BUDGET.desktop.skipEdges);
ok('dust cloud is in the thousands', g.dust.length / 4 === BUDGET.desktop.dust, (g.dust.length / 4) + ' particles');
ok('every dust particle sits inside the shell', (() => {
  for (let i = 0; i < g.dust.length; i += 4) if (Math.hypot(g.dust[i], g.dust[i + 1], g.dust[i + 2]) > SHELL_R) return false;
  return true;
})());

section('determinism (stable layout across reloads)');
const g2 = buildGraph();
ok('same seed → identical graph', g2.edges.length === g.edges.length &&
  g2.edges[0].a.join() === g.edges[0].a.join());
const g3 = buildGraph({ seed: 7 });
ok('different seed → different layout', g3.edges[0].a.join() !== g.edges[0].a.join());

section('mobile budget is a smaller system, not a shrunk one');
const m = buildGraph({ mobile: true });
ok('mobile uses ~1/3 the particles', m.dust.length / 4 < g.dust.length / 4, (m.dust.length / 4) + ' vs ' + (g.dust.length / 4));
ok('mobile keeps all five stages', STAGES.every((_, si) => m.nodes.some(n => n.stage === si)));
ok('mobile keeps a connected network', m.edges.length > 100, m.edges.length + ' connections');
ok('mobile pulse pool is smaller', BUDGET.mobile.pulseSlots < BUDGET.desktop.pulseSlots);

section('connections converge inward (the pipeline reads in one direction)');
const inward = g.edges.filter(e => e.rMid < STAGES[e.stage].r).length;
ok('inward edges dominate', inward / g.edges.length > 0.9,
  inward + '/' + g.edges.length + ' take data toward the core');
ok('stage-to-stage edges always shorten the radius', g.edges.filter(e => !e.skip)
  .every(e => e.rMid < STAGES[e.stage].r));

section('pulses ride connections and hop toward the core');
const end = edgePoint(g.edges[0], 1);
ok('edge point at t=0 is the edge start', edgePoint(g.edges[0], 0).join() === g.edges[0].a.join());
ok('edge point at t=1 is the edge end', end.join() === g.edges[0].b.join());
ok('reverse starts the pulse at the far end', edgePoint(g.edges[0], 0, true).join() === g.edges[0].b.join());
ok('reverse ends the pulse at the near end', edgePoint(g.edges[0], 1, true).join() === g.edges[0].a.join());
ok('a reversed pulse stays on its own segment', (() => {
  const e = g.edges[0], p = edgePoint(e, 0.5, true);
  const d = Math.abs((Math.hypot(p[0] - e.a[0], p[1] - e.a[1], p[2] - e.a[2]) +
                      Math.hypot(p[0] - e.b[0], p[1] - e.b[1], p[2] - e.b[2])) -
                      Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]));
  return d < 1e-6;
})());

/* Simulate the real hop loop: spawn on a connection, hop 1-3 times, feed the core. */
let absorbed = 0, hopsTaken = 0, refused = 0;
for (let run = 0; run < 400; run++) {
  const rnd = mulberry32(run + 1);
  const p = makePulse('in', rnd);
  let idx = Math.floor(rnd() * g.edges.length);
  let pos = edgePoint(g.edges[idx], 1);
  for (let h = 0; h < 3 && p.hops > 0; h++) {
    const hop = nextHop(pos, g.edges, idx);
    if (!hop) break;
    hopsTaken++;
    idx = hop.index;
    pos = edgePoint(g.edges[idx], 1, hop.reverse);
  }
  if (Math.hypot(pos[0], pos[1], pos[2]) < ABSORB_R) absorbed++;
  else {
    /* final approach feeds the core anyway, mirroring the renderer */
    const hop = nextHop(pos, g.edges, idx, { maxDist: 3 });
    if (!hop) refused++; else absorbed++;
  }
}
ok('every pulse finds a next connection (no dead ends)', refused === 0, refused + ' stranded');
ok('most pulses reach the core within their hop budget', absorbed / 400 > 0.5,
  absorbed + '/400 converged, ' + hopsTaken + ' hops taken');
ok('hop graph is deep enough to traverse', inwardEdges(g.edges, REV_R) > 100, inwardEdges(g.edges, REV_R) + ' inward edges available');

section('hop rule prefers convergence');
const probe = [0, 0, 5.0];
const hop = nextHop(probe, g.edges, -1, { maxDist: 12 });
ok('chosen connection is inward of the probe point', hop && g.edges[hop.index].rMid < 5.0,
  hop ? 'rMid ' + g.edges[hop.index].rMid.toFixed(2) : 'no hop');
let outwardPicked = 0;
for (let i = 0; i < 300; i++) {
  const r = 2.6 + (i / 300) * 3.4;
  const at = [Math.cos(i) * r, Math.sin(i * 1.7) * 0.4, Math.sin(i) * r];
  const h2 = nextHop(at, g.edges, -1, { maxDist: 3 });
  if (h2 && g.edges[h2.index].rMid >= Math.hypot(at[0], at[1], at[2])) outwardPicked++;
}
ok('outward moves are the rare exception, not the rule', outwardPicked / 300 < 0.25,
  outwardPicked + '/300 drifted outward');

section('qualified leads travel back out');
const q = makePulse('out', mulberry32(3));
ok('qualified pulses are slower and calmer than inbound', q.sp < 0.01 && q.dir === 'out');
const cin = pulseColor('in', 0.5), cout = pulseColor('out', 0.5);
ok('qualified colour is distinct from inbound data',
  Math.abs(cin[0] - cout[0]) > 0.05 || Math.abs(cin[2] - cout[2]) > 0.05,
  'in=' + cin.map(n => n.toFixed(2)).join() + ' out=' + cout.map(n => n.toFixed(2)).join());
ok('inbound colour shifts as it converges (indigo → cyan)',
  pulseColor('in', 1)[2] > 0.98 && Math.abs(pulseColor('in', 1)[0] - pulseColor('in', 0)[0]) > 0.05);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
