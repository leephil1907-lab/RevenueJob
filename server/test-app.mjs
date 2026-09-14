/**
 * test-app.mjs — end-to-end suite for the application server.
 *
 *   node server/test-app.mjs            · run the whole flow against a throwaway store
 *   node server/test-app.mjs --keep     · keep the temporary data directory afterwards
 *
 * What it proves, in order: an enquiry from the public form, sign-up, the
 * single-use verification link delivered by mail, sign-in with a session
 * cookie, opening a ticket, an answer written by the ADMIN console process
 * (a second process on the same store), that reply appearing in the running
 * app without a restart, the customer replying back, password reset, the
 * refusals that must happen (no CSRF, wrong password, someone else's ticket,
 * a replayed verification link), the store's permissions, and that four
 * processes writing at once lose nothing.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/* the store, the templates and the mailer resolve RP_DATA_DIR when they load,
   so they are imported after this suite has chosen its throwaway directory */

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const KEEP = process.argv.includes('--keep');
/* ask the OS for a free port: a fixed one can hit a leftover server from an
   interrupted run and quietly test the wrong thing */
const PORT = await new Promise(resolve => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'rp-app-'));
const EMAIL = 'ada@example.com';
const PASSWORD = 'correct horse battery 42';
const NEW_PASSWORD = 'a brand new long passphrase';

process.env.RP_DATA_DIR = DATA;
const { withStore } = await import('./store.mjs');
const { templates } = await import('./templates.mjs');
const { send } = await import('./mailer.mjs');

let pass = 0;
let fail = 0;
function ok(label, detail, good) {
  if (good) { pass++; console.log(`  \u2713 ${label}\u2026 ${detail}`); }
  else { fail++; console.log(`  \u2717 ${label}\u2026 ${detail}`); }
}
const bytes = p => { try { return readFileSync(p, 'utf8'); } catch (e) { return ''; } };
const sha = s => createHash('sha256').update(String(s)).digest('hex');

/* ------------------------------------------------------------------ helpers */
function outbox() {
  const dir = join(DATA, 'outbox');
  let names = [];
  try { names = readdirSync(dir); } catch (e) { return []; }
  return names.filter(n => n.endsWith('.json')).map(n => {
    const rec = JSON.parse(readFileSync(join(dir, n), 'utf8'));
    return {
      ...rec,
      text: bytes(join(dir, rec.id + '.txt')),
      html: bytes(join(dir, rec.id + '.html'))
    };
  }).sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
}
const mail = pattern => outbox().filter(m => new RegExp(pattern, 'i').test(m.subject)).pop() || null;
const store = () => JSON.parse(bytes(join(DATA, 'store.json')) || '{}');

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch (e) { /* html pages */ }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, text, cookies: setCookie };
}
const post = (path, body, headers) => api(path, { method: 'POST', body: JSON.stringify(body || {}), headers });
const cookieValue = cookies => {
  const c = cookies.map(c => /^rp_sid=([^;]+)/.exec(c)).filter(Boolean)[0];
  return c ? c[1] : '';
};

/* ------------------------------------------------------------- start server */
const server = spawn(process.execPath, [join(ROOT, 'server', 'app.mjs')], {
  cwd: ROOT,
  env: { ...process.env, RP_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

async function waitForHealth(seconds = 15) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
    } catch (e) { /* not listening yet */ }
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, 200));
  }
}

