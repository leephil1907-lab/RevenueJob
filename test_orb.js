// Orb contract: lazy loading, the instant first paint, the fallback ladder, and
// the hand-off to the compiled R3F scene. Each environment gets its own JSDOM
// with stubs, then one shared reporter.
const fs = require('fs');
const path = require('path');
const { join } = path;
const ROOT = __dirname;   // this suite runs from the checkout it belongs to
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(join(ROOT, 'index.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = (e && e.message) || '';
  if (!/Not implemented/i.test(m)) errors.push(m);
});

const ctxProxy = new Proxy({}, {
  get: (t, k) => (/createLinearGradient|createRadialGradient/.test(k)
    ? () => ({ addColorStop() { } })
    : () => { }),
  set: () => true
});

/**
 * Boot the real page in a simulated environment.
 * opts: { reduced, webgl, twoD, host, canvas }
 */
function boot(opts = {}) {
  const env = {
    reduced: !!opts.reduced,
    webgl: opts.webgl !== false,
    twoD: opts.twoD !== false,
    host: opts.host || null
  };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'https://example.com/',
    beforeParse(win) {
      win.matchMedia = q => ({
        matches: /reduced-motion/.test(q) ? env.reduced : false,
        media: q, addListener() { }, removeListener() { },
        addEventListener() { }, removeEventListener() { }
      });
      win.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { } unobserve() { } disconnect() { } };
      win.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
      win.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
      win.cancelAnimationFrame = id => clearTimeout(id);
      win.requestIdleCallback = cb => setTimeout(() => cb({ didTimeout: false }), 20);
      win.HTMLCanvasElement.prototype.getContext = (kind) => {
        if (/webgl/i.test(kind)) return env.webgl ? {} : null;
        return env.twoD ? ctxProxy : null;
      };
      win.SVGElement.prototype.getTotalLength = () => 120;
      win.SVGElement.prototype.getPointAtLength = () => ({ x: 1, y: 1 });
      win.Element.prototype.getBoundingClientRect = () =>
        ({ top: 100, left: 0, right: 900, bottom: 400, width: 900, height: 300, x: 0, y: 100 });
      if (env.webgl) win.WebGLRenderingContext = function () { };
      /* a host app (the Next.js build) can register the compiled React scene */
      win.__hostCalls = [];
      if (opts.host) {
        win.RevenuePilotOrb = {
          mount(el, o) { win.__hostCalls.push({ id: el.id, opts: o || {} }); return { unmount() { } }; }
        };
      }
    }
  });
  return new Promise(resolve => setTimeout(() => resolve(dom), 600));
}

const res = [];
const ok = (l, c, x) => res.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '  → ' + x : ''));
const badgeOf = d => d.window.document.querySelector('#orbBadgeText').textContent;
const diag = d => 'engine=' + d.window.OrbEngine.state.engine +
  ' badge="' + badgeOf(d) + '" canvases=' + d.window.document.querySelectorAll('#orbMount canvas').length +
  ' err=' + String(d.window.OrbEngine.state.lastError).slice(0, 90);

