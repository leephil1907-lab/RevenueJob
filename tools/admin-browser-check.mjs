/**
 * admin-browser-check.mjs — drives the admin console in a real browser.
 *
 *   node tools/admin-browser-check.mjs
 *
 * It starts the console on a free port against a throwaway store that already
 * holds one customer ticket, signs in, opens the inbox, replies as the
 * administrator and writes a separate message with the composer — then checks
 * that the thread, the flash and the queued mail all say the same thing.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PASSWORD = 'RoundTripPass99!';

const PORT = await new Promise(resolve => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const dir = mkdtempSync(join(tmpdir(), 'rp-admin-ui-'));
const at = new Date().toISOString();
writeFileSync(join(dir, 'store.json'), JSON.stringify({
  users: [{ id: 'u-1', name: 'Ada Nwosu', email: 'ada@example.com', plan: 'trial', verified: true, createdAt: at, password: { salt: 's', hash: 'h' } }],
  sessions: [], counters: { ticket: 1002 }, audit: [],
  tickets: [{
    ref: 'RP-1002', userId: 'u-1', email: 'ada@example.com', name: 'Ada Nwosu',
    subject: 'Invoice question', category: 'billing', status: 'open', source: 'dashboard',
    createdAt: at, updatedAt: at,
    messages: [{ from: 'user', at, body: 'Our invoice came through twice this month — can you check?' }]
  }]
}, null, 2), { mode: 0o600 });

const server = spawn('node', ['admin/server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), RP_ADMIN_PASSWORD: PASSWORD, RP_ADMIN_STATE: join(dir, '.admin.json'), RP_DATA_DIR: dir },
  stdio: ['ignore', 'pipe', 'pipe']
});
const stop = () => { try { server.kill('SIGTERM'); } catch (e) { /* gone */ } };
process.on('exit', stop);

const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) {
  try { await fetch(base + '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
}

const results = [];
const check = (name, good, detail = '') => results.push({ name, good, detail });
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

try {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.type('input[type=password]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
  check('sign-in form works in a browser', /Overview/.test(await page.content()), page.url());

  await page.goto(base + '/inbox', { waitUntil: 'domcontentloaded' });
  const inboxHtml = await page.content();
  check('inbox renders the waiting conversation', /RP-1002/.test(inboxHtml) && /invoice came through twice/.test(inboxHtml));
  check('the composer and the thread are both on screen', /Write to a customer/.test(inboxHtml) && /name="body"/.test(inboxHtml));

  const REPLY = 'You are right — the second charge is refunded and the invoice is corrected.';
  await page.type('#reply', REPLY);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('form[action="/inbox/reply"] button[type=submit]')]);
  const afterReply = await page.content();
  check('the reply is accepted from the console', /Reply saved on RP-1002/.test(afterReply),
    (afterReply.match(/class="alert[^"]*">([^<]{0,90})/) || [])[1] || 'no alert');
  check('the answer appears in the thread', afterReply.includes(REPLY.slice(0, 40)));

  await page.goto(base + '/inbox?filter=all', { waitUntil: 'domcontentloaded' });
  const previewUrl = await page.$$eval('a[target=_blank]', as => (as[0] ? as[0].getAttribute('href') : ''));
  if (previewUrl) {
    const preview = await page.goto(base + previewUrl, { waitUntil: 'domcontentloaded' }).then(r => r.text());
    check('a queued mail previews with the site branding', /RevenuePilot/.test(preview) && /icon-192|<svg/.test(preview));
  } else check('a queued mail previews with the site branding', false, 'no preview link found');

  await page.goto(base + '/inbox', { waitUntil: 'domcontentloaded' });
  await page.type('#csubject', 'Your workspace is ready');
  await page.type('#cbody', 'A note from the team, written by hand in the console.');
  await page.$eval('#to', el => { el.value = 'ada@example.com'; });
  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
  await page.click('form[action="/inbox/compose"] button[type=submit]');
  await nav;
  const afterCompose = await page.content();
  check('the composer sends a free-form message', /(queued for|sent to) ada@example\.com/.test(afterCompose),
    (afterCompose.match(/class="alert[^"]*">([^<]{0,90})/) || [])[1] || 'no alert');

  const store = JSON.parse(readFileSync(join(dir, 'store.json'), 'utf8'));
  const ticket = store.tickets[0];
  check('both writes landed in the shared store',
    ticket.messages.some(m => m.from === 'admin') && ticket.status === 'answered' && store.audit.length >= 2,
    `${ticket.messages.map(m => m.from).join('>')} · ${ticket.status} · audit ${store.audit.length}`);
  const mails = readdirSync(join(dir, 'outbox')).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, 'outbox', f), 'utf8')));
  check('both messages are queued for the customer address',
    mails.filter(m => m.to === 'ada@example.com').length === 2,
    mails.map(m => m.subject).join(' | '));
  check('no console or page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  stop();
}

const bad = results.filter(r => !r.good);
results.forEach(r => console.log(`  ${r.good ? '\u2713' : '\u2717'} ${r.name}${r.detail ? '\u2026 ' + r.detail : ''}`));
console.log(`\n  ${results.length - bad.length}/${results.length} admin browser checks passed\n`);
process.exit(bad.length ? 1 : 0);
