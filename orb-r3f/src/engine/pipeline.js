/**
 * RevenuePilot hero orb — pipeline geometry & flow rules.
 *
 * PURE MODULE: no three, no react, no DOM. Everything the orb does visually is
 * decided here, so the same rules can be unit-tested in node and shared with the
 * zero-dependency renderer in the single-file build.
 *
 * The model it encodes:  Prospects → Intelligence → Conversations → Opportunities → Revenue
 * Prospects enter at the outer boundary, data hops inward across the connection
 * graph, and the core (the AI) is where they converge. Qualified leads travel
 * back out. Nothing in the scene is decorative: every moving element is a
 * prospect, a data hop, or a qualified lead.
 */

/* Stage rings, outer → inner. Radius, brand colour, node budget per stage. */
export const STAGES = [
  { key: 'Prospects', r: 5.55, hex: '#6fa8ff', rgb: [111 / 255, 168 / 255, 255 / 255], count: 210 },
  { key: 'Intelligence', r: 4.80, hex: '#8a6bff', rgb: [138 / 255, 107 / 255, 255 / 255], count: 170 },
  { key: 'Conversations', r: 4.05, hex: '#5ae7ff', rgb: [90 / 255, 231 / 255, 255 / 255], count: 150 },
  { key: 'Opportunities', r: 3.30, hex: '#46e3a4', rgb: [70 / 255, 227 / 255, 164 / 255], count: 120 },
  { key: 'Revenue', r: 2.55, hex: '#eafcff', rgb: [234 / 255, 252 / 255, 255 / 255], count: 90 }
];

export const CORE_R = 1.25;        // the AI core
export const REV_R = 6.35;         // boundary where prospects enter the system
export const SHELL_R = 6.9;        // dark translucent containment sphere
export const ABSORB_R = 3.2;       // a pulse inside this radius has reached the core

/* Each stage ring sits in its own slightly tilted plane. Flat concentric circles
   read as a diagram; tilted orbital planes read as a volume — and they let the
   connections cross in three dimensions, which is what makes the system look
   built rather than drawn. Tilts stay small so the rings remain legible as an
   ordered pipeline and never collapse into the core. */
export const RING_TILT = [6, 14, 22, 30, 38];
export const RING_SPIN = [0, 26, 52, 78, 104];

const DEG = Math.PI / 180;

/* Local ring coordinates → world, for a given stage. */
export function ringPoint(stageIndex, angle, radius) {
  const r = radius === undefined ? STAGES[stageIndex].r : radius;
  const x0 = Math.cos(angle) * r, z0 = Math.sin(angle) * r;
  const tilt = RING_TILT[stageIndex] * DEG, spin = RING_SPIN[stageIndex] * DEG;
  /* tilt about X, then spin about Y */
  const y1 = -z0 * Math.sin(tilt);
  const z1 = z0 * Math.cos(tilt);
  return {
    x: x0 * Math.cos(spin) + z1 * Math.sin(spin),
    y: y1,
    z: -x0 * Math.sin(spin) + z1 * Math.cos(spin)
  };
}

/* Outward normal of a stage's plane — used to give nodes a little thickness. */
export function ringNormal(stageIndex) {
  const tilt = RING_TILT[stageIndex] * DEG, spin = RING_SPIN[stageIndex] * DEG;
  const ny = Math.cos(tilt), nz = Math.sin(tilt);
  return {
    x: nz * Math.sin(spin),
    y: ny,
    z: nz * Math.cos(spin)
  };
}

/* Budgets — mobile gets a deliberately smaller system, not a shrunk one. */
export const BUDGET = {
  desktop: { dust: 2400, edgesPerPair: 64, skipEdges: 60, pulseSlots: 26 },
  mobile:  { dust: 900,  edgesPerPair: 24, skipEdges: 22, pulseSlots: 14 }
};

/* Deterministic RNG so the layout is stable across reloads and testable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerp(a, b, t) { return a + (b - a) * t; }

/* A node on a stage ring: evenly spread by index, jittered in-plane and slightly
   off-plane so the ring has depth without looking scattered. */
export function ringNode(stageIndex, i, n, rnd) {
  const st = STAGES[stageIndex];
  const a = (i / n) * Math.PI * 2 + rnd() * 0.09;
  const r = st.r + (rnd() - 0.5) * 0.42;
  const base = ringPoint(stageIndex, a, r);
  const nrm = ringNormal(stageIndex);
  const off = (rnd() - 0.5) * 0.34;
  const x = base.x + nrm.x * off, y = base.y + nrm.y * off, z = base.z + nrm.z * off;
  return {
    x, y, z,
    r: Math.sqrt(x * x + y * y + z * z),
    stage: stageIndex,
    color: st.rgb,
    angle: a
  };
}

/**
 * Build the whole system: nodes, connections, dust and long-range links.
 * Returns plain arrays — the renderer only ever uploads them to buffers.
 */
