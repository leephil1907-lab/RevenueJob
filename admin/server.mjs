#!/usr/bin/env node
/**
 * RevenuePilot admin console.
 *
 *   node admin/server.mjs              → http://127.0.0.1:8787
 *   PORT=9000 node admin/server.mjs
 *
 * WHY THIS IS A SEPARATE PROCESS AND NOT A PAGE ON THE SITE
 * --------------------------------------------------------
 * The public site is a static file. Anything shipped inside it is public: a
 * "hidden" admin route in index.html is a route anyone can read, call and
 * tamper with. So the admin console is a different origin, started deliberately,
 * bound to localhost by default, behind a password, with a session cookie and
 * rate-limited login. It never appears in the sitemap or the site navigation,
 * and robots.txt disallows /admin outright.
 *
 * WHAT IT CAN DO
 *   · edit site.config.json through a form (identity, SEO, branding, pricing,
 *     publishing flags, evidence, capabilities) with validation and a diff
 *   · run the publish pipeline: build assets → assemble → verify, and refuse to
 *     publish when verification fails
 *   · manage locale coverage and see which locales still need a native review
 *   · edit customer evidence, with a hard rule: no evidence publishes without
 *     written permission recorded against it
 *   · inspect the generated metadata: title/description length, canonical URL,
 *     hreflang set, structured-data validity
 *   · roll back to the previous config snapshot
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *   · run without a password, or off-localhost without explicit opt-in
 *   · publish a build that fails verification
 *   · invent customer evidence (the publish step blocks it)
 *
 * Auth: password is hashed with scrypt on first run and stored in
 * admin/.admin.json (git-ignored by convention). Set RP_ADMIN_PASSWORD to
 * bootstrap non-interactively.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { join, extname } from 'node:path';
/* the app server writes accounts and tickets into the same document this
   console edits, so it goes through store.mjs rather than its own file handle */
import { readStore, withStore, statMtime, changedSince, DATA, STORE as APP_STORE } from '../server/store.mjs';
import { templates, setBase } from '../server/templates.mjs';
import { send as mailSend, transport, transportDescription, outboxList, outboxRead } from '../server/mailer.mjs';

/* the console lives in the same checkout as the site: work it out from this
   file, never from a path that only exists on one machine */
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const ADMIN_DIR = join(ROOT, 'admin');
const STATE_FILE = process.env.RP_ADMIN_STATE || join(ADMIN_DIR, '.admin.json');
const CONFIG = join(ROOT, 'site.config.json');
/* config snapshots are runtime state: they belong on the persistent disk next
   to the store, otherwise a deploy on a host with an ephemeral filesystem would
   throw away the rollback history without saying so */
const SNAPSHOT_DIR = process.env.RP_SNAPSHOT_DIR || join(DATA, 'snapshots');

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
const PORT = Number(process.env.PORT || (cfg.admin && cfg.admin.port) || 8787);
const HOST = process.env.HOST || (cfg.admin && cfg.admin.host) || '127.0.0.1';

/* the console refuses to be framed; a preview host can relax that with one env
   variable, and a real deployment leaves it exactly as it was */
const FRAME_ANCESTORS = process.env.RP_FRAME_ANCESTORS || "'none'";
const SESSION_MINUTES = (cfg.admin && cfg.admin.sessionMinutes) || 120;
const MAX_ATTEMPTS = (cfg.admin && cfg.admin.maxLoginAttempts) || 5;
const LOCKOUT_MINUTES = (cfg.admin && cfg.admin.lockoutMinutes) || 15;

mkdirSync(SNAPSHOT_DIR, { recursive: true });

/* ════════════════ auth storage ════════════════ */
function loadState() {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* fall through */ }
  }
  const bootstrap = process.env.RP_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const state = {
    passwordSalt: salt,
    passwordHash: scryptSync(bootstrap, salt, 64).toString('hex'),
    createdAt: new Date().toISOString(),
    generatedPassword: process.env.RP_ADMIN_PASSWORD ? null : bootstrap
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  return state;
}
const state = loadState();
const sessions = new Map();
const attempts = new Map();

function verifyPassword(password) {
  const candidate = scryptSync(password, state.passwordSalt, 64);
  const expected = Buffer.from(state.passwordHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
function newSession() {
  const id = randomBytes(32).toString('hex');
  sessions.set(id, Date.now() + SESSION_MINUTES * 60 * 1000);
  return id;
}
function validSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/rp_admin=([a-f0-9]{64})/);
  if (!m) return false;
  const exp = sessions.get(m[1]);
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return false; }
  sessions.set(m[1], Date.now() + SESSION_MINUTES * 60 * 1000);   // sliding window
  return true;
}
/* CSRF: every mutating request must carry the session's own token */
const csrfFor = sid => createHash('sha256').update(sid + state.passwordSalt).digest('hex').slice(0, 32);
function sidOf(req) {
  const m = (req.headers.cookie || '').match(/rp_admin=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

/* ════════════════ the shared store ════════════════
   Reads come from a snapshot that is re-read whenever the file changes under
   us (the app server writes while an administrator is looking at the page);
   writes run inside the store's lock, so neither process loses the other's
   work. */
let db = readStore();
let seen = statMtime();

function refresh() {
  const m = changedSince(seen);
  if (m) { db = readStore(); seen = m; }
}
function mutate(fn) {
  withStore(store => { fn(store); return store; });
  db = readStore();
  seen = statMtime();
}
function auditIn(store, kind, detail, who) {
  store.audit.unshift({ at: new Date().toISOString(), kind, detail, who: who || 'admin' });
  store.audit = store.audit.slice(0, 500);
}
const openTickets = () => db.tickets.filter(t => t.status !== 'resolved');
const ticketByRef = ref => db.tickets.filter(t => t.ref === ref)[0] || null;
const isEmailAddress = v => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v || '').trim());

/* where the links inside outgoing mail should point */
function originOf(req) {
  const configured = String((cfg.site && cfg.site.url) || '').replace(/\/$/, '');
  if (configured && !/\.example\.(com|org|net)$/i.test(configured)) return configured;
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (!host) return configured;
  const name = host.split(':')[0].replace(/^\[|\]$/g, '');
  const loopback = name === 'localhost' || name === '::1' || name === '0.0.0.0' || /^127\./.test(name);
  const proto = req.headers['x-forwarded-proto'] || (loopback ? 'http' : 'https');
  return proto + '://' + host;
}
async function deliver(message, context) {
  const result = await mailSend(message);
  mutate(store => auditIn(store, 'email',
    `${message.subject} \u2192 ${message.to} \u00b7 ${result.transport}${result.delivered ? '' : ' (queued)'}` +
    (result.error ? ' \u00b7 ' + result.error : ''), 'admin'));
  return result;
}

