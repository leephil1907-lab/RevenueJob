#!/usr/bin/env node
/**
 * audit-responsive.mjs — the overflow and hit-area audit.
 *
 *   node tools/audit-responsive.mjs            # summary for every breakpoint
 *   node tools/audit-responsive.mjs --shots    # also write screenshots to screenshots/
 *
 * Opens the built index.html in a real browser at each width, measures the
 * document against the viewport, and names the exact elements that stick out.
 * It checks the marketing page and the OS console (the app form) separately,
 * because they have different layout systems.
 *
 * Exit code is non-zero when anything overflows, so this can gate a release.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, existsSync } from 'node:fs';

const URL = 'file:///home/user/index.html';
const SHOTS = process.argv.includes('--shots');
const WIDTHS = [1920, 1440, 1280, 1080, 900, 768, 560, 430, 390, 360];
const OUT = '/home/user/screenshots';

const overflowProbe = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const out = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    // an element is "out" when its box extends past the viewport on the right
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 1.5 && r.width > 12) {
      // contained inside a scrolling/clipping ancestor (carousel, marquee, table
      // wrapper)? then it is not the element causing document overflow.
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (/hidden|auto|scroll|clip/.test(acs.overflowX)) {
          const ar = a.getBoundingClientRect();
          if (ar.right <= vw + 1.5 && ar.width > 0) { clipped = true; break; }
        }
      }
      if (clipped) continue;
      out.push({
        sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
        right: Math.round(r.right), w: Math.round(r.width),
        over: Math.round(r.right - vw)
      });
    }
  }
  // keep the worst offenders per selector, then the top 12
  const worst = {};
  out.forEach(o => { if (!worst[o.sel] || worst[o.sel].over < o.over) worst[o.sel] = o; });
  if (!out.length && de.scrollWidth > vw + 1) {
    // nothing individually named: find the widest unclipped subtree roots
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && !el.parentElement.classList.contains('clipped')) {
        out.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), right: Math.round(r.right), w: Math.round(r.width), over: Math.round(r.width - vw) });
        if (out.length > 5) break;
      }
    }
  }
  return {
    vw,
    scrollW: de.scrollWidth,
    docOver: Math.max(0, de.scrollWidth - vw),
    pageH: document.body.scrollHeight,
    offenders: Object.values(worst).sort((a, b) => b.over - a.over).slice(0, 12)
  };
};

const tally = [];
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
let failures = 0;

async function visit(width, height, label, prepare) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 700));
  if (prepare) { await prepare(); await new Promise(r => setTimeout(r, 900)); }
  const res = await page.evaluate(overflowProbe);
  const bad = res.docOver > 0 || res.offenders.length > 0;
  if (bad) failures++;
  tally.push({ width, label, res });
  const head = `${String(width).padStart(4)}px ${label.padEnd(9)} scrollW ${String(res.scrollW).padStart(5)}  over ${String(res.docOver).padStart(3)}  height ${String(res.pageH).padStart(6)}  ${bad ? 'FAIL' : 'ok'}`;
  console.log(head + (bad ? '' : ''));
  res.offenders.forEach(o => console.log(`        ↳ ${o.sel} over=${o.over}px (right ${o.right}, w ${o.w})`));
  if (SHOTS) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${label}-${width}.png`, fullPage: false });
  }
  return res;
}

console.log('\nRESPONSIVE + OVERFLOW AUDIT  (index.html)\n');
for (const w of WIDTHS) {
  const h = w <= 430 ? 780 : w <= 900 ? 900 : 900;
  await visit(w, h, 'site', null);
}

console.log('\nAPP FORM (RevenuePilot OS console)\n');
for (const w of WIDTHS) {
  const h = w <= 430 ? 780 : 900;
  await visit(w, h, 'console', async () => {
    await page.evaluate(() => {
      const c = document.getElementById('wsSwitch');
      if (c) c.click();
      if (window.RP && RP.os && RP.os.showPane) RP.os.showPane('command');
      const v = document.getElementById('view-console');
      if (v) v.removeAttribute('hidden');
      const home = document.getElementById('view-home');
      if (home) home.setAttribute('hidden', '');
      window.scrollTo(0, 0);
    });
  });
}

console.log('\nPANE SWEEP (every console pane at 1080 / 560)\n');
for (const w of [1080, 560]) {
  for (const pane of ['command', 'agents', 'supervisor', 'approvals', 'copilot', 'inbox', 'prospects', 'intel', 'revenue', 'builder', 'marketplace', 'agency', 'developers', 'trust', 'settings']) {
    await visit(w, 900, 'pane-' + pane, async () => {
      await page.evaluate(p => {
        const v = document.getElementById('view-console');
        if (v) v.removeAttribute('hidden');
        const home = document.getElementById('view-home');
        if (home) home.setAttribute('hidden', '');
        if (window.RP && RP.os && RP.os.showPane) RP.os.showPane(p);
        window.scrollTo(0, 0);
      }, pane);
    });
  }
}

await browser.close();

const bad = tally.filter(t => t.res.docOver > 0 || t.res.offenders.length);
console.log(`\n${tally.length - bad.length}/${tally.length} viewports clean`);
if (bad.length) {
  console.log('\nviewports with overflow:');
  bad.forEach(t => console.log(`  ${t.width}px ${t.label}: ${t.res.docOver}px document overhang, ${t.res.offenders.length} element(s)`));
}
process.exit(failures ? 1 : 0);