export function buildGraph({ mobile = false, seed = 20240914 } = {}) {
  const rnd = mulberry32(seed);
  const budget = mobile ? BUDGET.mobile : BUDGET.desktop;

  /* ---- nodes: every stage ring ---- */
  const nodes = [];
  STAGES.forEach((st, si) => {
    const n = mobile ? Math.round(st.count * 0.45) : st.count;
    for (let i = 0; i < n; i++) nodes.push(ringNode(si, i, n, rnd));
  });

  /* ---- connections: stage → next stage inward, which is the meaning of the scene ---- */
  const edges = [];
  const byStage = STAGES.map((_, si) => nodes.filter(n => n.stage === si));

  for (let si = 0; si < STAGES.length - 1; si++) {
    const outer = byStage[si], inner = byStage[si + 1];
    for (let k = 0; k < budget.edgesPerPair; k++) {
      const a = outer[Math.floor(rnd() * outer.length)];
      /* prefer the angularly nearest inner node — connections look engineered, not random */
      let b = inner[0], best = Infinity;
      for (let t = 0; t < 6; t++) {
        const c = inner[Math.floor(rnd() * inner.length)];
        const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; b = c; }
      }
      edges.push(makeEdge(a, b));
    }
  }

  /* ---- long-range links: prospects that skip straight toward the core ---- */
  const outermost = byStage[0], revenue = byStage[STAGES.length - 1];
  for (let k = 0; k < budget.skipEdges; k++) {
    const a = outermost[Math.floor(rnd() * outermost.length)];
    const b = revenue[Math.floor(rnd() * revenue.length)];
    const e = makeEdge(a, b);
    e.skip = true;
    edges.push(e);
  }

  /* ---- dust: the thousands of subtle particles on the containment shell ---- */
  const dust = new Float32Array(budget.dust * 4);
  const rnd2 = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0; i < budget.dust; i++) {
    const u = rnd2() * 2 - 1;
    const th = rnd2() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = SHELL_R * (0.72 + rnd2() * 0.26);
    dust[i * 4] = Math.cos(th) * s * r;
    dust[i * 4 + 1] = u * r * 0.72;
    dust[i * 4 + 2] = Math.sin(th) * s * r;
    dust[i * 4 + 3] = 0.35 + rnd2() * 0.65;    // size factor
  }

  return { nodes, edges, dust, budget };
}

function makeEdge(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
  return {
    a: [a.x, a.y, a.z],
    b: [b.x, b.y, b.z],
    mid: [mx, my, mz],
    rMid: Math.sqrt(mx * mx + my * my + mz * mz),
    stage: a.stage,
    skip: false
  };
}

/* Point along an edge, 0 = start, 1 = end. `rev` walks the edge backwards. */
export function edgePoint(edge, t, rev = false) {
  const u = rev ? 1 - t : t;
  /* keyed on u, not on rev: rev merely walks t backwards, so u=0 is always the
     segment's start point for the direction of travel. */
  if (u <= 0) return edge.a.slice();
  if (u >= 1) return edge.b.slice();
  const p = edge.a, q = edge.b;
  return [lerp(p[0], q[0], u), lerp(p[1], q[1], u), lerp(p[2], q[2], u)];
}

/**
 * Pick the next connection for a pulse that has finished its current one.
 *
 * Flow rule: data converges. Candidates must take the pulse INWARD (their
 * midpoint radius must be smaller than where the pulse is now); ties break on
 * distance. This is what makes the graph read as a pipeline rather than
 * random sparkle — pulses always drift toward the AI core.
 *
 * Returns { index, reverse } or null when nothing better exists (the caller then
 * feeds the pulse into the core).
 */
export function nextHop(p, edges, excludeIndex = -1, { maxDist = 2.6, inwardBias = 1.35 } = {}) {
  const here = Math.hypot(p[0], p[1], p[2]);
  /* Pass 1: candidates that take the pulse strictly inward. Pass 2 (only if the
     pulse is stranded) tolerates outward drift, penalised by inwardBias. This is
     what makes the flow legible: data visibly converges on the core. */
  let best = null, bestScore = Infinity, fallback = null, fallbackScore = Infinity;
  for (let i = 0; i < edges.length; i++) {
    if (i === excludeIndex) continue;
    const e = edges[i];
    const dx = e.mid[0] - p[0], dy = e.mid[1] - p[1], dz = e.mid[2] - p[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxDist) continue;
    const dA = Math.hypot(e.a[0] - p[0], e.a[1] - p[1], e.a[2] - p[2]);
    const dB = Math.hypot(e.b[0] - p[0], e.b[1] - p[1], e.b[2] - p[2]);
    if (e.rMid <= here) {
      if (d < bestScore) { bestScore = d; best = { index: i, reverse: dB < dA, score: d }; }
    } else {
      const penalised = d * inwardBias;
      if (penalised < fallbackScore) {
        fallbackScore = penalised;
        fallback = { index: i, reverse: dB < dA, score: penalised };
      }
    }
  }
  return best || fallback;
}

/* Pulse pool entry. dir 'in' = converging on the core, 'out' = qualified lead. */
export function makePulse(dir, rnd = Math.random) {
  return {
    edge: -1, t: 0, rev: false,
    sp: dir === 'out' ? 0.0055 + rnd() * 0.004 : 0.006 + rnd() * 0.008,
    hops: 1 + Math.floor(rnd() * 3),
    dir,
    born: 0
  };
}

/* Colour a pulse by how far it has come. Inbound warms from indigo toward cyan. */
export function pulseColor(dir, progress) {
  if (dir === 'out') return [0.35, 0.98, 0.72];            // qualified lead — green
  const a = [0.42, 0.55, 1.0], b = [0.35, 0.95, 1.0];      // indigo → cyan
  return [lerp(a[0], b[0], progress), lerp(a[1], b[1], progress), lerp(a[2], b[2], progress)];
}

/* How many edges actually take a pulse inward from a given radius — sanity metric. */
export function inwardEdges(edges, radius) {
  return edges.filter(e => e.rMid < radius).length;
}
