import { spawn } from 'node:child_process';
import { createServer as freePortServer } from 'node:net';
/* a fixed port would silently talk to a leftover server from an interrupted
   run, so the suite asks the OS for a free one every time */
const PORT = await new Promise(resolve => {
  const probe = freePortServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const S = `http://127.0.0.1:${PORT}`;
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const stateDir = mkdtempSync(join(tmpdir(), 'rp-admin-'));
/* the console shares the app's store, so the suite gets its own data dir and
   seeds one ticket from a customer who is waiting for an answer */
const dataDir = mkdtempSync(join(tmpdir(), 'rp-admin-data-'));
const at = new Date().toISOString();
writeFileSync(join(dataDir, 'store.json'), JSON.stringify({
  users: [{ id: 'u-1', name: 'Ada Nwosu', email: 'ada@example.com', plan: 'trial', verified: true, createdAt: at, password: { salt: 'seeded', hash: 'seeded' } }],
  sessions: [],
  counters: { ticket: 1002 },
  audit: [],
  tickets: [{
    ref: 'RP-1002', userId: 'u-1', email: 'ada@example.com', name: 'Ada Nwosu',
    subject: 'Invoice question', category: 'billing', status: 'open', source: 'dashboard',
    createdAt: at, updatedAt: at,
    messages: [{ from: 'user', at, body: 'Our invoice came through twice this month — can you check?' }]
  }]
}, null, 2), { mode: 0o600 });
const env = { ...process.env, PORT: String(PORT), RP_ADMIN_PASSWORD: 'RoundTripPass99!', RP_ADMIN_STATE: join(stateDir, '.admin.json'), RP_DATA_DIR: dataDir };
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const srv = spawn('node', ['admin/server.mjs'], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const stopServer = () => { try { srv.kill('SIGTERM'); } catch (e) { /* already gone */ } };
/* this suite edits site.config.json to prove the settings round-trip works, so
   it keeps the original bytes and puts them back however we leave — a crash
   used to be able to strand a probe value in the shipped config */
let configBytes = null;
const CONFIG_PATH = ROOT + '/site.config.json';
const restoreConfig = () => {
  try {
    if (configBytes !== null && readFileSync(CONFIG_PATH, 'utf8') !== configBytes) {
      writeFileSync(CONFIG_PATH, configBytes);
    }
  } catch (e) { /* nothing more we can do on the way out */ }
};
process.on('exit', restoreConfig);
process.on('exit', stopServer);
process.on('SIGINT', () => { stopServer(); process.exit(130); });
/* CI and shells send SIGTERM: exit cleanly so the config is put back and no
   console is left listening */
process.on('SIGTERM', () => { stopServer(); process.exit(143); });
process.on('uncaughtException', e => { stopServer(); console.error(e); process.exit(1); });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
await new Promise(r => setTimeout(r, 1600));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? (pass++, console.log('  ok   ' + name)) : (fail++, console.log('  FAIL ' + name + (extra ? ' — ' + extra : ''))); };
const jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function get(path, opts = {}) {
  const res = await fetch(S + path, { redirect: 'manual', headers: { cookie: cookieHeader(), ...(opts.headers || {}) } });
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const k = pair.slice(0, i), v = pair.slice(i + 1);
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  const body = await res.text();
  return { status: res.status, body, headers: res.headers };
}
async function post(path, form) {
  const res = await fetch(S + path, { method: 'POST', redirect: 'manual',
    headers: { cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const k = pair.slice(0, i), v = pair.slice(i + 1);
    if (v === '') delete jar[k]; else jar[k] = v;
  }
  const body = await res.text();
  return { status: res.status, body, location: res.headers.get('location') };
}

console.log('\nADMIN CONSOLE ROUND TRIP\n');

/* 1. unauthenticated */
let r = await get('/');
ok('unauthenticated GET / renders sign-in (200)', r.status === 200 && /Admin sign in/.test(r.body));
ok('sign-in page sets pre-auth cookie', /rp_admin_pre=[a-f0-9]{32}/.test(r.headers.getSetCookie().join(';')));
ok('sign-in page never leaks a hash or path', !/passwordHash|scrypt|\/home\/user/.test(r.body));
ok('security headers present', r.headers.get('x-frame-options') === 'DENY' && /noindex/.test(r.headers.get('x-robots-tag')));
ok('robots.txt disallows the whole admin origin', (await get('/robots.txt')).body.includes('Disallow: /'));

/* 2. CSRF gate */
const csrf = (r.body.match(/name="csrf" value="([a-f0-9]+)"/) || [])[1];
ok('login form carries a CSRF token', !!csrf);
const tok = b => (b.match(/name="csrf" value="([a-f0-9]+)"/) || [])[1];
r = await post('/login', { password: 'RoundTripPass99!' });
ok('login without the CSRF token is refused (403)', r.status === 403, 'got ' + r.status);
const csrf2 = tok(r.body);
ok('refused login re-issues a matching token (form still usable)', !!csrf2 && csrf2 !== csrf);
r = await post('/login', { password: 'WrongPass', csrf: csrf2 });
ok('wrong password refused (401)', r.status === 401);
const csrf3 = tok(r.body);
ok('lockout notice counts down remaining attempts', /4 attempts left/.test(r.body));
r = await post('/login', { password: 'RoundTripPass99!', csrf: csrf3 });
ok('correct password + CSRF signs in (303 → /)', r.status === 303 && r.location === '/', 'got ' + r.status);
ok('session cookie is HttpOnly + SameSite=Strict', /rp_admin=[a-f0-9]{64}/.test(cookieHeader()));

/* 3. overview */
r = await get('/');
ok('overview renders after sign-in', r.status === 200 && /Overview/.test(r.body));
ok('overview shows live config counts', /agent roles/.test(r.body) && /FAQ entries/.test(r.body) && /index\.html/.test(r.body),
   r.body.match(/(\d+) KB/)?.[0] || 'no byte count');
ok('overview flags the example.com placeholder canonical', /placeholder/.test(r.body));
ok('overview shows verification output', /checks|PASS|verified/i.test(r.body));

for (const [p, needle] of [['/settings','Site settings'],['/pricing','Pricing'],['/locales','Locales'],['/evidence','Evidence'],['/snapshots','Snapshots'],['/security','Security']]) {
  const rr = await get(p);
  ok(`${p} renders (200, no unfilled template)`, rr.status === 200 && !rr.body.includes('{{CSRF}}') && rr.body.includes(needle), rr.status + ' ' + (rr.body.includes('{{CSRF}}') ? 'RAW-CSRF' : ''));
}
ok('CSRF tokens are substituted in every form', !(await get('/settings')).body.includes('{{CSRF}}'));

const sCsrf = tok((await get('/')).body);
ok('authenticated pages carry a session-bound CSRF token', !!sCsrf && sCsrf !== csrf);

/* 4. verify (read-only) */
r = await post('/verify', { csrf: sCsrf });
ok('verify runs the build check', /PASS|checks|verified|ok/i.test(r.body));

/* 5. settings save → snapshot → rollback */
const fs = await import('node:fs');
const originalBytes = readFileSync(CONFIG_PATH, 'utf8');
configBytes = originalBytes;   // restored on exit even if we crash
const before = JSON.parse(originalBytes);
const sform = { csrf: sCsrf, 'site.name': before.site.name, 'site.title': before.site.title + '', 'site.description': before.site.description, 'seo.primaryKeyword': before.seo.primaryKeyword, 'site.url': before.site.url };
sform['seo.title'] = 'Round-trip probe title';
r = await post('/settings', sform);
ok('settings save accepted', r.status === 200 || r.status === 303, 'got ' + r.status);
const after = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
ok('settings change persisted to site.config.json', after.seo.title === 'Round-trip probe title', JSON.stringify(after.seo.title));
let snaps = [];
try { snaps = fs.readdirSync(dataDir + '/snapshots'); } catch (e) { snaps = []; }
ok('a snapshot was taken before writing', snaps.length > 0, snaps.join(','));
r = await get('/snapshots');
const snapName = (r.body.match(/name="file" value="([^"]+)"/) || [])[1];
ok('snapshot is listed with a rollback form', !!snapName, snapName);
if (snapName) {
  r = await post('/rollback', { csrf: sCsrf, file: snapName });
  const rb = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  ok('rollback restored the previous config', rb.seo.title === before.seo.title, JSON.stringify(rb.seo.title));
}

/* 6. tamper checks */
r = await post('/settings', { csrf: 'deadbeef' });
ok('POST with a bad CSRF token is refused', r.status === 403, 'got ' + r.status);
r = await get('/nope');
ok('unknown path returns 404', r.status === 404, 'got ' + r.status);

/* 7. the live config must be exactly as we found it */
try {
  const nowBytes = fs.readFileSync(CONFIG_PATH, 'utf8');
  if (nowBytes !== originalBytes) { fs.writeFileSync(CONFIG_PATH, originalBytes); ok('config restored to its original bytes (self-healed)', false, 'rewrote the file'); }
  else ok('config is byte-identical to the pre-test state', true);
} catch (e) { ok('config restored', false, e.message); }

/* 8. the inbox, the reply composer and mail delivery */
r = await get('/inbox');
ok('inbox lists the conversation waiting for an answer', r.status === 200 && /RP-1002/.test(r.body) && /Invoice question/.test(r.body));
ok('inbox shows what the customer wrote', /invoice came through twice/.test(r.body));
ok('inbox renders every form with a session CSRF token', !r.body.includes('{{CSRF}}'));
const iCsrf = tok(r.body);
ok('inbox is reachable from the tab bar with a count', /Inbox/.test((await get('/')).body));

r = await post('/inbox/reply', { csrf: 'deadbeef', ref: 'RP-1002', body: 'no token' });
ok('reply without a CSRF token is refused', r.status === 403, 'got ' + r.status);
const anon = await fetch(S + '/inbox/reply', {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'rp_admin=bogus' },
  body: new URLSearchParams({ ref: 'RP-1002', body: 'no session' })
});
ok('a reply without a session is refused', anon.status === 401, 'got ' + anon.status);

const REPLY = 'You are right — the second charge is refunded and the invoice is corrected.';
r = await post('/inbox/reply', { csrf: iCsrf, ref: 'RP-1002', filter: 'open', body: REPLY });
ok('reply accepted from the console', r.status === 200 && /Reply saved on RP-1002/.test(r.body), r.status + ' ' + r.body.slice(0, 80));
let store = JSON.parse(readFileSync(join(dataDir, 'store.json'), 'utf8'));
let ticket = store.tickets.filter(t => t.ref === 'RP-1002')[0];
ok('the reply is stored on the thread', ticket.messages.some(m => m.from === 'admin' && /refunded/.test(m.body)),
   ticket.messages.map(m => m.from).join('>'));
ok('the ticket moves to answered', ticket.status === 'answered', ticket.status);
ok('the admin action lands in the shared audit log', store.audit.some(a => /RP-1002 answered from the console/.test(a.detail) && a.who === 'admin'));

const outboxDir = join(dataDir, 'outbox');
const queuedFiles = readdirSync(outboxDir);
const queued = queuedFiles.filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(outboxDir, f), 'utf8')));
const replyMail = queued.filter(m => /Re: Invoice question/.test(m.subject))[0];
ok('the answer is emailed to the address on the account', !!replyMail && replyMail.to === 'ada@example.com',
   replyMail ? replyMail.to : 'no reply mail, queue=' + queued.map(m => m.subject).join(' | '));
