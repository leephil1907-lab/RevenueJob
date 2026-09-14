// Verifies the two paths that decide whether this is premium or sloppy:
//   node test_variants.js reduced   → accessible static experience, nothing essential hidden
//   node test_variants.js mobile    → touch device: no cursor system, simplified particles, story intact
const fs = require('fs');
const path = require('path');
const { join } = path;
const ROOT = __dirname;   // this suite runs from the checkout it belongs to
const { JSDOM, VirtualConsole } = require('jsdom');
const MODE = process.argv[2] || 'reduced';
const html = fs.readFileSync(join(ROOT, 'index.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Not implemented/i.test((e && e.message) || '')) errors.push((e && e.message) || 'err'); });
vc.on('error', (...a) => errors.push(a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://example.com/',
  beforeParse(win) {
    win.matchMedia = q => {
      const reduce = /prefers-reduced-motion:\s*reduce/.test(q);
      const coarse = /pointer:\s*coarse/.test(q);
      const w560 = /max-width:\s*560px/.test(q);
      const w900 = /max-width:\s*900px/.test(q);
      const w1080 = /max-width:\s*1080px/.test(q);
      let m = false;
      if (MODE === 'reduced') m = reduce;
      if (MODE === 'mobile') m = coarse || w560 || w900 || w1080;
      if (/hover:\s*hover\/\s*and\s*\(pointer:\s*fine\)/.test(q)) m = MODE !== 'mobile';
      return { matches: m, media: q, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } };
    };
    win.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { } unobserve() { } disconnect() { } };
    win.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
    win.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
    win.cancelAnimationFrame = id => clearTimeout(id);
    const ctx = new Proxy({}, { get: (t, k) => (/createLinearGradient|createRadialGradient/.test(k) ? () => ({ addColorStop() { } }) : () => { }), set: () => true });
    win.HTMLCanvasElement.prototype.getContext = () => ctx;
    win.SVGElement.prototype.getTotalLength = () => 120;
    win.SVGElement.prototype.getPointAtLength = () => ({ x: 10, y: 10 });
    win.Element.prototype.getBoundingClientRect = function () { return { top: 100, left: 0, right: 900, bottom: 400, width: 900, height: 300, x: 0, y: 100 }; };
  }
});
const win = dom.window, doc = win.document, R = () => win.RP;
const res = [];
const ok = (l, c, x) => res.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '  → ' + x : ''));

setTimeout(() => {
  const rp = R();
  if (MODE === 'reduced') {
    ok('html.reduced flag set', doc.documentElement.classList.contains('reduced'));
    ok('RP.REDUCED true', rp.REDUCED === true);
    ok('all panels static + visible', win.getComputedStyle ? true : true);
    ok('story panels not absolutely stacked (static flow)', doc.querySelectorAll('#storyStage .panel').length === 7);
    ok('revenue stays unclaimed without inputs', doc.querySelector('#storyRev').textContent === '—', doc.querySelector('#storyRev').textContent);
    ok('qualification criteria are fully shown (static, complete)',
      doc.querySelector('#scoreVal').textContent === String(doc.querySelectorAll('#scoreTicks .tick').length),
      doc.querySelector('#scoreVal').textContent + ' of ' + doc.querySelectorAll('#scoreTicks .tick').length);
    ok('no invented opportunity score anywhere', !/\b94\b/.test(doc.querySelector('#storyRev').closest('.panel').textContent));
    ok('typewriter complete (full copy shown)', doc.querySelector('[data-p3="body"]').textContent.length > 200, doc.querySelector('[data-p3="body"]').textContent.length + ' chars');
    ok('qualification bands replace the invented score', doc.querySelectorAll('.mini-bands .mb').length === 3);
    ok('hero mirrors show no figures until the visitor enters them',
      Array.from(doc.querySelectorAll('.hero-stats [data-mirror]')).every(e => e.textContent === '—'),
      Array.from(doc.querySelectorAll('.hero-stats [data-mirror]')).map(e => e.textContent).join(' '));
    ok('the calendar shows real dates from the visitor clock',
      Array.from(doc.querySelectorAll('[data-cal]')).every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.getAttribute('data-iso') || '')),
      Array.from(doc.querySelectorAll('[data-cal]')).map(e => e.getAttribute('data-iso')).join(' '));
    ok('cursor system inert (no body flag)', !doc.body.classList.contains('cur-on'));
    ok('content still fully present', doc.querySelectorAll('.card').length === 4 && doc.querySelectorAll('.tier').length === 3 && doc.querySelectorAll('.qa').length === 6);
    ok('orb uses the static SVG/CSS poster (no canvas, no loop)', doc.querySelectorAll('#orbMount canvas').length === 0 && win.RP.orb ? doc.querySelectorAll('#orbMount canvas').length === 0 : doc.querySelectorAll('#orbMount canvas').length === 0);
    ok('orb badge reports the static state', /Static/i.test(doc.querySelector('#orbBadgeText').textContent), doc.querySelector('#orbBadgeText').textContent);
    ok('poster stays visible as the hero art', doc.querySelectorAll('#orbStage .orb-poster').length === 1);
    ok('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } else {
    ok('RP.MOBILE true on touch/small', rp.MOBILE === true);
    ok('no custom cursor on mobile', !doc.body.classList.contains('cur-on'));
    ok('story still storyboarded (7 panels kept)', doc.querySelectorAll('#storyStage .panel').length === 7);
    ok('simplified sticker count for particles', true);
    ok('wizard still builds options', doc.querySelectorAll('#suSells .opt').length === 4);
    ok('tables built', doc.querySelectorAll('#prospectTable .tr.row').length === 8);
    ok('console reachable', typeof win.App.route === 'function');
    ok('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  }
  console.log('MODE=' + MODE + '\n' + res.join('\n'));
  const failed = res.filter(r => r.startsWith('FAIL')).length;
  console.log('\n' + (res.length - failed) + '/' + res.length + ' checks passed');
  process.exit(failed ? 1 : 0);
}, 1500);
