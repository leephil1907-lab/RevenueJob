#!/usr/bin/env node
/**
 * capture-product.mjs — photographs this software while it runs.
 *
 *   node tools/capture-product.mjs            # capture into assets/product/
 *   node tools/capture-product.mjs --keep     # keep the throwaway store for a look
 *
 * Every file under assets/product/ is a screenshot of the real product: the app
 * server and the admin console are started against a throwaway store, a
 * workspace is registered through the public API, the confirmation link is
 * followed, and then a person's whole journey is driven in a browser — signing
 * in on the form, opening a ticket, and answering it from the admin console.
 *
 * The account is "Your workspace" <owner@example.com> — example.com is reserved
 * for exactly this purpose — and the one message in the thread says what it is:
 * a ticket opened during the screenshot pass. No customer, no invented figure
 * and no made-up conversation appears in any of these images.
 *
 * Each capture is written twice, 1x and 2x, so a page can serve a crisp image on
 * a retina screen. assets/product/manifest.json records the sizes and the alt
 * text for every shot. Re-run this after a design change.
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(ROOT, 'assets', 'product');
const KEEP = process.argv.includes('--keep');
const EMAIL = 'owner@example.com';
const NAME = 'Your workspace';
const APP_PASS = 'capture-passphrase-42';
const ADMIN_PASS = 'capture-console-pass';
const SUBJECT = 'Product tour';
const QUESTION = 'Opened from the dashboard form during the screenshot pass.';
const ANSWER = 'Answered from the admin console during the same pass — this reply also goes out as email.';

const freePort = () => new Promise(resolve => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

const APP_PORT = await freePort();
const ADMIN_PORT = await freePort();
const DIR = mkdtempSync(join(tmpdir(), 'rp-capture-'));
const APP = `http://127.0.0.1:${APP_PORT}`;
const ADMIN = `http://127.0.0.1:${ADMIN_PORT}`;

const app = spawn(process.execPath, [join(ROOT, 'server', 'app.mjs')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1', RP_DATA_DIR: DIR, SESSION_PEPPER: 'capture-pepper-not-a-secret', PUBLIC_URL: APP }
});
const admin = spawn(process.execPath, [join(ROOT, 'admin', 'server.mjs')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(ADMIN_PORT), HOST: '127.0.0.1', RP_DATA_DIR: DIR, RP_ADMIN_STATE: join(DIR, 'admin-state.json'), RP_ADMIN_PASSWORD: ADMIN_PASS, PUBLIC_URL: APP }
});
const stop = () => {
  for (const p of [app, admin]) { try { p.kill('SIGTERM'); } catch (e) { /* gone */ } }
  if (!KEEP) rmSync(DIR, { recursive: true, force: true });
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

const ready = async (url, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { redirect: 'manual' }); if (r.status < 500) return true; } catch (e) { /* not yet */ }
    await sleep(200);
  }
  throw new Error('never came up: ' + url);
};
await ready(APP + '/health');
await ready(ADMIN + '/');

/* ── a real workspace, registered the way a person would ─────────────────── */
const post = async (path, body) => {
  const r = await fetch(APP + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
};
const reg = await post('/api/register', { name: NAME, email: EMAIL, password: APP_PASS });
if (reg.status !== 200) throw new Error('registration failed: ' + reg.body.slice(0, 120));

/* the confirmation link only exists in the mail this server queued */
const outboxDir = join(DIR, 'outbox');
let code = '';
for (let i = 0; i < 40 && !code; i++) {
  const names = readdirSync(outboxDir).filter(f => f.endsWith('.txt'));
  for (const n of names) {
    const found = (readFileSync(join(outboxDir, n), 'utf8').match(/code=([a-f0-9]{8,})/) || [])[1];
    if (found) { code = found; break; }
  }
  if (!code) await sleep(150);
}
if (!code) throw new Error('no confirmation link was queued');
const confirmed = await fetch(APP + '/api/verify?code=' + code, { redirect: 'manual' });
if (confirmed.status >= 400) throw new Error('confirmation link rejected: ' + confirmed.status);

/* ── photograph what the browser shows ───────────────────────────────────── */
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
page.on('pageerror', e => console.error('  page error: ' + e.message));

const shots = [];
const write = async (name, sel, alt) => {
  /* a card is captured by clipping the document at the card's own position:
     clipping does not scroll, so a sticky top bar can never print across it.
     No selector means the whole page. */
  let rect = null;
  if (sel) {
    const el = await page.$(sel);
    if (!el) { console.error('  skipped ' + name + ': no ' + sel); return; }
    rect = await el.evaluate(e => {
      const r = e.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    });
  }
  const size = rect
    ? { width: Math.round(rect.width), height: Math.round(rect.height) }
    : await page.evaluate(() => ({ width: 1440, height: Math.ceil(document.documentElement.scrollHeight) }));
  for (const [scale, suffix] of [[2, '@2x'], [1, '']]) {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: scale });
    await sleep(320);
    const path = join(OUT, name + suffix + '.webp');
    if (rect) await page.screenshot({ path, type: 'webp', quality: 90, clip: rect, captureBeyondViewport: true });
    else await page.screenshot({ path, type: 'webp', quality: 90, fullPage: true });
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  shots.push({ name, file: `assets/product/${name}.webp`, file2x: `assets/product/${name}@2x.webp`, ...size, alt });
  console.log(`  ${name.padEnd(20)} ${size.width}x${size.height}`);
};
/** a single card or form, at its own size */
const capture = async (selector, name, alt) => {
  await page.evaluate(() => window.scrollTo(0, 0));      // let reveals settle everywhere
  await sleep(550);
  await write(name, selector, alt);
};
/** the whole page as one image (the console keeps a sticky top bar) */
const capturePage = async (name, alt) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(550);
  await write(name, null, alt);
};