(async () => {
  /* ---------- 1. normal environment: lazy upgrade, instant first paint ---------- */
  const std = await boot();
  const doc = std.window.document;
  ok('lite renderer mounted immediately', doc.querySelectorAll('#orbMount canvas.lite').length === 1, diag(std));
  ok('hero never blocked on network (site is initialised)', !!std.window.RP && !!std.window.RP.os);
  const scripts = Array.from(doc.querySelectorAll('script[src]')).map(s => s.src);
  ok('three.js is lazy-loaded from a CDN, not bundled',
    scripts.some(s => /three(\.min)?\.js/.test(s)), scripts.join(' | ').slice(0, 120) || 'none yet');
  ok('bundle contains no vendored three.js', html.length < 700000 && !/THREE\.REVISION/.test(html));
  ok('badge names the renderer that is actually running', /Lite|WebGL/.test(badgeOf(std)), diag(std));
  ok('stage labels present for either renderer', doc.querySelectorAll('#orbStage .orb-label').length === 5);
  ok('orb ticker carries no fabricated figure', /Idle|your inputs|—/.test(doc.querySelector('.orb-ticker').textContent),
    doc.querySelector('.orb-ticker').textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
  ok('poster retires only once a live canvas took over', doc.querySelector('#orbStage').classList.contains('orb-live'));
  ok('graph connections exist for pulses to ride', std.window.OrbEngine.state.stats.chords >= 16, diag(std));
  ok('engine exposes a mount point for a host app', typeof std.window.OrbEngine.hostMount === 'function');

  /* ---------- 2. host hand-off: compiled R3F scene takes the stage ---------- */
  const hosted = await boot({ host: true });
  const calls = hosted.window.__hostCalls || [];
  ok('host scene is mounted into the hero stage', calls.length === 1 && calls[0].id === 'orbMount',
    JSON.stringify(calls.map(c => c.id)));
  ok('host receives the device profile it needs to scope itself',
    calls.length === 1 && typeof calls[0].opts.mobile === 'boolean' && typeof calls[0].opts.reduced === 'boolean',
    JSON.stringify(calls[0] ? calls[0].opts : {}));
  ok('engine reports the R3F path when the host takes over',
    hosted.window.OrbEngine.state.engine === 'r3f', String(hosted.window.OrbEngine.state.engine));
  ok('the vanilla renderer stands down (no competing canvas)',
    hosted.window.document.querySelectorAll('#orbMount canvas.lite').length === 0);
  ok('poster still retires so the host scene is visible',
    hosted.window.document.querySelector('#orbStage').classList.contains('orb-live'));

  /* ---------- 3. reduced motion: no WebGL, no loop, static tier ---------- */
  const reduced = await boot({ reduced: true });
  ok('reduced motion creates no canvas at all',
    reduced.window.document.querySelectorAll('#orbMount canvas').length === 0);
  ok('reduced motion never requests three.js',
    !Array.from(reduced.window.document.querySelectorAll('script[src]')).some(s => /three/.test(s.src)));
  ok('badge states the static tier', /Static/.test(badgeOf(reduced)), badgeOf(reduced));
  ok('the inline SVG poster remains the hero art',
    reduced.window.document.querySelectorAll('#orbStage .orb-poster').length === 1);
  ok('page is fully initialised under reduced motion',
    !!reduced.window.RP && !!reduced.window.RP.os);

  /* ---------- 4. reduced motion + host: SVG comes from the host component ---------- */
  const reducedHosted = await boot({ reduced: true, host: true });
  const rh = reducedHosted.window.__hostCalls || [];
  ok('reduced motion still hands off (host renders the SVG)',
    rh.length === 1 && rh[0].opts.reduced === true, JSON.stringify(rh));
  ok('host is told to scope itself for reduced motion',
    rh.length === 1 && rh[0].opts.reduced === true);

  /* ---------- 5. no 2D canvas: the poster stands, nothing blank is left ---------- */
  const no2d = await boot({ twoD: false });
  ok('no 2D context → engine falls back to the poster',
    no2d.window.OrbEngine.state.engine === 'poster', String(no2d.window.OrbEngine.state.engine));
  ok('no empty canvas is left in the hero stage',
    no2d.window.document.querySelectorAll('#orbMount canvas').length === 0);
  ok('the rest of the page still initialises without 2D canvas',
    !!no2d.window.RP && !!no2d.window.RP.os);
  ok('fallback badge states it plainly', /Static/.test(badgeOf(no2d)), badgeOf(no2d));

  /* ---------- 6. sanity ---------- */
  ok('no runtime errors in any environment', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log(res.join('\n'));
  const failed = res.filter(r => r.startsWith('FAIL')).length;
  console.log('\n' + (res.length - failed) + '/' + res.length + ' checks passed');
  process.exit(failed ? 1 : 0);
})();