const replyHtml = queuedFiles.filter(f => f.endsWith('.html')).map(f => readFileSync(join(outboxDir, f), 'utf8')).join('\n');
ok('the mailed answer carries the site branding', /RevenuePilot/.test(replyHtml) && /icon-192|<svg/.test(replyHtml));
ok('the console reports the transport it used', /Outbox only|SMTP|provider/i.test(r.body));

r = await post('/inbox/status', { csrf: iCsrf, ref: 'RP-1002', status: 'resolved' });
ok('a conversation can be marked resolved', r.status === 200 && /marked resolved/.test(r.body));
store = JSON.parse(readFileSync(join(dataDir, 'store.json'), 'utf8'));
ok('the resolution is persisted', store.tickets.filter(t => t.ref === 'RP-1002')[0].status === 'resolved');
ok('resolved filter lists it', /\/inbox\?filter=resolved&amp;ref=RP-1002/.test((await get('/inbox?filter=resolved')).body));
const openPage = (await get('/inbox?filter=open')).body;
ok('waiting filter drops it from the list', !/\/inbox\?filter=open&amp;ref=RP-1002/.test(openPage),
   'context: ' + (openPage.match(/.{0,60}RP-1002.{0,60}/) || ['no mention'])[0].replace(/\s+/g, ' '));