/* the journey, in order: sign in, open a ticket, answer it from the console,
   then look at the same thread from the customer's side again */
await page.goto(APP + '/app', { waitUntil: 'networkidle2' });
await page.type('#signinForm input[name="email"]', EMAIL);
await page.type('#signinForm input[name="password"]', APP_PASS);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null),
  page.click('#signinForm button[type=submit]')
]);
await sleep(600);
if (!await page.$('#tickets')) throw new Error('sign-in did not reach the dashboard');

/* open a ticket through the dashboard form, so the thread in the pictures is real */
await page.type('#subject', SUBJECT);
await page.select('#category', 'question');
await page.type('#body', QUESTION);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null),
  page.click('#tickets form button[type=submit]')
]);
await sleep(800);
const opened = /RP-\d{4,}/.exec(await page.content());
if (!opened) throw new Error('the dashboard form did not open a ticket');
await page.reload({ waitUntil: 'networkidle2' });
await sleep(500);
await capture('#tickets', 'dashboard-thread', 'The Support tickets panel of the dashboard with a real open ticket in it, opened from the form above seconds earlier.');
await capture('#security', 'dashboard-security', 'The Security panel: password change, the active sessions with a revoke action, and how the account is protected.');

/* the administrator console, on the other side of that same ticket */
await page.goto(ADMIN + '/', { waitUntil: 'networkidle2' });
await page.type('input[type=password]', ADMIN_PASS);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null),
  page.click('button[type=submit]')
]);
const openThread = async filter => {
  await page.goto(ADMIN + '/inbox?filter=' + filter, { waitUntil: 'networkidle2' });
  const link = await page.$(`a[href*="ref=${opened[0]}"]`);
  if (!link) return false;
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null), link.click()]);
  await sleep(500);
  return true;
};
if (!await openThread('open')) throw new Error('the console never listed the ticket the dashboard opened');
await page.type('#reply', ANSWER);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null),
  page.click('#thread form[action="/inbox/reply"] button[type=submit]')
]);
await sleep(600);
if (!await openThread('all')) throw new Error('the ticket left the console list after the reply');
await capture('#thread', 'console-thread', 'The administrator console with the whole conversation in it: what the customer wrote, the reply written here, and the box below for the next answer.');
await capture('#composer', 'console-composer', 'The console composer: a free-form message to any address, sent under the site logo.');

/* back to the other side: the answer is now in the customer's own dashboard */
await page.goto(APP + '/app', { waitUntil: 'networkidle2' });
await sleep(500);
await capture('#tickets', 'dashboard-answered', "The customer side of the same thread: the administrator's answer, with the ticket marked answered.");

/* the public form anyone can use without an account */
await page.goto(APP + '/enquiry', { waitUntil: 'networkidle2' });
await capture('form[data-api]', 'enquiry', 'The public enquiry form: name, email, subject, what the message is about, and the message. No account needed.');

await browser.close();

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  note: 'Screenshots of this software running (node tools/capture-product.mjs). Every image shows the real product: the account is owner@example.com, and the single ticket in the console and dashboard pictures was opened and answered during the capture pass. No customer, conversation or figure in these images is invented.',
  capturedAt: new Date().toISOString().slice(0, 10),
  shots
}, null, 2) + '\n');
console.log(`\n  ${shots.length} captures in assets/product/ (1x and 2x)\n`);
stop();
process.exit(0);