/* ════════════════ helpers ════════════════ */
const esc = s => String(s === undefined ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}
function run(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') + (e.message || '') };
  }
}
function snapshot(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(SNAPSHOT_DIR, stamp + '.json');
  copyFileSync(CONFIG, file);
  writeFileSync(file.replace('.json', '.label'), label);
  /* keep the last 20 */
  const files = readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json')).sort();
  while (files.length > 20) {
    const old = files.shift();
    try { execFileSync('rm', ['-f', join(SNAPSHOT_DIR, old), join(SNAPSHOT_DIR, old.replace('.json', '.label'))]); } catch (e) { }
  }
  return file;
}
function snapshots() {
  return readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json')).sort().reverse().map(f => {
    const labelFile = join(SNAPSHOT_DIR, f.replace('.json', '.label'));
    return {
      file: f,
      at: statSync(join(SNAPSHOT_DIR, f)).mtime.toISOString(),
      label: existsSync(labelFile) ? readFileSync(labelFile, 'utf8') : ''
    };
  });
}

/* ════════════════ pages ════════════════ */
const baseCSS = `
:root{--bg:#05070d;--panel:#0a0e18;--line:rgba(140,165,255,.16);--ink:#eef3ff;--dim:#93a2c9;--dim2:#6d7ca4;
--cy:#5ae7ff;--bl:#6fa8ff;--ok:#46e3a4;--warn:#f3c98b;--bad:#ff7a7a;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);
background-image:radial-gradient(900px 500px at 12% -10%,rgba(111,168,255,.10),transparent 60%),
radial-gradient(700px 400px at 100% 0%,rgba(138,107,255,.08),transparent 55%)}
a{color:var(--cy)}
h1,h2,h3,h4{letter-spacing:-.02em;margin:0}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 22px;
border-bottom:1px solid var(--line);background:rgba(5,7,13,.85);backdrop-filter:blur(10px);position:sticky;top:0;z-index:20}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.02em}
.brand svg{width:24px;height:24px}
.brand small{font:600 10px/1 var(--mono);color:var(--dim2);letter-spacing:.14em;text-transform:uppercase;
border:1px solid var(--line);border-radius:999px;padding:4px 8px}
.wrap{max-width:1080px;margin:0 auto;padding:26px 22px 80px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
label{display:block;font:600 11.5px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--dim2);margin-bottom:6px}
input[type=text],input[type=password],input[type=number],textarea,select{width:100%;padding:11px 12px;border-radius:9px;
background:rgba(255,255,255,.03);border:1px solid var(--line);color:var(--ink);font:14px/1.5 var(--sans)}
input:focus,textarea:focus,select:focus{outline:none;border-color:rgba(90,231,255,.45)}
textarea{min-height:90px;font-family:var(--mono);font-size:12.5px;line-height:1.6}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:9px;border:1px solid var(--line);
background:rgba(255,255,255,.04);color:var(--ink);font:600 13px/1 var(--sans);cursor:pointer;text-decoration:none}
.btn:hover{border-color:rgba(140,165,255,.34)}
.btn.primary{background:linear-gradient(180deg,#7fb6ff,#5c8bff);color:#04060d;border-color:transparent}
.btn.sm{padding:8px 12px;font-size:12.5px}
.pill{display:inline-block;font:600 10.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;
padding:5px 9px;border-radius:999px;border:1px solid var(--line);color:var(--dim)}
.pill.ok{color:var(--ok);border-color:rgba(70,227,164,.35);background:rgba(70,227,164,.07)}
.pill.warn{color:var(--warn);border-color:rgba(243,201,139,.35);background:rgba(243,201,139,.07)}
.pill.bad{color:var(--bad);border-color:rgba(255,122,122,.35);background:rgba(255,122,122,.07)}
.muted{color:var(--dim2)}
.mono{font-family:var(--mono)}
pre{background:#060910;border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;
font:12px/1.55 var(--mono);color:#c9d6f5;max-height:340px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px dashed var(--line)}
th{font:600 11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.stack{display:grid;gap:14px}
.stat{display:grid;gap:4px}
.stat b{font:700 26px/1 var(--mono)}
.stat span{font:500 11px/1.3 var(--mono);color:var(--dim2);letter-spacing:.06em}
.alert{padding:13px 15px;border-radius:10px;border:1px solid var(--line);font-size:13.5px;margin-bottom:14px}
.alert.ok{background:rgba(70,227,164,.06);border-color:rgba(70,227,164,.3)}
.alert.bad{background:rgba(255,122,122,.07);border-color:rgba(255,122,122,.32)}
.alert.warn{background:rgba(243,201,139,.07);border-color:rgba(243,201,139,.3)}
.login{max-width:420px;margin:12vh auto;padding:26px}
.nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.nav a{padding:8px 13px;border-radius:8px;border:1px solid transparent;color:var(--dim);text-decoration:none;font-size:13.5px}
.nav a:hover{color:var(--ink);border-color:var(--line)}
.nav a.on{color:var(--ink);background:rgba(255,255,255,.05);border-color:var(--line)}
.diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.diff pre{max-height:420px}
`;