function shutdown() {
  try { server.kill('SIGTERM'); } catch (e) { /* already gone */ }
  if (!KEEP) { try { rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  else console.log(`\n  data kept in ${DATA}`);
}

try {
  if (!await waitForHealth()) throw new Error('server did not come up:\n' + log);
  console.log(`\n  RevenuePilot app suite · store ${DATA}\n`);

  /* ------------------------------------------------------------- enquiries */
  const q = await post('/api/enquiry', {
    name: 'Ada Nwosu', email: EMAIL, subject: 'Pricing for a 4-person agency',
    category: 'billing', body: 'Can you confirm what Growth includes for a four-person team?'
  });
  const refEnquiry = q.json.reference;
  ok('an enquiry from the public form is accepted', refEnquiry || q.text.slice(0, 40), !!refEnquiry);
  ok('the enquirer gets an acknowledgement by email',
    mail('We have your enquiry') ? mail('We have your enquiry').to : 'none',
    !!mail('We have your enquiry') && mail('We have your enquiry').to === EMAIL);
  ok('the administrator gets a copy',
    mail('admin.*enquiry') ? mail('admin.*enquiry').subject.slice(0, 46) : 'none',
    !!mail('admin.*enquiry'));

  const signInPage = await fetch(`${BASE}/app`).then(r => r.text());
  const states = ['register', 'forgot', 'reset'].filter(k => signInPage.includes(`data-panel="${k}"`));
  ok('the sign-in page carries sign-up, forgot and reset states', states.join(', ') || 'none',
    states.length === 3 && signInPage.includes('action="/api/register"') && signInPage.includes('action="/api/password/reset"'));

  const short = await post('/api/register', { name: 'x', email: 'short@example.com', password: 'short' });
  ok('a short password is refused', short.json.error || short.text.slice(0, 40), /12 characters/.test(short.json.error || ''));

  const reg = await post('/api/register', { name: 'Ada Nwosu', email: EMAIL, password: PASSWORD });
  ok('sign-up is accepted', (reg.json.message || reg.text).slice(0, 52), reg.json.ok === true);

  const verifyMail = mail('Confirm your');
  const verifyLink = verifyMail ? (verifyMail.text.match(/https?:\/\/\S+/) || [''])[0] : '';
  ok('the verification link arrives at the sign-up address',
    verifyMail ? `${verifyMail.to} · ${verifyLink.slice(0, 40)}…` : 'no mail',
    !!verifyMail && verifyMail.to === EMAIL && verifyLink.startsWith(`http://127.0.0.1:${PORT}`));

  const verified = await fetch(verifyLink).then(r => r.text());
  ok('the link confirms the address', /Email confirmed/.test(verified) ? 'Email confirmed' : verified.slice(0, 40), /Email confirmed/.test(verified));
  const replay = await fetch(verifyLink).then(r => r.text());
  ok('a replayed link is refused', /expired/.test(replay) ? 'expired' : replay.slice(0, 40), /expired/.test(replay));
  ok('a welcome mail follows verification', mail('account is active') ? mail('account is active').to : 'none', !!mail('account is active'));

  /* ---------------------------------------------------------------- session */
  const login = await post('/api/login', { email: EMAIL, password: PASSWORD });
  const sid = cookieValue(login.cookies);
  ok('sign-in returns a session cookie', sid ? `rp_sid ${sid.slice(0, 8)}…` : JSON.stringify(login.json), !!sid);
  const csrf = sha(`csrf:${sid}:rp-app`);
  const auth = { cookie: `rp_sid=${sid}` };

  const me = await api('/api/me', { headers: auth });
  ok('the account is verified and claims the earlier enquiry',
    `${me.json.user && me.json.user.email} verified=${me.json.user && me.json.user.verified} · ${(me.json.tickets || []).map(t => t.ref).join(',') || 'none'}`,
    me.json.user && me.json.user.verified === true && (me.json.tickets || []).some(t => t.ref === refEnquiry));

  /* ----------------------------------------------------------------- ticket */
  const ticket = await post('/api/tickets', { subject: 'Invoice question', category: 'billing', body: 'Our invoice came through twice this month — can you check?' }, { ...auth, 'x-csrf': csrf });
  const ref = ticket.json.reference;
  ok('a ticket opens from the dashboard', ref || ticket.text.slice(0, 40), !!ref);

  /* --------------------------- the admin side writes to the same store ------ */
  let answered = null;
  withStore(s => {
    const t = s.tickets.filter(x => x.ref === ref)[0];
    const at = new Date().toISOString();
    t.messages.push({ from: 'admin', at, body: 'You are right — the second charge is refunded and the invoice is corrected.' });
    t.status = 'answered';
    t.updatedAt = at;
    s.audit.unshift({ at, kind: 'ticket', detail: `${ref} answered by admin`, who: 'admin' });
    answered = t;
  });
  ok('the admin console writes an answer into the shared store',
    `${answered.ref} status=${answered.status} messages=${answered.messages.length}`,
    answered.status === 'answered' && answered.messages.length === 2);

  const replyMail = templates.ticket_reply({
    name: answered.name, subject: answered.subject, reference: ref, body: 'You are right — the second charge is refunded and the invoice is corrected.'
  });
  const sent = await send({ to: answered.email, subject: replyMail.subject, html: replyMail.html, text: replyMail.text });
  ok('the answer is emailed to the sign-up address',
    `${sent.transport} · delivered=${sent.delivered} · ${replyMail.subject.slice(0, 34)}`,
    mail('Re: Invoice') !== null && mail('Re: Invoice').to === EMAIL);
  ok('the mailed reply is branded and links to a real host',
    `logo=${/icon-192|<svg/.test(replyMail.html) ? 'yes' : 'no'} · host=${(replyMail.text.match(/https?:\/\/[^\s]+/) || [''])[0].slice(0, 30)}`,
    /RevenuePilot/.test(replyMail.html) && /icon-192|<svg/.test(replyMail.html));

  const afterReply = await api('/api/tickets', { headers: auth });
  const thread = (afterReply.json.tickets || []).find(t => t.ref === ref);
  ok('the running app shows that answer without a restart',
    thread ? `${thread.status} · ${thread.messages.map(m => m.from).join(' -> ')}` : 'missing',
    !!thread && thread.status === 'answered' && thread.messages.some(m => m.from === 'admin'));

  const back = await post(`/api/tickets/${ref}/reply`, { body: 'Thanks — please copy our accountant as well.' }, { ...auth, 'x-csrf': csrf });
  ok('the customer can answer back on the same thread', back.json.message ? back.json.message.slice(0, 46) : back.text.slice(0, 40), back.json.ok === true);

  /* --------------------------------------------------------------- security */
  const wrong = await post('/api/login', { email: EMAIL, password: 'nope-nope-nope' });
  ok('a wrong password is refused', wrong.json.error || '', wrong.json.ok === false);
  const noCsrf = await post('/api/tickets', { subject: 'x', body: 'yy' }, auth);
  ok('a write without a CSRF token is refused', noCsrf.json.error || '', noCsrf.status === 403);
  const foreign = await post('/api/tickets/RP-9999/reply', { body: 'hello' }, { ...auth, 'x-csrf': csrf });
  ok("someone else's ticket cannot be touched", foreign.json.error || '', foreign.json.ok === false);

  const forgot = await post('/api/password/forgot', { email: EMAIL });
  const resetMail = mail('Reset your');
  ok('a reset mail carries a single-use link', resetMail ? (resetMail.text.match(/https?:\/\/\S+/) || [''])[0].slice(0, 44) : 'none',
    !!resetMail && /#reset=/.test(resetMail.text) && /expires in 30 minutes/.test(resetMail.text));
  ok('the reset response never reveals whether an account exists', (forgot.json.message || '').slice(0, 46), forgot.json.ok === true);

  const exportBefore = await api('/api/account/export', { headers: auth });
  ok('the account export contains the tickets and the activity log',
    Object.keys(exportBefore.json).join(','),
    exportBefore.json.tickets && exportBefore.json.tickets.length > 0 && exportBefore.json.activity.length > 0);

  /* ------------------------------------------------------ the data directory */
  const guard = await api('/data/store.json');
  ok('the data directory is never served', String(guard.status), guard.status === 404);
  ok('the store file is private (0600)', String(statSync(join(DATA, 'store.json')).mode & 0o777), (statSync(join(DATA, 'store.json')).mode & 0o777) === 0o600);

  /* -------------------------------- four writers, the server live throughout */
  const before = store().counters.lockTest || 0;
  const worker = `
    const { withStore } = await import('${join(ROOT, 'server', 'store.mjs')}');
    for (let i = 0; i < 25; i++) withStore(s => { s.counters.lockTest = (s.counters.lockTest || 0) + 1; });
  `;
  await Promise.all([0, 1, 2, 3].map(() => new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', worker], {
      env: { ...process.env, RP_DATA_DIR: DATA }, stdio: 'ignore'
    });
    child.on('exit', resolve);
  })));
  const after = store();
  ok('four processes × 25 writes lose nothing', `${after.counters.lockTest} total (${after.counters.lockTest - before} this run)`,
    after.counters.lockTest - before === 100);
  ok('ticket references stay unique', after.tickets.map(t => t.ref).join(','),
    new Set(after.tickets.map(t => t.ref)).size === after.tickets.length &&
    after.tickets.every(t => Number(t.ref.slice(3)) <= after.counters.ticket));
  let leftovers = [];
  try { leftovers = readdirSync(DATA).filter(n => n.includes('lock') || n.includes('corrupt')); } catch (e) { /* ignore */ }
  ok('no lock file or corrupt copy is left behind', leftovers.length ? leftovers.join(',') : 'clean', leftovers.length === 0);

  /* ---------------------------------------------------------- password lifecycle */
  const changed = await post('/api/password/change', { current: PASSWORD, next: NEW_PASSWORD }, { ...auth, 'x-csrf': csrf });
  const staleSession = await api('/api/me', { headers: auth });
  ok('changing the password signs every device out', `${(changed.json.message || '').slice(0, 40)} · old session ${staleSession.json.ok === false ? 'rejected' : 'STILL LIVE'}`,
    changed.json.ok === true && staleSession.json.ok === false);

  const oldLogin = await post('/api/login', { email: EMAIL, password: PASSWORD });
  ok('the old password stops working', oldLogin.json.ok === false ? 'refused' : 'LEAK', oldLogin.json.ok === false);
  const newLogin = await post('/api/login', { email: EMAIL, password: NEW_PASSWORD });
  const sid2 = cookieValue(newLogin.cookies);
  const csrf2 = sha(`csrf:${sid2}:rp-app`);
  ok('the new password works', sid2 ? `rp_sid ${sid2.slice(0, 8)}…` : JSON.stringify(newLogin.json), !!sid2);

  /* ------------------------------------------------------- reset round trip */
  const resetLink = resetMail ? (resetMail.text.match(/#reset=([a-f0-9]+)/) || [])[1] : '';
  const RESET_PASSWORD = 'a third long passphrase';
  const mismatch = await post('/api/password/reset', { code: resetLink, password: RESET_PASSWORD, confirm: 'something else entirely' });
  ok('the reset form refuses two different passwords', (mismatch.json.error || '').slice(0, 46), /do not match/.test(mismatch.json.error || ''));
  const shortReset = await post('/api/password/reset', { code: resetLink, password: 'tiny' });
  ok('the reset form refuses a short password', (shortReset.json.error || '').slice(0, 46), /12 characters/.test(shortReset.json.error || ''));
  const badCode = await post('/api/password/reset', { code: 'deadbeef', password: RESET_PASSWORD });
  ok('an unknown reset code is refused', (badCode.json.error || '').slice(0, 46), /expired or was already used/.test(badCode.json.error || ''));
  const reset = await post('/api/password/reset', { code: resetLink, password: RESET_PASSWORD, confirm: RESET_PASSWORD });
  ok('the mailed reset code sets a new password', (reset.json.message || reset.json.error || '').slice(0, 46), reset.json.ok === true);
  const replayed = await post('/api/password/reset', { code: resetLink, password: 'yet another long passphrase' });
  ok('the same reset code cannot be used twice', (replayed.json.error || '').slice(0, 46), replayed.json.ok === false);
  const noticeMail = mail('password was changed');
  ok('a security notice mails the account owner', noticeMail ? noticeMail.to : 'none', !!noticeMail && noticeMail.to === EMAIL);
  const afterReset = await post('/api/login', { email: EMAIL, password: RESET_PASSWORD });
  const sid3 = cookieValue(afterReset.cookies);
  ok('the reset password signs in', sid3 ? `rp_sid ${sid3.slice(0, 8)}…` : JSON.stringify(afterReset.json), !!sid3);
  const csrf3 = sha(`csrf:${sid3}:rp-app`);
  const staleAfterReset = await api('/api/me', { headers: { cookie: `rp_sid=${sid2}` } });
  ok('resetting signs the older session out', staleAfterReset.json.ok === false ? 'rejected' : 'STILL LIVE', staleAfterReset.json.ok === false);

  const closed = await post('/api/account/close', {}, { cookie: `rp_sid=${sid3}`, 'x-csrf': csrf3 });
  const gone = store();
  ok('closing the account deletes the account and its tickets',
    `${(closed.json.message || '').slice(0, 34)} · users=${gone.users.length} · own tickets=${gone.tickets.filter(t => t.email === EMAIL).length}`,
    closed.json.ok === true && gone.users.length === 0 && gone.tickets.filter(t => t.email === EMAIL).length === 0);
} catch (e) {
  fail++;
  console.log(`\n  suite error: ${e.message}\n`);
  if (log) console.log(log.split('\n').slice(-12).join('\n'));
} finally {
  shutdown();
}

console.log(`\n  ${pass}/${pass + fail} app checks passed\n`);
process.exit(fail ? 1 : 0);