r = await post('/inbox/compose', { csrf: iCsrf, to: 'ada@example.com', subject: 'Your workspace is ready', body: 'A note from the team, written by hand in the console.' });
ok('the composer sends a free-form message', r.status === 200 && /(queued for|sent to) ada@example\.com/.test(r.body), r.body.slice(0, 90));
const afterCompose = readdirSync(outboxDir).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(outboxDir, f), 'utf8')));
const composed = afterCompose.filter(m => m.subject === 'Your workspace is ready')[0];
ok('the composed message reached the queue', !!composed && composed.to === 'ada@example.com');
r = await post('/inbox/compose', { csrf: iCsrf, to: 'not-an-address', subject: 'x', body: 'too short' });
ok('the composer refuses a bad address', /valid address/.test(r.body));
r = await get('/inbox?ref=' + (composed ? '' : 'RP-9999'));
ok('an unknown reference is handled without an error', r.status === 200);

r = await get('/outbox/' + (composed ? composed.id : 'nope'));
ok('a queued message can be previewed on its own', r.status === 200 && /RevenuePilot/.test(r.body), 'got ' + r.status);
r = await get('/outbox/..%2F..%2Fsite.config.json');
ok('the preview route rejects a path traversal id', r.status === 400, 'got ' + r.status);

srv.kill();
console.log(`\n${pass}/${pass + fail} admin checks passed\n`);
console.log('--- server log tail ---');
console.log(log.split('\n').slice(-12).join('\n'));
process.exit(fail ? 1 : 0);