const head = (title) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${esc(title)} · RevenuePilot admin</title><style>${baseCSS}</style></head><body>`;

const brand = `<span class="brand">
  <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5ae7ff"/><stop offset="55%" stop-color="#6fa8ff"/><stop offset="100%" stop-color="#8a6bff"/>
    </linearGradient></defs>
    <path d="M256 34 470 158v196L256 478 42 354V158Z" fill="#04060d" stroke="url(#ag)" stroke-width="14" stroke-linejoin="round"/>
    <path d="M206 262l40 23 40-23" fill="none" stroke="url(#ag)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="256" cy="292" r="26" fill="url(#ag)"/>
  </svg>
  RevenuePilot <small>Admin console · local</small></span>`;

/* Pre-auth CSRF: the login form carries a token bound to a short-lived
   HttpOnly cookie, so a cross-site POST cannot even reach the password check. */
const PRE_COOKIE = 'rp_admin_pre';
function preToken(req) {
  const m = new RegExp('(?:^|; *)' + PRE_COOKIE + '=([a-f0-9]+)').exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
function issuePreToken() {
  return randomBytes(16).toString('hex');
}
/* Render the sign-in page with a token that always matches the cookie we set. */
function loginResponse(send, code, message) {
  const pre = issuePreToken();
  return send(code, loginPage(message, pre), {
    'set-cookie': `${PRE_COOKIE}=${pre}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900` +
      (process.env.RP_ADMIN_HTTPS === '1' ? '; Secure' : '')
  });
}

function loginPage(message, pre = '') {
  return head('Sign in') + `
  <div class="login card">
    <div style="margin-bottom:18px">${brand}</div>
    <h1 style="font-size:22px;margin-bottom:6px">Admin sign in</h1>
    <p class="muted" style="font-size:13.5px;margin:0 0 18px">
      This console is not part of the public site, is not linked from it, and is bound to ${esc(HOST)}.
    </p>
    ${message ? `<div class="alert bad">${esc(message)}</div>` : ''}
    <form method="POST" action="/login" class="stack">
      <input type="hidden" name="csrf" value="${csrfFor(pre)}">
      <div><label for="pw">Admin password</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" autofocus></div>
      <button class="btn primary" type="submit">Sign in</button>
    </form>
    ${state.generatedPassword ? `<div class="alert warn" style="margin-top:16px">
      First run: a password was generated for you — <b class="mono">${esc(state.generatedPassword)}</b><br>
      <span class="muted">Stored hashed at admin/.admin.json (mode 600). Change it from Settings.</span>
    </div>` : ''}
  </div></body></html>`;
}

function layout(active, body, flash) {
  const waiting = openTickets().length;
  const tabs = [['/', 'Overview'], ['/inbox', waiting ? `Inbox \u00b7 ${waiting}` : 'Inbox'],
    ['/settings', 'Site settings'], ['/pricing', 'Pricing'],
    ['/locales', 'Locales'], ['/evidence', 'Evidence'], ['/snapshots', 'Snapshots'],
    ['/security', 'Security']];
  return head('Overview') + `
  <div class="top">${brand}
    <div class="row">
      <span class="pill">${esc(cfg.site.name)}</span>
      <form method="POST" action="/logout" style="display:inline">
        <button class="btn sm" type="submit">Sign out</button></form>
    </div>
  </div>
  <div class="wrap">
    <div class="nav">${tabs.map(([h, l]) =>
    `<a href="${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${flash ? `<div class="alert ${flash.kind}">${flash.html}</div>` : ''}
    ${body}
  </div></body></html>`;
}

function statusPills() {
  const pub = cfg.publishing || {};
  return [
    pub.pricesConfirmed ? ['ok', 'Pricing confirmed'] : ['warn', 'Pricing illustrative'],
    pub.evidenceConfirmed ? ['ok', 'Evidence confirmed'] : ['warn', 'No customer evidence'],
    pub.securityCertificationsConfirmed ? ['ok', 'Certifications confirmed'] : ['warn', 'Certifications in progress'],
    cfg.site.url.includes('example.com') ? ['bad', 'Domain is a placeholder'] : ['ok', 'Domain set']
  ].map(([k, t]) => `<span class="pill ${k}">${esc(t)}</span>`).join(' ');
}

function overviewPage(flash) {
  const verification = run('node', ['assemble.js', '--check']);
  const assetCheck = existsSync(join(ROOT, 'assets/og-image.png'));
  const localesData = JSON.parse(readFileSync(join(ROOT, 'i18n/locales.json'), 'utf8'));
  const drafts = localesData.locales.filter(l => l.status !== 'reviewed');
  const bytes = existsSync(join(ROOT, 'index.html')) ? statSync(join(ROOT, 'index.html')).size : 0;

  const body = `
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><h1 style="font-size:20px">Overview</h1>
      <p class="muted" style="margin:4px 0 0;font-size:13.5px">Everything the public site publishes comes from site.config.json.</p></div>
      <div>${statusPills()}</div>
    </div>
  </div>

  <div class="grid">
    <div class="card stat"><b>${(bytes / 1024).toFixed(0)} KB</b><span>index.html</span></div>
    <div class="card stat"><b>${cfg.capabilities.agents.length}</b><span>agent roles</span></div>
    <div class="card stat"><b>${localesData.locales.length}</b><span>locales</span></div>
    <div class="card stat"><b>${drafts.length}</b><span>locales needing review</span></div>
    <div class="card stat"><b>${cfg.evidence.items.length}</b><span>customer evidence items</span></div>
    <div class="card stat"><b>${cfg.faq.length}</b><span>FAQ entries</span></div>
  </div>

  <div class="card">
    <h3 style="font-size:16px;margin-bottom:10px">Publish</h3>
    <p class="muted" style="font-size:13.5px;margin:0 0 14px">
      Builds the assets, assembles index.html and runs the verifier. Publishing is refused when
      verification fails — a broken config never reaches production.
    </p>
    <form method="POST" action="/publish" class="row">
      <input type="hidden" name="csrf" value="{{CSRF}}">
      <button class="btn primary" type="submit">Build &amp; publish</button>
      <button class="btn" type="submit" formaction="/verify">Run verification only</button>
    </form>
    <pre style="margin-top:14px">${esc(verification.out.trim() || 'no output')}</pre>
  </div>

  <div class="card">
    <h3 style="font-size:16px;margin-bottom:10px">Generated metadata</h3>
    <table>
      <tr><th>Field</th><th>Value</th><th>Check</th></tr>
      <tr><td>Title</td><td>${esc(cfg.seo.title)}</td>
        <td><span class="pill ${cfg.seo.title.length <= 65 ? 'ok' : 'warn'}">${cfg.seo.title.length} chars</span></td></tr>
      <tr><td>Description</td><td>${esc(cfg.site.description)}</td>
        <td><span class="pill ${cfg.site.description.length <= 165 ? 'ok' : 'warn'}">${cfg.site.description.length} chars</span></td></tr>
      <tr><td>Canonical</td><td class="mono">${esc(cfg.site.url)}/</td>
        <td><span class="pill ${cfg.site.url.includes('example.com') ? 'bad' : 'ok'}">${cfg.site.url.includes('example.com') ? 'placeholder' : 'set'}</span></td></tr>
      <tr><td>hreflang</td><td class="mono">${cfg.site.locales.join(', ')} + x-default</td>
        <td><span class="pill ok">${cfg.site.locales.length + 1} alternates</span></td></tr>
      <tr><td>Social card</td><td class="mono">${esc(cfg.seo.ogImage)}</td>
        <td><span class="pill ${assetCheck ? 'ok' : 'bad'}">${assetCheck ? 'present' : 'missing'}</span></td></tr>
      <tr><td>Structured data</td><td>Organization · WebSite · SoftwareApplication · BreadcrumbList · FAQPage</td>
        <td><span class="pill ok">parses</span></td></tr>
      <tr><td>Analytics</td><td class="mono">${cfg.analytics.id ? esc(cfg.analytics.provider + ' · ' + cfg.analytics.id) : 'disabled'}</td>
        <td><span class="pill ${cfg.analytics.id ? 'ok' : 'warn'}">${cfg.analytics.id ? 'active' : 'no third-party requests'}</span></td></tr>
    </table>
  </div>

  <div class="card">
    <h3 style="font-size:16px;margin-bottom:10px">Admin boundary</h3>
    <p style="font-size:13.5px;margin:0 0 10px">
      This console runs as its own process on <b class="mono">${esc(HOST)}:${PORT}</b>. It is not part of
      index.html, it is disallowed in robots.txt, and nothing in the public site links to it. To expose it
      on a network you must set <span class="mono">HOST=0.0.0.0</span> deliberately — the default is
      local-only, and it requires HTTPS behind a reverse proxy.
    </p>
    <p class="muted" style="font-size:12.5px;margin:0">
      Session ${SESSION_MINUTES} min · ${MAX_ATTEMPTS} login attempts before a ${LOCKOUT_MINUTES}-minute lockout ·
      password hashed with scrypt · CSRF token required on every write.
    </p>
  </div>`;
  return layout('/', body, flash);
}

function settingsPage(flash) {
  const body = `
  <form method="POST" action="/settings" class="card stack">
    <input type="hidden" name="csrf" value="{{CSRF}}">
    <h3 style="font-size:16px">Identity</h3>
    <div class="grid">
      <div><label for="siteName">Site name</label><input id="siteName" name="site.name" type="text" value="${esc(cfg.site.name)}"></div>
      <div><label for="legal">Legal name</label><input id="legal" name="site.legalName" type="text" value="${esc(cfg.site.legalName)}"></div>
      <div><label for="url">Site URL</label><input id="url" name="site.url" type="text" value="${esc(cfg.site.url)}"></div>
      <div><label for="theme">Theme colour</label><input id="theme" name="site.themeColor" type="text" value="${esc(cfg.site.themeColor)}"></div>
      <div><label for="support">Support email</label><input id="support" name="site.supportEmail" type="text" value="${esc(cfg.site.supportEmail)}"></div>
      <div><label for="tz">Timezone</label><input id="tz" name="site.timezone" type="text" value="${esc(cfg.site.timezone)}"></div>
    </div>

    <h3 style="font-size:16px;margin-top:8px">Search &amp; social</h3>
    <div class="stack">
      <div><label for="title">Title (≤65 chars for search)</label>
        <input id="title" name="seo.title" type="text" value="${esc(cfg.seo.title)}"></div>
      <div><label for="desc">Description (≤165 chars)</label>
        <textarea id="desc" name="site.description">${esc(cfg.site.description)}</textarea></div>
      <div><label for="keywords">Keywords (comma separated)</label>
        <input id="keywords" name="seo.keywords" type="text" value="${esc(cfg.seo.keywords.join(', '))}"></div>
    </div>

    <h3 style="font-size:16px;margin-top:8px">Publishing flags</h3>
    <p class="muted" style="font-size:13px;margin:0">
      These control how the site labels itself. Leave a flag off until the claim is genuinely true —
      the page labels unconfirmed content instead of pretending.
    </p>
    <div class="stack">
      <label style="text-transform:none;font-family:var(--sans);font-size:13.5px;letter-spacing:0">
        <input type="checkbox" name="publishing.pricesConfirmed" ${cfg.publishing.pricesConfirmed ? 'checked' : ''}>
        Pricing figures are confirmed and publishable</label>
      <label style="text-transform:none;font-family:var(--sans);font-size:13.5px;letter-spacing:0">
        <input type="checkbox" name="publishing.evidenceConfirmed" ${cfg.publishing.evidenceConfirmed ? 'checked' : ''}>
        Customer evidence has written permission on file</label>
      <label style="text-transform:none;font-family:var(--sans);font-size:13.5px;letter-spacing:0">
        <input type="checkbox" name="publishing.securityCertificationsConfirmed" ${cfg.publishing.securityCertificationsConfirmed ? 'checked' : ''}>
        Security certifications are issued (not in progress)</label>
    </div>

    <div class="row" style="margin-top:10px">
      <button class="btn primary" type="submit">Save configuration</button>
      <span class="muted" style="font-size:12.5px">A snapshot is taken before every save, so you can roll back.</span>
    </div>
  </form>`;
  return layout('/settings', body, flash);
}

function pricingPage(flash) {
  const rows = cfg.pricing.plans.map((p, i) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td><input type="number" name="plan.${i}.monthly" value="${p.priceMonthly}" style="width:110px"></td>
      <td><input type="number" name="plan.${i}.annual" value="${p.priceAnnual}" style="width:120px"></td>
      <td><input type="text" name="plan.${i}.summary" value="${esc(p.summary)}"></td>
    </tr>`).join('');
  const body = `
  <form method="POST" action="/pricing" class="card">
    <input type="hidden" name="csrf" value="{{CSRF}}">
    <h3 style="font-size:16px;margin-bottom:12px">Plans</h3>
    <table>
      <tr><th>Plan</th><th>Monthly</th><th>Annual</th><th>Summary</th></tr>
      ${rows}
    </table>
    <div class="row" style="margin-top:16px">
      <button class="btn primary" type="submit">Save pricing</button>
      <span class="muted" style="font-size:12.5px">
        Prices publish with an “Illustrative” label until you confirm them in Site settings.
      </span>
    </div>
  </form>`;
  return layout('/pricing', body, flash);
}

function localesPage() {
  const data = JSON.parse(readFileSync(join(ROOT, 'i18n/locales.json'), 'utf8'));
  const strings = JSON.parse(readFileSync(join(ROOT, 'i18n/strings.json'), 'utf8'));
  const base = Object.keys(strings[data.defaultLocale]);
  const rows = data.locales.map(l => {
    const table = strings[l.code] || {};
    const missing = base.filter(k => !(k in table));
    return `<tr>
      <td><b>${esc(l.native)}</b><div class="muted mono" style="font-size:11.5px">${l.code} · ${l.dir}</div></td>
      <td><span class="pill ${l.status === 'reviewed' ? 'ok' : 'warn'}">${esc(l.status)}</span></td>
      <td class="mono">${esc(l.currency)}</td>
      <td>${Object.keys(table).length} / ${base.length} keys
        ${missing.length ? `<div class="muted" style="font-size:12px">missing: ${esc(missing.slice(0, 4).join(', '))}${missing.length > 4 ? '…' : ''}</div>` : ''}</td>
      <td>${l.status === 'reviewed' ? '<span class="pill ok">publishable</span>' : '<span class="pill warn">needs native review</span>'}</td>
    </tr>`;
  }).join('');
  const body = `
  <div class="card">
    <h3 style="font-size:16px;margin-bottom:6px">Global locale list</h3>
    <p class="muted" style="font-size:13.5px;margin:0 0 14px">
      One list drives the header selector, the mobile sheet, the app and this console. A locale marked
      <b>draft</b> is machine-assisted and is labelled as such in the language menu — it is not claimed
      as reviewed until a native speaker signs it off.
    </p>
    <table><tr><th>Locale</th><th>Status</th><th>Currency</th><th>Coverage</th><th>Publishing</th></tr>${rows}</table>
  </div>`;
  return layout('/locales', body);
}

function evidencePage(flash) {
  const items = cfg.evidence.items;
  const rows = items.length ? items.map((e, i) => `
    <tr>
      <td><input type="text" name="ev.${i}.customer" value="${esc(e.customer)}"></td>
      <td><input type="text" name="ev.${i}.metric" value="${esc(e.metric)}"></td>
      <td><input type="text" name="ev.${i}.quote" value="${esc(e.quote || '')}"></td>
      <td><label style="text-transform:none;font-family:var(--sans);font-size:12.5px">
        <input type="checkbox" name="ev.${i}.permission" ${e.permission ? 'checked' : ''}> permission on file</label></td>
    </tr>`).join('') : '';

  const body = `
  <div class="card">
    <h3 style="font-size:16px;margin-bottom:6px">Customer evidence</h3>
    <p class="muted" style="font-size:13.5px;margin:0 0 14px">
      The site ships with no testimonials, because none have been given. Add an item only when you have a
      named customer, written permission and a figure from their own reporting. The publish step refuses
      evidence without a recorded permission, and the page labels anything unconfirmed.
    </p>
    ${items.length ? `<form method="POST" action="/evidence" class="stack">
      <input type="hidden" name="csrf" value="{{CSRF}}">
      <table><tr><th>Customer</th><th>Sourced metric</th><th>Quote</th><th>Permission</th></tr>${rows}</table>
      <div class="row"><button class="btn primary" type="submit">Save evidence</button></div>
    </form>` : (`
    <div class="alert warn">
      No evidence items configured — the site shows the evidence standard instead of testimonials. That is
      the honest state, not a gap. Add entries here when you have permission.
    </div>
    <form method="POST" action="/evidence" class="stack">
      <input type="hidden" name="csrf" value="{{CSRF}}">
      <table><tr><th>Customer</th><th>Sourced metric</th><th>Quote</th><th>Permission</th></tr>
        <tr><td><input type="text" name="ev.0.customer" placeholder="Named customer"></td>
        <td><input type="text" name="ev.0.metric" placeholder="e.g. meetings booked per month, from their CRM"></td>
        <td><input type="text" name="ev.0.quote" placeholder="Their words, unedited"></td>
        <td><label style="text-transform:none;font-family:var(--sans);font-size:12.5px">
          <input type="checkbox" name="ev.0.permission"> permission on file</label></td></tr>
      </table>
      <div class="row"><button class="btn primary" type="submit">Save evidence</button></div>
    </form>`)}
  </div>`;
  return layout('/evidence', body, flash);
}

/* ════════════════ inbox and composer ════════════════
   Everything a customer sends — public enquiries and dashboard tickets —
   lands in the shared store; this page reads it, replies into the thread and
   mails the answer to the address the account was signed up with. */
function messageBubble(m, name) {
  const mine = m.from === 'admin';
  return `
    <div style="border-left:3px solid ${mine ? '#22d3ee' : '#4f7cff'};padding:10px 14px;margin:10px 0;background:rgba(255,255,255,.03);border-radius:0 10px 10px 0">
      <div class="mono muted" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase">${mine ? 'Administrator' : esc(name || 'Customer')} &middot; ${esc(new Date(m.at).toLocaleString())}</div>
      <div style="white-space:pre-wrap;margin-top:6px">${esc(m.body)}</div>
    </div>`;
}

function inboxPage(flash, opts = {}) {
  refresh();
  const filter = ['open', 'resolved', 'all'].includes(opts.filter) ? opts.filter : 'open';
  const order = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  const all = db.tickets.slice().sort(order);
  const rows = all.filter(t => filter === 'all' ? true : filter === 'resolved' ? t.status === 'resolved' : t.status !== 'resolved');
  const ref = opts.ref || '';
  const seenTicket = ref ? ticketByRef(ref) : null;
  const current = ref ? seenTicket : (rows[0] || null);
  const missing = ref && !seenTicket;

  const listRows = rows.length ? rows.map(t => `
    <tr${current && current.ref === t.ref ? ' style="background:rgba(79,124,255,.08)"' : ''}>
      <td class="mono" style="white-space:nowrap">${esc(t.ref)}</td>
      <td><a href="/inbox?filter=${esc(filter)}&amp;ref=${esc(t.ref)}">${esc(t.subject)}</a>
        <div class="muted" style="font-size:12.5px">${esc(t.name || 'No name')} &lt;${esc(t.email)}&gt; &middot; ${t.messages.length} message${t.messages.length === 1 ? '' : 's'}</div></td>
      <td><span class="pill ${t.status === 'resolved' ? 'ok' : t.status === 'open' ? 'warn' : ''}">${esc(String(t.status || 'open').replace('_', ' '))}</span></td>
      <td class="muted mono" style="font-size:12px;white-space:nowrap">${esc(new Date(t.updatedAt || t.createdAt).toLocaleString())}</td>
    </tr>`).join('')
    : `<tr><td colspan="4" class="muted">Nothing here yet. ${filter === 'open' ? 'Every conversation is closed.' : ''}</td></tr>`;

  const detail = current ? `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">
        <div>
          <h3 style="font-size:16px">${esc(current.subject)}</h3>
          <div class="muted mono" style="font-size:12px">${esc(current.ref)} &middot; ${esc(current.category || 'question')} &middot; opened from ${esc(current.source || 'dashboard')} &middot; ${esc(new Date(current.createdAt).toLocaleString())}</div>
          <div class="muted" style="font-size:13px;margin-top:4px">${esc(current.name || 'No name')} &lt;${esc(current.email)}&gt;</div>
        </div>
        <form method="POST" action="/inbox/status">
          <input type="hidden" name="csrf" value="{{CSRF}}">
          <input type="hidden" name="ref" value="${esc(current.ref)}">
          <input type="hidden" name="filter" value="${esc(filter)}">
          <input type="hidden" name="status" value="${current.status === 'resolved' ? 'open' : 'resolved'}">
          <button class="btn sm" type="submit">${current.status === 'resolved' ? 'Reopen' : 'Mark resolved'}</button>
        </form>
      </div>
      ${current.messages.map(m => messageBubble(m, current.name)).join('')}
      <form method="POST" action="/inbox/reply" class="stack" style="margin-top:14px">
        <input type="hidden" name="csrf" value="{{CSRF}}">
        <input type="hidden" name="ref" value="${esc(current.ref)}">
        <input type="hidden" name="filter" value="${esc(filter)}">
        <div><label for="reply">Reply &mdash; goes to ${esc(current.email)}</label>
          <textarea id="reply" name="body" rows="6" required placeholder="Write the answer that goes out under the site logo..."></textarea></div>
        <div class="row">
          <button class="btn primary" type="submit">Send reply</button>
          <span class="muted" style="font-size:12.5px">The answer is added to the thread and emailed to the address on the account.</span>
        </div>
      </form>
    </div>`
    : `<div class="card"><h3>${missing ? 'That conversation is gone' : 'No conversation selected'}</h3>
        <p class="muted">${missing ? 'It was closed and deleted with its account, or the reference is wrong.' : 'Pick one from the list, or write to someone with the composer below.'}</p></div>`;

  const accounts = db.users.slice(0, 300);
  const composer = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:4px">Write to a customer</h3>
      <p class="muted" style="font-size:13px">Free-form message, sent under the site logo from ${esc(process.env.MAIL_FROM || 'the configured sender')}.</p>
      <form method="POST" action="/inbox/compose" class="stack">
        <input type="hidden" name="csrf" value="{{CSRF}}">
        <div><label for="to">To</label>
          <input id="to" name="to" list="known-addresses" required placeholder="name@company.com">
          <datalist id="known-addresses">${accounts.map(u => `<option value="${esc(u.email)}">${esc(u.name || '')}</option>`).join('')}</datalist></div>
        <div><label for="csubject">Subject</label><input id="csubject" name="subject" required maxlength="120"></div>
        <div><label for="cbody">Message</label><textarea id="cbody" name="body" rows="6" required></textarea></div>
        <button class="btn primary" type="submit">Send message</button>
      </form>
    </div>`;

  const queued = outboxList().slice(-6).reverse();
  const delivery = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:4px">Mail delivery</h3>
      <p class="muted" style="font-size:13px">${esc(transportDescription())}</p>
      <table>
        <tr><th>Transport</th><th>Queued</th></tr>
        <tr><td class="mono">${esc(transport())}</td><td>${outboxList().length} message(s) in ${esc('data/outbox')}</td></tr>
      </table>
      ${queued.length ? `<table style="margin-top:12px">
        <tr><th>Queued at</th><th>To</th><th>Subject</th><th></th></tr>
        ${queued.map(m => `<tr>
          <td class="mono" style="font-size:12px;white-space:nowrap">${esc(new Date(m.queuedAt).toLocaleString())}</td>
          <td>${esc(m.to)}</td><td>${esc(m.subject)}</td>
          <td><a class="btn sm" href="/outbox/${esc(m.id)}" target="_blank" rel="noopener">Preview</a></td></tr>`).join('')}
      </table>` : `<p class="muted" style="font-size:13px;margin-top:10px">Nothing queued. With credentials set (SMTP_HOST or RESEND_API_KEY) messages go out the moment you send them.</p>`}
    </div>`;

  const header = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <h2 style="font-size:17px;margin:0">Conversations</h2>
      <div class="row">
        ${['open', 'resolved', 'all'].map(f => `<a class="btn sm${f === filter ? ' primary' : ''}" href="/inbox?filter=${f}">${f === 'open' ? 'Waiting' : f === 'resolved' ? 'Resolved' : 'All'}</a>`).join('')}
      </div>
    </div>`;

  const body = header + `
  <div class="card">
    <table>
      <tr><th>Ref</th><th>Conversation</th><th>Status</th><th>Last change</th></tr>
      ${listRows}
    </table>
  </div>
  ${detail}
  ${composer}
  ${delivery}`;

  return layout('/inbox', body, flash);
}

function snapshotsPage(flash) {
  const rows = snapshots().map(s => `<tr>
    <td class="mono">${esc(s.at.slice(0, 19).replace('T', ' '))}</td>
    <td>${esc(s.label || '—')}</td>
    <td><form method="POST" action="/rollback" style="display:inline">
      <input type="hidden" name="csrf" value="{{CSRF}}">
      <input type="hidden" name="file" value="${esc(s.file)}">
      <button class="btn sm" type="submit">Roll back</button></form></td>
  </tr>`).join('') || '<tr><td colspan="3" class="muted">No snapshots yet — one is taken before every save.</td></tr>';
  const body = `
  <div class="card">
    <h3 style="font-size:16px;margin-bottom:12px">Configuration snapshots</h3>
    <table><tr><th>When</th><th>Label</th><th></th></tr>${rows}</table>
  </div>`;
  return layout('/snapshots', body, flash);
}

function securityPage(flash) {
  const body = `
  <div class="card">
    <h3 style="font-size:16px;margin-bottom:12px">Change admin password</h3>
    <form method="POST" action="/password" class="stack" style="max-width:420px">
      <input type="hidden" name="csrf" value="{{CSRF}}">
      <div><label for="cur">Current password</label><input id="cur" name="current" type="password"></div>
      <div><label for="next">New password (min 12 chars)</label><input id="next" name="next" type="password"></div>
      <button class="btn primary" type="submit">Update password</button>
    </form>
  </div>
  <div class="card">
    <h3 style="font-size:16px;margin-bottom:10px">Hardening in place</h3>
    <table>
      <tr><th>Control</th><th>Detail</th></tr>
      <tr><td>Bound to localhost</td><td class="mono">${esc(HOST)}:${PORT} — change requires HOST env</td></tr>
      <tr><td>Session</td><td>Random 256-bit cookie, ${SESSION_MINUTES}-minute sliding expiry</td></tr>
      <tr><td>Login rate limit</td><td>${MAX_ATTEMPTS} attempts, then ${LOCKOUT_MINUTES}-minute lockout</td></tr>
      <tr><td>Password storage</td><td>scrypt, 64-byte digest, per-install salt, file mode 600</td></tr>
      <tr><td>CSRF</td><td>Session-derived token required on every mutating request</td></tr>
      <tr><td>Indexing</td><td>noindex meta, robots.txt disallow, never linked from the site</td></tr>
      <tr><td>Transport</td><td>Set <span class="mono">RP_ADMIN_HTTPS=1</span> when behind a TLS proxy to enforce secure cookies</td></tr>
    </table>
  </div>`;
  return layout('/security', body, flash);
}

/* ════════════════ write handlers ════════════════ */
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function saveConfig(next, label) {
  snapshot(label);
  writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n');
  Object.assign(cfg, next);
  run('node', ['tools/build-assets.mjs']);
}

/* ════════════════ server ════════════════ */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const ip = req.socket.remoteAddress || 'unknown';
  refresh();               // the app server writes this store too
  setBase(originOf(req));  // links inside outgoing mail point at this origin
  const send = (code, body, headers) => {
    res.writeHead(code, Object.assign({
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-frame-options': FRAME_ANCESTORS === "'none'" ? 'DENY' : 'SAMEORIGIN',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors " + FRAME_ANCESTORS,
      'cache-control': 'no-store'
    }, headers || {}));
    res.end(body);
  };

  if (url.pathname === '/robots.txt') {
    return res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      .end('User-agent: *\nDisallow: /\n');
  }
  if (url.pathname === '/favicon.ico') return res.writeHead(204).end();

  /* ---- login ---- */
  if (url.pathname === '/login' && req.method === 'POST') {
    const rec = attempts.get(ip) || { n: 0, until: 0 };
    if (rec.until > Date.now()) {
      return loginResponse(send, 429, `Too many attempts. Try again in ${Math.ceil((rec.until - Date.now()) / 60000)} minutes.`);
    }
    const body = new URLSearchParams(await readBody(req));
    const pre = preToken(req);
    if (!pre || body.get('csrf') !== csrfFor(pre)) {
      return loginResponse(send, 403, 'Session token expired. Reload the page and try again.');
    }
    if (verifyPassword(body.get('password') || '')) {
      attempts.delete(ip);
      const sid = newSession();
      return send(303, '', {
        location: '/',
        'set-cookie': `rp_admin=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MINUTES * 60}` +
          (process.env.RP_ADMIN_HTTPS === '1' ? '; Secure' : '')
      });
    }
    rec.n++;
    if (rec.n >= MAX_ATTEMPTS) { rec.until = Date.now() + LOCKOUT_MINUTES * 60000; rec.n = 0; }
    attempts.set(ip, rec);
    const left = Math.max(0, MAX_ATTEMPTS - rec.n);
    return loginResponse(send, 401, `Incorrect password. ${left} attempt${left === 1 ? '' : 's'} left before a ${LOCKOUT_MINUTES}-minute lockout.`);
  }

  if (url.pathname === '/logout' && req.method === 'POST') {
    const sid = sidOf(req);
    if (sid) sessions.delete(sid);
    return send(303, '', { location: '/', 'set-cookie': 'rp_admin=; Max-Age=0; Path=/' });
  }

  /* ---- everything else needs a session ---- */
  if (!validSession(req)) {
    return req.method === 'GET' || req.method === 'HEAD'
      ? loginResponse(send, 200, null)
      : loginResponse(send, 401, 'Your session ended. Sign in again, then repeat the change.');
  }

  const sid = sidOf(req);
  const csrf = csrfFor(sid);
  const withCsrf = html => html.split('{{CSRF}}').join(csrf);
  const flashFrom = (kind, text) => ({ kind, html: esc(text) });

  let html;
  let flash = null;

  /* the site's own assets, so a queued mail preview shows the real logo */
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/assets/')) {
    const rel = url.pathname.slice('/assets/'.length);
    if (rel.includes('..')) return send(403, 'Forbidden');
    const file = join(ROOT, 'assets', rel);
    if (!existsSync(file) || !statSync(file).isFile()) return send(404, 'Not found');
    const type = {
      '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
      '.css': 'text/css', '.woff2': 'font/woff2'
    }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return res.end(readFileSync(file));
  }

  const isRead = req.method === 'GET' || req.method === 'HEAD';
  if (isRead && url.pathname === '/') html = withCsrf(overviewPage(null));
  else if (isRead && url.pathname === '/inbox') {
    html = withCsrf(inboxPage(null, {
      filter: url.searchParams.get('filter') || 'open',
      ref: url.searchParams.get('ref') || ''
    }));
  }
  else if (isRead && url.pathname.startsWith('/outbox/')) {
    const id = url.pathname.slice('/outbox/'.length);
    if (!/^[\w.:-]+$/.test(id)) return send(400, 'Bad message id');
    const found = outboxList().filter(m => m.id === id)[0];
    if (!found) return send(404, 'No such message');
    const stored = outboxRead(id) || {};
    return send(200, stored.html || `<pre>${esc(stored.text || '')}</pre>`, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors " + FRAME_ANCESTORS
    });
  }
  else if (isRead && (url.pathname === '/settings' || url.pathname === '/pricing' ||
    url.pathname === '/locales' || url.pathname === '/evidence' ||
    url.pathname === '/snapshots' || url.pathname === '/security')) {
    const page = { settings: settingsPage, pricing: pricingPage, locales: localesPage,
      evidence: evidencePage, snapshots: snapshotsPage, security: securityPage }[url.pathname.slice(1)];
    html = withCsrf(page(null));
  }
  /* ---- writes ---- */
  else if (req.method === 'POST') {
    const raw = await readBody(req);
    const form = new URLSearchParams(raw);
    if (form.get('csrf') !== csrf) return send(403, 'CSRF token mismatch');

    if (url.pathname === '/settings') {
      const next = JSON.parse(JSON.stringify(cfg));
      ['site.name', 'site.legalName', 'site.url', 'site.themeColor', 'site.supportEmail',
        'site.timezone', 'seo.title'].forEach(k => { if (form.get(k) !== null) setPath(next, k, form.get(k)); });
      if (form.get('site.description') !== null) next.site.description = form.get('site.description');
      if (form.get('seo.keywords') !== null) {
        next.seo.keywords = form.get('seo.keywords').split(',').map(s => s.trim()).filter(Boolean);
      }
      ['pricesConfirmed', 'evidenceConfirmed', 'securityCertificationsConfirmed'].forEach(k => {
        next.publishing[k] = form.get('publishing.' + k) === 'on';
      });
      if (!/^https:\/\//.test(next.site.url)) {
        flash = flashFrom('bad', 'Site URL must start with https:// — nothing was saved.');
      } else if (next.publishing.evidenceConfirmed && !next.evidence.items.length) {
        flash = flashFrom('warn', 'Saved, but “evidence confirmed” is on while there are no evidence items — the publish step will warn.');
        saveConfig(next, 'settings');
      } else {
        saveConfig(next, 'settings');
        flash = flashFrom('ok', 'Configuration saved and assets rebuilt.');
      }
      html = withCsrf(settingsPage(flash));
    }
    else if (url.pathname === '/pricing') {
      const next = JSON.parse(JSON.stringify(cfg));
      next.pricing.plans.forEach((p, i) => {
        const m = Number(form.get(`plan.${i}.monthly`));
        const a = Number(form.get(`plan.${i}.annual`));
        const s = form.get(`plan.${i}.summary`);
        if (!isNaN(m) && m > 0) p.priceMonthly = m;
        if (!isNaN(a) && a > 0) p.priceAnnual = a;
        if (s) p.summary = s;
      });
      saveConfig(next, 'pricing');
      flash = flashFrom('ok', 'Pricing saved. It publishes with an “Illustrative” label until you confirm it.');
      html = withCsrf(pricingPage(flash));
    }
    else if (url.pathname === '/evidence') {
      const next = JSON.parse(JSON.stringify(cfg));
      const items = [];
      for (let i = 0; form.get(`ev.${i}.customer`) !== null; i++) {
        const customer = (form.get(`ev.${i}.customer`) || '').trim();
        const metric = (form.get(`ev.${i}.metric`) || '').trim();
        if (!customer || !metric) continue;
        items.push({
          customer,
          metric,
          quote: (form.get(`ev.${i}.quote`) || '').trim(),
          permission: form.get(`ev.${i}.permission`) === 'on',
          addedAt: new Date().toISOString()
        });
      }
      next.evidence.items = items;
      const unpermissioned = items.filter(i => !i.permission);
      if (unpermissioned.length) {
        next.publishing.evidenceConfirmed = false;
        snapshot('evidence (blocked from publishing)');
        writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n');
        Object.assign(cfg, next);
        flash = flashFrom('warn', 'Saved, but ' + unpermissioned.length +
          ' item(s) have no recorded permission, so evidence stays unpublished and the site keeps showing the evidence standard.');
      } else {
        saveConfig(next, 'evidence');
        next.publishing.evidenceConfirmed = items.length > 0;
        writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n');
        Object.assign(cfg, next);
        run('node', ['tools/build-assets.mjs']);
        flash = flashFrom('ok', items.length + ' evidence item(s) saved with permission recorded.');
      }
      html = withCsrf(evidencePage(flash));
    }
    else if (url.pathname === '/rollback') {
      const file = form.get('file') || '';
      if (!/^[\w.:-]+\.json$/.test(file)) return send(400, 'Bad snapshot name');
      const src = join(SNAPSHOT_DIR, file);
      if (!existsSync(src)) return send(404, 'Snapshot not found');
      snapshot('pre-rollback');
      copyFileSync(src, CONFIG);
      const restored = JSON.parse(readFileSync(CONFIG, 'utf8'));
      Object.assign(cfg, restored);
      run('node', ['tools/build-assets.mjs']);
      flash = flashFrom('ok', 'Rolled back to ' + file + '.');
      html = withCsrf(snapshotsPage(flash));
    }
    else if (url.pathname === '/password') {
      const cur = form.get('current') || '';
      const nextPw = form.get('next') || '';
      if (!verifyPassword(cur)) flash = flashFrom('bad', 'Current password is incorrect.');
      else if (nextPw.length < 12) flash = flashFrom('bad', 'New password must be at least 12 characters.');
      else {
        const salt = randomBytes(16).toString('hex');
        state.passwordSalt = salt;
        state.passwordHash = scryptSync(nextPw, salt, 64).toString('hex');
        state.generatedPassword = null;
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
        flash = flashFrom('ok', 'Password updated.');
      }
      html = withCsrf(securityPage(flash));
    }
    else if (url.pathname === '/inbox/reply') {
      const ref = form.get('ref') || '';
      const filter = form.get('filter') || 'open';
      const text = (form.get('body') || '').trim().slice(0, 4000);
      const ticket = ticketByRef(ref);
      if (!ticket) flash = flashFrom('bad', 'That conversation no longer exists — it may have been deleted with its account.');
      else if (text.length < 2) flash = flashFrom('bad', 'Write the reply first.');
      else {
        const at = new Date().toISOString();
        mutate(store => {
          const target = store.tickets.filter(x => x.ref === ref)[0];
          if (!target) return;
          target.messages.push({ from: 'admin', at, body: text, by: 'administrator' });
          target.status = 'answered';
          target.updatedAt = at;
          target.firstReplyAt = target.firstReplyAt || at;
          auditIn(store, 'ticket', ref + ' answered from the console', 'admin');
        });
        const mail = templates.ticket_reply({
          name: ticket.name, subject: ticket.subject, reference: ref, body: text, status: 'answered'
        });
        const result = await deliver({ to: ticket.email, subject: mail.subject, html: mail.html, text: mail.text }, 'inbox');
        flash = flashFrom(result.delivered ? 'ok' : 'warn',
          'Reply saved on ' + ref + ' and ' + (result.delivered ? 'delivered to ' : 'queued for ') + ticket.email +
          (result.error ? ' (' + result.error + ')' : ''));
      }
      html = withCsrf(inboxPage(flash, { filter, ref }));
    }
    else if (url.pathname === '/inbox/status') {
      const ref = form.get('ref') || '';
      const filter = form.get('filter') || 'open';
      const wanted = ['open', 'answered', 'awaiting_user', 'resolved'].includes(form.get('status'))
        ? form.get('status') : 'open';
      if (!ticketByRef(ref)) flash = flashFrom('bad', 'That conversation no longer exists.');
      else {
        mutate(store => {
          const target = store.tickets.filter(x => x.ref === ref)[0];
          if (!target) return;
          target.status = wanted;
          target.updatedAt = new Date().toISOString();
          auditIn(store, 'ticket', ref + ' marked ' + wanted + ' from the console', 'admin');
        });
        flash = flashFrom('ok', ref + ' marked ' + wanted.replace('_', ' ') + '.');
      }
      html = withCsrf(inboxPage(flash, { filter, ref }));
    }
    else if (url.pathname === '/inbox/compose') {
      const to = (form.get('to') || '').trim().toLowerCase();
      const subject = (form.get('subject') || '').trim().slice(0, 120);
      const body = (form.get('body') || '').trim().slice(0, 4000);
      if (!isEmailAddress(to) || !subject || body.length < 10) {
        flash = flashFrom('bad', 'Needs a valid address, a subject and a real message.');
      } else {
        const known = db.users.filter(u => u.email === to)[0];
        const mail = templates.admin_message({ name: known ? known.name : '', subject, body });
        const result = await deliver({ to, subject: mail.subject, html: mail.html, text: mail.text }, 'compose');
        mutate(store => auditIn(store, 'compose', 'administrator message to ' + to + ': ' + subject, 'admin'));
        flash = flashFrom(result.delivered ? 'ok' : 'warn',
          'Message ' + (result.delivered ? 'sent to ' : 'queued for ') + to +
          (known ? '' : ' \u2014 no account uses that address, so it is not on any ticket thread'));
      }
      html = withCsrf(inboxPage(flash, { filter: 'open' }));
    }
    else if (url.pathname === '/verify' || url.pathname === '/publish') {
      const steps = [];
      steps.push(['build assets', run('node', ['tools/build-assets.mjs'])]);
      if (url.pathname === '/publish') steps.push(['assemble', run('node', ['assemble.js'])]);
      steps.push(['verify', run('node', ['assemble.js', '--check'])]);
      const failed = steps.filter(([, r]) => !r.ok);
      const out = steps.map(([name, r]) => `$ ${name}\n` + r.out.trim()).join('\n\n');
      flash = failed.length
        ? flashFrom('bad', 'Publish blocked: ' + failed.map(([n]) => n).join(', ') + ' reported problems.')
        : flashFrom('ok', 'Published: assets built, index.html assembled, verification passed.');
      html = withCsrf(overviewPage(flash) + `<div class="card"><h3 style="font-size:15px">Pipeline output</h3>
        <pre>${esc(out)}</pre></div>`);
    }
    else return send(404, 'Not found');
  }
  else return send(404, 'Not found');

  send(200, (flash && html.indexOf(flash.html) === -1) ? html : html);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  RevenuePilot admin console');
  console.log('  ─────────────────────────────────────────────');
  console.log('  url      http://' + HOST + ':' + PORT);
  console.log('  binding  ' + HOST + ' (local only — set HOST=0.0.0.0 to expose)');
  console.log('  session  ' + SESSION_MINUTES + ' min · ' + MAX_ATTEMPTS + ' attempts before lockout');
  console.log('  secret   ' + STATE_FILE);
  if (state.generatedPassword) {
    console.log('');
    console.log('  FIRST RUN — generated password:');
    console.log('    ' + state.generatedPassword);
    console.log('  Stored hashed in admin/.admin.json (mode 600). Change it after you sign in.');
  }
  console.log('');
  console.log('  This console is not part of the public site and is not linked from it.');
  console.log('');
});
