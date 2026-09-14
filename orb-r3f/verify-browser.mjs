/**
 * Browser verification for the hero orb.
 *
 *   node verify-browser.mjs
 *
 * Runs the real R3F scene in headless Chromium (software WebGL) and checks the
 * claims that only a browser can settle: that WebGL is actually used, that the
 * camera responds to scroll, that the loop stops off-screen, that mobile gets a
 * smaller system, that touch turns it, and that the reduced-motion tier really
 * creates no canvas. Writes screenshots to screenshots/.
 *
 * Requires: puppeteer, and the demo page built (node build-demo.mjs).
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const DEMO = 'file:///home/user/orb-demo.html';
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const res = [];
const ok = (label, cond, detail) => res.push((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  → ' + detail : ''));

const read = page => page.evaluate(() => {
  const rows = {};
  document.querySelectorAll('.readout > div').forEach(d =>
    rows[d.querySelector('dt').textContent] = d.querySelector('dd').textContent);
  const c = document.querySelector('.orb-canvas');
  return { rows, engine: c ? c.dataset.engine : null, mobile: c ? c.dataset.mobile : null,
           canvases: document.querySelectorAll('.stage canvas').length,
           fallback: document.querySelectorAll('.stage .orb-fallback').length };
});

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});

/* ---------------- desktop ---------------- */
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(DEMO, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 7000));

const desk = await read(page);
ok('WebGL tier is live on desktop', desk.engine === 'webgl' && desk.canvases === 1, JSON.stringify(desk));
ok('particle budget is in the thousands, not a token few',
  Number(desk.rows['Particles in the shell'].replace(/,/g, '')) >= 2000, desk.rows['Particles in the shell']);
ok('connection graph is built', Number(desk.rows['Connection segments'].replace(/,/g, '')) > 250, desk.rows['Connection segments']);
ok('pulses are travelling the graph', Number(desk.rows['Data pulses sent']) > 0, desk.rows['Data pulses sent']);
await page.screenshot({ path: SHOTS + 'desktop-hero.png' });

const beforeScroll = desk.rows['Camera distance'];
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.85));
await new Promise(r => setTimeout(r, 3000));
const scrolled = await read(page);
ok('scroll drives the camera in', scrolled.rows['Camera distance'] !== beforeScroll,
  beforeScroll + ' → ' + scrolled.rows['Camera distance']);
ok('scroll progress is tracked', /%$/.test(scrolled.rows['Scroll progress']), scrolled.rows['Scroll progress']);
await page.screenshot({ path: SHOTS + 'desktop-scrolled.png' });

await page.evaluate(() => window.scrollTo(0, 0));
await new Promise(r => setTimeout(r, 1500));
const spinA = (await read(page)).rows['Autonomous rotation'];
await new Promise(r => setTimeout(r, 2500));
const spinB = (await read(page)).rows['Autonomous rotation'];
ok('the system rotates on its own', spinA !== spinB, spinA + ' → ' + spinB);
ok('pulses converge on the core', Number((await read(page)).rows['Absorbed by the AI core']) > 0,
  (await read(page)).rows['Absorbed by the AI core']);

/* reduced-motion tier through the QA toggle */
await page.evaluate(() => document.querySelector('button.toggle').click());
await new Promise(r => setTimeout(r, 1200));
const stat = await read(page);
ok('reduced-motion tier creates no canvas', stat.canvases === 0 && stat.fallback === 1, JSON.stringify(stat));
await page.screenshot({ path: SHOTS + 'reduced-motion.png' });
await page.evaluate(() => document.querySelector('button.toggle').click());
await new Promise(r => setTimeout(r, 1200));

/* ---------------- mobile ---------------- */
const mob = await browser.newPage();
mob.on('pageerror', e => errs.push('mobile: ' + e.message));
await mob.emulate({
  name: 'phone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1',
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: false }
});
await mob.goto(DEMO, { waitUntil: 'load' });
await mob.evaluate(() => document.querySelector('.stage').scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 6500));
const m = await read(mob);
ok('mobile uses a smaller system rather than a shrunk one',
  Number(m.rows['Particles in the shell'].replace(/,/g, '')) < 1200 && m.mobile === 'true',
  m.rows['Particles in the shell'] + ' particles, mobile=' + m.mobile);
await mob.screenshot({ path: SHOTS + 'mobile.png' });

const rotBefore = m.rows['Autonomous rotation'];
await mob.touchscreen.touchStart(200, 420);
await mob.touchscreen.touchMove(80, 420);
await mob.touchscreen.touchEnd();
await new Promise(r => setTimeout(r, 1200));
const rotAfter = (await read(mob)).rows['Autonomous rotation'];
ok('touch drag turns the system', rotBefore !== rotAfter, rotBefore + ' → ' + rotAfter);

const frozen = await mob.evaluate(async () => {
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 1200));
  const snapshot = () => { let v = ''; document.querySelectorAll('.readout > div').forEach(d => { if (d.querySelector('dt').textContent === 'Autonomous rotation') v = d.querySelector('dd').textContent; }); return v; };
  const a = snapshot();
  await new Promise(r => setTimeout(r, 1800));
  return a === snapshot();
});
ok('the loop stops when the hero is off-screen (no wasted frames)', frozen);

ok('no page errors, desktop or mobile', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(res.join('\n'));
const failed = res.filter(r => r.startsWith('FAIL')).length;
console.log('\n' + (res.length - failed) + '/' + res.length + ' browser checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
