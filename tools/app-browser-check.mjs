/**
 * app-browser-check.mjs — drives the customer-facing journey in a real browser.
 *
 *   node tools/app-browser-check.mjs                  · spawns its own server on a
 *                                                       throwaway store, so nothing
 *                                                       here can touch live data
 *   node tools/app-browser-check.mjs https://domain   · same journey against a
 *                                                       DEPLOYED site — note that
 *                                                       this creates a test account
 *                                                       and a test enquiry there
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let own = null;
let B = process.argv[2] || '';
if (!B) {
  const port = await new Promise(resolve => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const dir = mkdtempSync(join(tmpdir(), 'rp-browser-'));
  own = {
    dir,
    proc: spawn(process.execPath, [join(ROOT, 'server', 'app.mjs')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RP_DATA_DIR: dir, SESSION_PEPPER: 'browser-check-pepper' },
      stdio: ['ignore', 'ignore', 'ignore']
    })
  };
  B = 'http://127.0.0.1:' + port;
  const stop = () => { try { own.proc.kill('SIGTERM'); } catch (e) { /* gone */ } rmSync(dir, { recursive: true, force: true }); };
  process.on('exit', stop);
  for (let i = 0; i < 50; i++) {
    try { await fetch(B + '/health'); break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
}
const b = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
const go = async (url) => { await p.goto(url, { waitUntil: 'networkidle2', timeout: 20000 }); await new Promise(r => setTimeout(r, 400)); };
const vis = sel => p.$eval(sel, el => !el.hidden && el.offsetParent !== null).catch(() => false);

await go(B + '/app');
const out = {};
out.signInVisible = await vis('#signinForm');
out.registerHidden = !(await vis('[data-panel="register"]'));
await p.click('[data-view="register"]');
await new Promise(r => setTimeout(r, 250));
out.registerShown = await vis('[data-panel="register"]');
out.signInHiddenAfter = !(await vis('#signinForm'));
out.hashAfterClick = await p.evaluate(() => location.hash);
await go(B + '/app#forgot');
out.forgotFromHash = await vis('[data-panel="forgot"]');
await go(B + '/app#reset=abc123');
out.resetFromHash = await vis('[data-panel="reset"]');
out.codeFilled = await p.$eval('#resetCode', el => el.value);
// submit the register form for real through the UI
await go(B + '/app#register');
const account = 'ui-' + Date.now() + '@example.com';
await p.type('#r-name', 'Preview Tester');
await p.type('#r-email', account);
await p.type('#r-pass', 'a preview passphrase 42');
await p.click('#registerForm button[type=submit]');
await new Promise(r => setTimeout(r, 900));
out.registerNote = await p.$eval('#registerForm [data-note]', el => el.hidden ? 'hidden' : el.textContent.slice(0, 70)).catch(() => 'missing');
// the public enquiry form
await go(B + '/enquiry');
out.enquiryForm = await vis('form[data-api]');
await p.type('form[data-api] input[name="name"]', 'Preview Tester');
await p.type('form[data-api] input[name="email"]', 'enquiry-ui@example.com');
await p.type('form[data-api] input[name="subject"]', 'Trying the public form');
const area = await p.$('form[data-api] textarea[name="body"]');
if (area) await area.type('This is a real submission from the preview, checking the whole path end to end.');
await p.click('form[data-api] button[type=submit]');
await new Promise(r => setTimeout(r, 900));
out.enquiryNote = await p.$eval('form[data-api] [data-note]', el => el.hidden ? 'hidden' : el.textContent.slice(0, 70)).catch(() => 'missing');
/* the confirmation link, then signing in the way a person does: this is the
   journey that matters most, and it is the one a JSON-only form used to break */
let code = '';
if (own) {
  const dir = join(own.dir, 'outbox');
  for (let i = 0; i < 40 && !code; i++) {
    let names = [];
    try { names = readdirSync(dir).filter(f => f.endsWith('.txt')); } catch (e) { /* nothing queued yet */ }
    for (const n of names) {
      const found = (readFileSync(join(dir, n), 'utf8').match(/code=([a-f0-9]{8,})/) || [])[1];
      if (found) { code = found; break; }
    }
    if (!code) await new Promise(r => setTimeout(r, 150));
  }
}
out.confirmationLink = !!code;
if (code) {
  await go(B + '/api/verify?code=' + code);
  out.addressConfirmed = /confirmed/i.test(await p.content());
}
await go(B + '/app');
await p.type('#signinForm input[name="email"]', account);
await p.type('#signinForm input[name="password"]', 'a preview passphrase 42');
await p.click('#signinForm button[type=submit]');
await new Promise(r => setTimeout(r, 1200));
out.signedIn = !!(await p.$('#tickets'));
out.signInNote = await p.$eval('#signinForm [data-note]', el => el.hidden ? 'hidden' : el.textContent.slice(0, 70)).catch(() => 'none');
if (!out.signedIn) out.signInLandedOn = (await p.content()).slice(0, 90).replace(/\s+/g, ' ');

out.errors = errs.slice(0, 4);
console.log(JSON.stringify(out, null, 2));
await b.close();
if (own) { try { own.proc.kill('SIGTERM'); } catch (e) { /* gone */ } rmSync(own.dir, { recursive: true, force: true }); }
/* a missing note or a hidden panel is a failure, not just a page error */
const broken = [];
if (!out.signInVisible) broken.push('sign-in form not visible');
if (!out.registerShown) broken.push('register panel did not open');
if (!out.forgotFromHash) broken.push('forgot panel did not open from the hash');
if (!out.resetFromHash) broken.push('reset panel did not open from the hash');
if (String(out.registerNote).startsWith('missing')) broken.push('registration produced no note');
if (String(out.enquiryNote).startsWith('missing')) broken.push('enquiry produced no note');
if (!out.confirmationLink) broken.push('registration queued no confirmation link');
if (out.addressConfirmed === false) broken.push('the confirmation link was rejected');
if (!out.signedIn) broken.push('signing in through the form did not reach the dashboard (landed on: ' + (out.signInLandedOn || '?') + ')');
if (out.errors && out.errors.length) broken.push(...out.errors);
if (broken.length) {
  console.log('\n  ' + broken.length + ' problem(s): ' + broken.join(' | ') + '\n');
}
process.exit(broken.length ? 1 : 0);
