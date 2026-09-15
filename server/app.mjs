#!/usr/bin/env node
/**
 * RevenuePilot application server.
 *
 *   node server/app.mjs                → http://127.0.0.1:8788
 *   PORT=9000 HOST=0.0.0.0 node server/app.mjs
 *
 * WHAT IT SERVES
 *   · the marketing site itself (index.html, assets, i18n, manifest, robots…)
 *   · /app        the signed-in dashboard: account, agents, tickets, security
 *   · /enquiry    the public enquiry form (works without an account)
 *   · /api/*      accounts, sessions, tickets, notifications
 *
 * WHY THE SITE IS SERVED FROM HERE
 *   Tickets, notifications and email all need an identity. Serving the site and
 *   the API from one origin keeps cookies first-party, keeps CORS out of the
 *   picture, and means the marketing page and the dashboard share one session.
 *   index.html still works on its own (file:// or any static host) — the forms
 *   detect the failure and say so instead of pretending to send.
 *
 * DATA AND SECURITY
 *   · accounts: scrypt (N=16384) with a per-user salt; never a plain password
 *   · sessions: 256-bit random ids, httpOnly + SameSite=Strict cookies, expiry,
 *     revocable, listed per user with device and last-seen
 *   · CSRF: double-submit token on every mutating request
 *   · rate limits: login, registration, password reset and ticket creation
 *   · storage: JSON documents under data/ with atomic writes and 0600 secrets
 *   · nothing is sent to a third party except the mail transport you configure
 *
 * EMAIL
 *   Every notification is rendered from server/templates.mjs so the brand — the
 *   same mark as the site — travels with the message. See server/mailer.mjs for
 *   the transports (SMTP, provider API, or a visible outbox when no credentials
 *   are configured yet).
 */
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';   // the store owns every write: see store.mjs
import { extname, join, normalize } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { send, transport, transportDescription, outboxList, outboxRead, fromAddress } from './mailer.mjs';
import { templates, page, setBase } from './templates.mjs';
import {
  DATA, STORE, OUTBOX, readStore, withStore, statMtime, changedSince, ensureDataDir
} from './store.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = parseInt(process.env.PORT || '8788', 10);
const HOST = process.env.HOST || '127.0.0.1';
const CFG = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));

/* The origin that goes into verify/reset links and branded email footers. The
   configured site.url wins once it is a real domain; until then (and behind a
   proxy) the request tells us where we are, so every link still clicks through. */
const PLACEHOLDER_HOST = /\.example\.(com|org|net)$/i;
function originOf(req) {
  const configured = String(CFG.site.url || '').replace(/\/$/, '');
  if (configured && !PLACEHOLDER_HOST.test(configured)) return configured;
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (!host) return configured;
  const name = host.split(':')[0].replace(/^\[|\]$/g, '');
  const loopback = name === 'localhost' || name === '::1' || name === '0.0.0.0' || /^127\./.test(name);
  const proto = req.headers['x-forwarded-proto'] || (loopback ? 'http' : 'https');
  return proto + '://' + host;
}

const SESSION_MINUTES = parseInt(process.env.SESSION_MINUTES || '43200', 10);   // 30 days

/* ── the admin console on its own hostname ────────────────────────────────────
   The console always runs as its own process: by default it is reachable only
   from the machine it runs on (127.0.0.1:8787, or an SSH tunnel). Hosts that
   give you no shell — a Render web service, for instance — can instead list
   the hostname the console should answer on. Requests that arrive on that
   hostname are passed straight through to the console, which keeps its own
   password, sessions, CSRF tokens and noindex rules. Nothing else changes:
   the site never links to it, and unlisted hostnames never reach it. */
const ADMIN_HOSTS = String(process.env.RP_ADMIN_HOSTS || '')
  .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
const ADMIN_TARGET = 'http://127.0.0.1:' + String(process.env.RP_ADMIN_PORT || 8787);

function proxyToAdmin(req, res) {
  const target = new URL(ADMIN_TARGET);
  const headers = Object.assign({}, req.headers);
  delete headers.host;                                  // the console answers on its own host
  headers['x-forwarded-host'] = String(req.headers.host || '');
  headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] || 'http');
  const upstream = httpRequest({
    host: target.hostname, port: target.port, method: req.method, path: req.url, headers
  }, up => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The admin console is not running on this machine.');
  });
  req.pipe(upstream);
}
const RESET_MINUTES = 30;
const VERIFY_MINUTES = 60;

ensureDataDir();

/* ══════════════════════ one store, two processes ══════════════════════
   The admin console writes ticket replies into this same document from its
   own process, so the app never keeps a private copy for writing. Reads come
   from a snapshot that is re-read whenever the file changes under us, and
   every write runs inside store.mjs's lock against the newest document, so
   neither side can quietly overwrite the other's work. */
let db = readStore();
let seen = statMtime();

/** pull in whatever the admin console (or a restart) wrote before we answer */
function refresh() {
  const m = changedSince(seen);
  if (m) { db = readStore(); seen = m; }
}

/** one mutation: held under the lock, applied to the freshest store */
function mutate(fn) {
  withStore(store => { fn(store); return store; });
  db = readStore();
  seen = statMtime();
}

function auditIn(store, kind, detail, who) {
  store.audit.unshift({ at: new Date().toISOString(), kind, detail, who: who || 'system' });
  store.audit = store.audit.slice(0, 500);
}
const nextRef = store => 'RP-' + (++store.counters.ticket);

/* ════════════════════════════ helpers ════════════════════════════ */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const now = () => Date.now();
const sha = s => createHash('sha256').update(String(s)).digest('hex');
const token = (n = 32) => randomBytes(n).toString('hex');

function hashPassword(password, salt) {
  const s = salt || randomBytes(16).toString('hex');
  return { salt: s, hash: scryptSync(password, s, 64).toString('hex') };
}
function verifyPassword(password, user) {
  if (!user || !user.password) return false;
  const candidate = scryptSync(password, user.password.salt, 64);
  const known = Buffer.from(user.password.hash, 'hex');
  return candidate.length === known.length && timingSafeEqual(candidate, known);
}
const isEmail = s => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(s || '').trim());

function ticketsOf(userId) { return db.tickets.filter(t => t.userId === userId); }
function ticketByRef(ref) { return db.tickets.filter(t => t.ref === ref)[0] || null; }

/* ════════════════════════════ rate limits ════════════════════════════ */
const buckets = new Map();
function limited(key, max, windowMs) {
  const rec = buckets.get(key) || { n: 0, until: 0 };
  if (rec.until && rec.until < now()) { rec.n = 0; rec.until = 0; }
  rec.n++;
  if (rec.n === 1) rec.until = now() + windowMs;
  buckets.set(key, rec);
  return rec.n > max;
}

/* ════════════════════════════ email ════════════════════════════ */
async function deliver(message, context) {
  const result = await send(message);
  mutate(store => auditIn(store, 'email', `${message.subject} → ${message.to} · ${result.transport}${result.delivered ? '' : ' (queued)'}` + (result.error ? ' · ' + result.error : ''), context || 'system'));
  return result;
}

/* ════════════════════════════ http plumbing ════════════════════════════ */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; " +
    /* the real deployment frames nothing; a preview host may set RP_FRAME_ANCESTORS */
    'frame-ancestors ' + (process.env.RP_FRAME_ANCESTORS || "'self'")
};

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const sidOf = req => (cookies(req).rp_sid || '');
function sessionOf(req) {
  const sid = sidOf(req);
  if (!sid) return null;
  const s = db.sessions.filter(x => x.id === sha(sid))[0];
  if (!s) return null;
  if (s.expires < now()) {
    mutate(store => { store.sessions = store.sessions.filter(x => x.id !== s.id); });
    return null;
  }
  return s;
}
const userOf = req => { const s = sessionOf(req); return s ? db.users.filter(u => u.id === s.userId)[0] || null : null; };
const csrfFor = sid => sha('csrf:' + sid + ':' + (process.env.SESSION_PEPPER || 'rp-app'));
const rotatedToken = store => {
  const t = token(24);
  store.push(t);
  return t;
};

function json(res, code, payload, headers) {
  const body = JSON.stringify(payload);
  res.writeHead(code, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }, SECURITY_HEADERS, headers || {}));
  res.end(body);
}
function html(res, code, body, headers) {
  res.writeHead(code, Object.assign({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  }, SECURITY_HEADERS, headers || {}));
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  /* never serve the server, the config internals or stored data */
  if (/^(server|data|admin|node_modules|src)\//.test(safe) || /(^|\/)\./.test(safe)) return false;
  const full = join(ROOT, safe);
  if (!full.startsWith(ROOT) || !existsSync(full) || !statSync(full).isFile()) return false;
  const body = readFileSync(full);
  const ext = extname(full).toLowerCase();
  const immutable = /\.(png|jpg|jpeg|webp|svg|ico|woff2)$/.test(ext);
  res.writeHead(200, Object.assign({
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': immutable ? 'public, max-age=604800' : 'public, max-age=300'
  }, SECURITY_HEADERS));
  res.end(body);
  return true;
}

/* ════════════════════════════ pages ════════════════════════════ */
function signInPage(flash) {
  return page({
    title: 'Sign in',
    description: 'Sign in to your RevenuePilot workspace.',
    nav: false,
    body: `
    <div style="max-width:430px;margin:6vh auto 0">
      <a class="brand" href="/" style="margin-bottom:22px">
        <svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="bm2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#5ae7ff"/><stop offset="55%" stop-color="#6fa8ff"/><stop offset="100%" stop-color="#8a6bff"/></linearGradient></defs>
          <path d="M256 34 470 158v196L256 478 42 354V158Z" fill="none" stroke="url(#bm2)" stroke-width="20" stroke-linejoin="round"/>
          <circle cx="256" cy="292" r="27" fill="url(#bm2)"/></svg> RevenuePilot</a>
      <div class="card">
        <h1 style="font-size:23px">Welcome back</h1>
        <p class="muted">Sign in to your dashboard, tickets and notifications.</p>
        ${flash ? `<div class="notice ${flash.kind}">${esc(flash.text)}</div>` : ''}
        <form method="POST" action="/api/login" id="signinForm" data-api>
          <div class="field"><label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required></div>
          <div class="notice" data-note hidden></div>
          <button class="btn primary" style="width:100%;justify-content:center" type="submit">Sign in</button>
        </form>
        <p class="muted" style="margin-top:14px;font-size:13.5px">
          New here? <a href="#register" data-view="register">Create an account</a> ·
          <a href="#forgot" data-view="forgot">Forgot your password?</a> ·
          <a href="/enquiry">Contact us without an account</a>
        </p>
      </div>

      <div class="card" data-panel="register" hidden>
        <h1 style="font-size:23px">Create your account</h1>
        <p class="muted">One account for tickets, notifications and your workspace. We confirm the address by email before it goes live.</p>
        <form data-api action="/api/register" id="registerForm" autocomplete="on">
          <div class="field"><label for="r-name">Your name</label>
            <input id="r-name" name="name" type="text" autocomplete="name" required maxlength="80"></div>
          <div class="field"><label for="r-email">Work email</label>
            <input id="r-email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="r-pass">Password</label>
            <input id="r-pass" name="password" type="password" autocomplete="new-password" required minlength="12">
            <span class="muted" style="font-size:12.5px">At least 12 characters. A passphrase you can remember beats a short scramble.</span></div>
          <div class="notice" data-note hidden></div>
          <button class="btn primary" style="width:100%;justify-content:center" type="submit">Create account</button>
        </form>
        <p class="muted" style="margin-top:14px;font-size:13.5px">
          Already have an account? <a href="#signin" data-view="signin">Sign in</a>
        </p>
      </div>

      <div class="card" data-panel="forgot" hidden>
        <h1 style="font-size:23px">Reset your password</h1>
        <p class="muted">We send a single-use link to the address on the account. It expires after 30 minutes.</p>
        <form data-api action="/api/password/forgot" id="forgotForm">
          <div class="field"><label for="f-email">Email</label>
            <input id="f-email" name="email" type="email" autocomplete="email" required></div>
          <div class="notice" data-note hidden></div>
          <button class="btn primary" style="width:100%;justify-content:center" type="submit">Email me a reset link</button>
        </form>
        <p class="muted" style="margin-top:14px;font-size:13.5px">
          <a href="#signin" data-view="signin">Back to sign in</a>
        </p>
      </div>

      <div class="card" data-panel="reset" hidden>
        <h1 style="font-size:23px">Choose a new password</h1>
        <p class="muted">Setting a new password signs every device out, including this one.</p>
        <form data-api action="/api/password/reset" id="resetForm">
          <input type="hidden" name="code" id="resetCode" value="">
          <div class="field"><label for="n-pass">New password</label>
            <input id="n-pass" name="password" type="password" autocomplete="new-password" required minlength="12"></div>
          <div class="field"><label for="n-pass2">Repeat it</label>
            <input id="n-pass2" name="confirm" type="password" autocomplete="new-password" required minlength="12"></div>
          <div class="notice" data-note hidden></div>
          <button class="btn primary" style="width:100%;justify-content:center" type="submit">Set the new password</button>
        </form>
      </div>
    </div>`,
    scripts: FORM_SCRIPT
  });
}

/* shared client script for the app pages */
const FORM_SCRIPT = `
(function(){
  var d=document.documentElement;
  try{var s=localStorage.getItem('rp.theme');}catch(e){}
  function paint(t){d.setAttribute('data-theme',t);try{localStorage.setItem('rp.theme',t)}catch(e){}}
  document.querySelectorAll('[data-theme-toggle]').forEach(function(b){
    b.addEventListener('click',function(){paint(d.getAttribute('data-theme')==='light'?'dark':'light')});
  });
  // one page, three states: #signin (default), #register, #forgot, #reset=<code>
  var panels={signin:null,register:null,forgot:null,reset:null};
  Object.keys(panels).forEach(function(k){panels[k]=document.querySelector('[data-panel="'+k+'"]')});
  var signinCard=document.querySelector('#signinForm');
  function show(name){
    Object.keys(panels).forEach(function(k){if(panels[k])panels[k].hidden=(k!==name)});
    if(signinCard)signinCard.closest('.card').hidden=(name!=='signin');
    var target=panels[name]||signinCard;
    if(target){var f=target.querySelector?target.querySelector('input:not([type=hidden])'):null;if(f&&name!=='signin')f.focus();}
  }
  function fromHash(){
    var h=(location.hash||'').replace(/^#/,'');
    var m=/^reset=(.+)$/.exec(h);
    if(m){var box=document.getElementById('resetCode');if(box)box.value=decodeURIComponent(m[1]);show('reset');return;}
    if(h==='register'||h==='forgot'||h==='signin'){show(h);return;}
    show('signin');
  }
  document.querySelectorAll('[data-view]').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();location.hash=a.getAttribute('data-view');});
  });
  window.addEventListener('hashchange',fromHash);
  fromHash();
  var out=document.querySelector('[data-logout]');
  if(out)out.addEventListener('click',function(){fetch('/api/logout',{method:'POST',headers:{'x-csrf':window.RP_CSRF||''}}).then(function(){location.href='/app'})});
  // progressive enhancement: forms post as JSON, and say what happened either way
  document.querySelectorAll('form[data-api]').forEach(function(f){
    f.addEventListener('submit',function(e){
      e.preventDefault();
      var note=f.querySelector('[data-note]');
      var btn=f.querySelector('button[type=submit]');
      var data={};
      new FormData(f).forEach(function(v,k){data[k]=v});
      if(btn){btn.disabled=true;btn.dataset.label=btn.textContent;btn.textContent='Sending…';}
      fetch(f.getAttribute('action'),{method:'POST',headers:{'content-type':'application/json','x-csrf':window.RP_CSRF||''},body:JSON.stringify(data)})
        .then(function(r){return r.json().catch(function(){return {ok:false,error:'Unexpected response'}}).then(function(j){return {status:r.status,j:j}})})
        .then(function(o){
          if(note){note.className='notice '+(o.j.ok?'ok':'bad');note.textContent=o.j.message||o.j.error||(o.j.ok?'Done.':'Something went wrong.');note.hidden=false;}
          if(o.j.ok&&o.j.redirect){location.href=o.j.redirect;return;}
          if(o.j.ok&&o.j.reload){location.reload();return;}
          if(o.j.ok&&o.j.clear){f.reset();}
        })
        .catch(function(){if(note){note.className='notice bad';note.textContent='Could not reach the server. Check your connection and try again.';note.hidden=false;}})
        .then(function(){if(btn){btn.disabled=false;btn.textContent=btn.dataset.label||'Send';}});
    });
  });
})();`;

function dashboardPage(user, flash) {
  const tickets = ticketsOf(user.id).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const sessions = db.sessions.filter(s => s.userId === user.id);
  const agents = (CFG.capabilities && CFG.capabilities.agents) || [];
  const open = tickets.filter(t => t.status !== 'resolved').length;

  const ticketCards = tickets.length ? tickets.map(t => `
    <article class="card" id="t-${esc(t.ref)}">
      <div class="row" style="justify-content:space-between">
        <div>
          <h3 style="font-size:15px">${esc(t.subject)}</h3>
          <div class="muted mono">${esc(t.ref)} · ${esc(t.category)} · updated ${esc(new Date(t.updatedAt).toLocaleString())}</div>
        </div>
        <span class="pill ${t.status === 'resolved' ? 'ok' : t.status === 'awaiting_user' ? 'warn' : ''}">${esc(t.status.replace('_', ' '))}</span>
      </div>
      <div style="margin-top:12px">
        ${t.messages.map(m => `<div class="msg ${m.from === 'user' ? 'me' : 'admin'}">
            <span class="who">${m.from === 'user' ? 'You' : 'RevenuePilot team'} · ${esc(new Date(m.at).toLocaleString())}</span>
            <div style="white-space:pre-wrap">${esc(m.body)}</div></div>`).join('')}
      </div>
      ${t.status === 'resolved' ? '' : `<form data-api action="/api/tickets/${esc(t.ref)}/reply" style="margin-top:6px">
        <div class="field"><label for="r-${esc(t.ref)}">Add to this ticket</label>
        <textarea id="r-${esc(t.ref)}" name="body" rows="3" required placeholder="Add details, or answer the question you were asked…"></textarea></div>
        <div class="notice" data-note hidden></div>
        <button class="btn" type="submit">Send reply</button>
        <span class="muted" style="font-size:13px;margin-left:8px">Our team is notified and replies to your email.</span>
      </form>`}
    </article>`).join('')
    : `<div class="card"><h3>No tickets yet</h3>
        <p class="muted">Tickets are how you reach a person: ask a question, report a problem or request a change. Everything is kept with your account, and replies come to <b>${esc(user.email)}</b>.</p></div>`;

  return page({
    title: 'Dashboard',
    description: 'Your workspace, agents, tickets and security settings.',
    user,
    body: `
    <h1>Welcome, ${esc(user.name || user.email.split('@')[0])}</h1>
    <p class="muted">Signed in as ${esc(user.email)}${user.verified ? '' : ' · <b>email not confirmed yet</b>'} · joined ${esc(new Date(user.createdAt).toLocaleDateString())}</p>
    ${flash ? `<div class="notice ${flash.kind}">${esc(flash.text)}</div>` : ''}
    ${user.verified ? '' : `<div class="notice warn">Confirm your email address to receive ticket replies and receipts.
      ${user.verify ? `<form data-api action="/api/verify/resend" style="display:inline"><button class="btn ghost" type="submit" style="padding:6px 10px">Resend the link</button></form>` : ''}
      <div data-note hidden></div></div>`}

    <div class="tabs">
      <a href="#overview" class="on">Overview</a><a href="#tickets">Tickets ${open ? `<span class="pill warn">${open}</span>` : ''}</a>
      <a href="#agents">Agents</a><a href="#security">Security</a><a href="#privacy">Privacy</a>
    </div>

    <section id="overview" class="grid">
      <div class="card"><h3>Plan</h3>
        <div class="kv">
          <div><span class="muted">Current</span><b>${user.plan === 'trial' ? 'Trial' : esc(user.plan)}</b></div>
          <div><span class="muted">Seats</span><b>1</b></div>
          <div><span class="muted">Card on file</span><b>None</b></div>
          <div><span class="muted">Renews</span><b>—</b></div>
        </div>
      </div>
      <div class="card"><h3>Notifications</h3>
        <div class="kv">
          <div><span class="muted">Ticket replies</span><b class="pill ok">On</b></div>
          <div><span class="muted">Account notices</span><b class="pill ok">On</b></div>
          <div><span class="muted">Product news</span><b class="pill">Off unless you ask</b></div>
          <div><span class="muted">Delivery</span><b>${esc(user.email)}</b></div>
        </div>
        <p class="muted" style="margin-top:10px;font-size:13px">Mail is delivered by ${esc(transportDescription())}.</p>
      </div>
      <div class="card"><h3>Activity</h3>
        <div class="kv">
          ${db.audit.filter(a => a.who === user.email).slice(0, 5).map(a =>
            `<div><span class="muted">${esc(new Date(a.at).toLocaleString())}</span><span>${esc(a.detail)}</span></div>`).join('') ||
            '<div><span class="muted">No activity yet</span></div>'}
        </div>
      </div>
    </section>

    <section id="tickets" style="margin-top:26px">
      <h2>Support tickets</h2>
      <p class="muted">Start a conversation with our team. You keep the thread here, and the reply arrives in your inbox.</p>
      <div class="card">
        <form data-api action="/api/tickets">
          <div class="grid">
            <div class="field"><label for="subject">Subject</label>
              <input id="subject" name="subject" required maxlength="120" placeholder="Short summary"></div>
            <div class="field"><label for="category">Category</label>
              <select id="category" name="category">
                <option value="question">Question</option>
                <option value="problem">Problem</option>
                <option value="billing">Billing</option>
                <option value="data">Data or privacy</option>
                <option value="other">Something else</option>
              </select></div>
          </div>
          <div class="field"><label for="body">Message</label>
            <textarea id="body" name="body" rows="4" required maxlength="4000" placeholder="What happened, what you expected, and anything you have already tried."></textarea></div>
          <div class="notice" data-note hidden></div>
          <button class="btn primary" type="submit">Open ticket</button>
        </form>
      </div>
      ${ticketCards}
    </section>

    <section id="agents" style="margin-top:26px">
      <h2>Your agents</h2>
      <p class="muted">Agent roles come from the same configuration the website publishes. None are deployed on this account yet.</p>
      <div class="card">
        <div class="row">
          ${agents.slice(0, 9).map(a => `<span class="pill">${esc(a.role)}</span>`).join('')}
        </div>
        <p class="muted" style="margin-top:12px;font-size:13.5px">Connect a mailbox and a CRM to deploy one. Until then an agent would have nothing to work on — we would rather say that than show you invented activity.</p>
      </div>
    </section>

    <section id="security" style="margin-top:26px">
      <h2>Security</h2>
      <div class="grid">
        <div class="card">
          <h3>Password</h3>
          <form data-api action="/api/password/change">
            <div class="field"><label for="current">Current password</label>
              <input id="current" name="current" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="next">New password</label>
              <input id="next" name="next" type="password" autocomplete="new-password" required minlength="12">
              <p class="muted" style="font-size:12.5px;margin-top:6px">At least 12 characters. Length beats punctuation.</p></div>
            <div class="notice" data-note hidden></div>
            <button class="btn" type="submit">Change password</button>
          </form>
        </div>
        <div class="card">
          <h3>Active sessions</h3>
          <div class="kv">
            ${sessions.map(s => `<div>
              <span class="muted mono">${esc(s.device || 'Browser')}</span>
              <span>${esc(new Date(s.created).toLocaleString())} · ${s.id === (sessionOf({ headers: { cookie: 'rp_sid=' + (user._sid || '') } }) || {}).id ? 'this device' : 'active'}</span></div>`).join('')}
          </div>
          <form data-api action="/api/sessions/revoke" style="margin-top:12px">
            <div class="notice" data-note hidden></div>
            <button class="btn danger" type="submit" name="all" value="1">Sign out of every device</button>
          </form>
        </div>
      </div>
      <div class="card">
        <h3>How this account is protected</h3>
        <div class="kv">
          <div><span class="muted">Password storage</span><span>scrypt, per-account salt, 64-byte derived key</span></div>
          <div><span class="muted">Session</span><span>256-bit random id, httpOnly, SameSite=Strict, 30 days</span></div>
          <div><span class="muted">Cross-site requests</span><span>CSRF token required on every change</span></div>
          <div><span class="muted">Login throttling</span><span>8 attempts per hour per address</span></div>
          <div><span class="muted">Audit</span><span>every account and support action is logged with a timestamp</span></div>
        </div>
      </div>
    </section>

    <section id="privacy" style="margin-top:26px">
      <h2>Your data</h2>
      <div class="card">
        <p>Export everything we hold about this account, or close it. Closing removes your profile, sessions and tickets from the store immediately.</p>
        <div class="row">
          <a class="btn" href="/api/account/export">Download my data (JSON)</a>
          <form data-api action="/api/account/close" onsubmit="return confirm('Close this account and delete its data?')">
            <button class="btn danger" type="submit">Close my account</button>
          </form>
        </div>
        <div class="notice" data-note hidden style="margin-top:12px"></div>
      </div>
    </section>`,
    scripts: FORM_SCRIPT
  });
}

function enquiryPage(flash) {
  return page({
    title: 'Talk to us',
    description: 'Ask a question, report a problem or request a change. A person replies to your email.',
    body: `
    <div style="max-width:720px">
      <h1>Talk to a person</h1>
      <p>No account needed. Send us what you need and a human replies to your email address — usually within one business day. If you already have an account, tickets you open in the dashboard keep the whole thread together.</p>
      ${flash ? `<div class="notice ${flash.kind}">${esc(flash.text)}</div>` : ''}
      <div class="card">
        <form data-api action="/api/enquiry">
          <div class="grid">
            <div class="field"><label for="name">Your name</label><input id="name" name="name" maxlength="80" required></div>
            <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required></div>
          </div>
          <div class="field"><label for="org">Company (optional)</label><input id="org" name="org" maxlength="80"></div>
          <div class="field"><label for="subject">Subject</label><input id="subject" name="subject" maxlength="120" required></div>
          <div class="field"><label for="category">What is this about?</label>
            <select id="category" name="category">
              <option value="sales">Pricing, plans or a demo</option>
              <option value="support">A problem with the product</option>
              <option value="complaint">A complaint</option>
              <option value="partnership">Partnership or integration</option>
              <option value="security">Security or data question</option>
              <option value="other">Something else</option>
            </select></div>
          <div class="field"><label for="body">Message</label>
            <textarea id="body" name="body" rows="6" maxlength="4000" required placeholder="Include anything that helps us answer properly."></textarea></div>
          <div class="notice" data-note hidden></div>
          <button class="btn primary" type="submit">Send to the team</button>
          <p class="muted" style="font-size:12.5px;margin-top:12px">We store your message to answer it, and email you a reference number. No marketing list, no third parties.</p>
        </form>
      </div>
    </div>`,
    scripts: FORM_SCRIPT
  });
}

/* ════════════════════════════ routes ════════════════════════════ */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const path = url.pathname;
  /* an admin hostname never reaches the public site */
  const hostname = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (ADMIN_HOSTS.length && ADMIN_HOSTS.includes(hostname)) return proxyToAdmin(req, res);

  refresh();   // the admin console may have written since our last request
  const origin = originOf(req);
  setBase(origin);   // emails link back to the origin we are actually reached on
  const ip = req.socket.remoteAddress || 'unknown';
  const bodyOf = async () => {
    const raw = await readBody(req);
    const ct = (req.headers['content-type'] || '');
    if (ct.includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch (e) { return {}; } }
    const form = new URLSearchParams(raw);
    const out = {};
    form.forEach((v, k) => { out[k] = v; });
    return out;
  };
  /* the dashboard script posts JSON; a browser with JavaScript off posts the
     form itself. Both have to end somewhere sensible — never on a JSON body. */
  const nativeForm = !String(req.headers['content-type'] || '').includes('application/json');
  const wantsJson = (req.headers.accept || '').includes('application/json') ||
    (req.headers['content-type'] || '').includes('application/json') ||
    path.startsWith('/api/');
  const respond = (code, payload, flashRedirect) => {
    if (flashRedirect) return html(res, 303, '', { location: flashRedirect });
    if (wantsJson && !nativeForm) return json(res, code, payload);
    if (nativeForm && (payload.message || payload.error)) {
      /* no JavaScript: say what happened, in a page, with a way back */
      return html(res, code, page({
        title: payload.ok ? 'Done' : 'That did not work',
        description: 'A result from an action on the RevenuePilot site.',
        nav: false,
        body: `<div style="max-width:520px;margin:12vh auto 0"><div class="card">
          <h1 style="font-size:21px">${esc(payload.ok ? 'Done' : 'That did not work')}</h1>
          <p class="muted">${esc(payload.message || payload.error)}</p>
          <p style="margin-top:14px"><a class="btn" href="/app">Back to the dashboard</a></p>
        </div></div>`
      }));
    }
    return html(res, code, payload.message || payload.error || 'Done.');
  };
  const clientIp = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : ip;

  try {
    /* ------------------------------------------------ pages */
    if (req.method === 'GET' && (path === '/app' || path === '/dashboard')) {
      const user = userOf(req);
      if (!user) return html(res, 200, signInPage(null));
      const s = sessionOf(req);
      user._sid = sidOf(req);
      void s;
      const csrf = csrfFor(sidOf(req));
      const out = dashboardPage(user, null).replace('</head>', `<script>window.RP_CSRF=${JSON.stringify(csrf)};</script></head>`);
      return html(res, 200, out);
    }
    if (req.method === 'GET' && path === '/enquiry') {
      const csrf = sidOf(req) ? csrfFor(sidOf(req)) : '';
      return html(res, 200, enquiryPage(null).replace('</head>', `<script>window.RP_CSRF=${JSON.stringify(csrf)};</script></head>`));
    }
    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, { ok: true, transport: transport(), users: db.users.length, tickets: db.tickets.length, uptime: process.uptime() });
    }

    /* ------------------------------------------------ public API */
    if (path === '/api/enquiry' && req.method === 'POST') {
      if (limited('enquiry:' + clientIp, 8, 3600e3)) return respond(429, { ok: false, error: 'Too many messages from this address. Try again later.' });
      const b = await bodyOf();
      const name = String(b.name || '').trim().slice(0, 80);
      const email = String(b.email || '').trim().toLowerCase();
      const subject = String(b.subject || '').trim().slice(0, 120);
      const message = String(b.body || '').trim().slice(0, 4000);
      const category = String(b.category || 'other').slice(0, 24);
      if (!name || !isEmail(email) || !subject || message.length < 10) {
        return respond(400, { ok: false, error: 'Please give your name, a valid email, a subject and a message.' });
      }
      /* an enquiry from a registered address attaches to that account's tickets */
      let ref = '';
      mutate(store => {
        const known = store.users.filter(u => u.email === email)[0] || null;
        ref = nextRef(store);
        const at = new Date().toISOString();
        store.tickets.unshift({
          ref, userId: known ? known.id : null, email, name, subject, category,
          status: 'open', createdAt: at, updatedAt: at,
          source: 'web-enquiry',
          messages: [{ from: 'user', at, body: message }]
        });
        auditIn(store, 'enquiry', `${ref} from ${email} · ${category}`, email);
      });

      const ack = templates.enquiry_received({ name, subject, reference: ref });
      await deliver({ to: email, subject: ack.subject, html: ack.html, text: ack.text }, 'enquiry');

      const notice = templates.admin_notice({
        kind: 'Enquiry',
        summary: `New ${category} enquiry · ${ref}`,
        detail: `From: ${name} <${email}>\nSubject: ${subject}\n\n${message}`
      });
      await deliver({ to: (CFG.site.supportEmail || email), subject: notice.subject, html: notice.html, text: notice.text }, 'enquiry');

      return respond(200, {
        ok: true,
        reference: ref,
        message: `Thank you — your message is with the team. Reference ${ref}. A confirmation is on its way to ${email}.`
      });
    }

    if (path === '/api/register' && req.method === 'POST') {
      if (limited('register:' + clientIp, 6, 3600e3)) return respond(429, { ok: false, error: 'Too many sign-up attempts from this address.' });
      const b = await bodyOf();
      const name = String(b.name || '').trim().slice(0, 80);
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      if (!isEmail(email)) return respond(400, { ok: false, error: 'That email address does not look valid.' });
      if (password.length < 12) return respond(400, { ok: false, error: 'Choose a password of at least 12 characters.' });
      if (db.users.some(u => u.email === email)) {
        /* never disclose whether an account exists: the same message either way */
        return respond(200, { ok: true, message: 'If that address can be registered, a confirmation email is on its way.' });
      }
      const verifyCode = token(24);
      const user = {
        id: randomUUID(), name, email, plan: 'trial', verified: false,
        createdAt: new Date().toISOString(),
        password: hashPassword(password),
        verify: { code: verifyCode, expires: now() + VERIFY_MINUTES * 60000 }
      };
      mutate(store => {
        store.users.push(user);
        auditIn(store, 'account', `registered ${email}`, email);
      });

      const link = `${origin}/api/verify?code=${verifyCode}`;
      const v = templates.verify({ name, link, minutes: VERIFY_MINUTES });
      await deliver({ to: email, subject: v.subject, html: v.html, text: v.text }, 'account');

      return respond(200, { ok: true, message: `Account created. Check ${email} for the confirmation link.` });
    }

    if (path === '/api/verify' && req.method === 'GET') {
      const code = String(url.searchParams.get('code') || '');
      const user = db.users.filter(u => u.verify && u.verify.code === code)[0];
      if (!user || user.verify.expires < now()) {
        return html(res, 400, page({
          title: 'Link expired', nav: false,
          body: '<div class="card" style="max-width:560px;margin:8vh auto"><h1>That link has expired</h1><p>Sign in and use “Resend the link”, or contact us and we will confirm it for you.</p><a class="btn primary" href="/app">Go to sign in</a></div>'
        }));
      }
      mutate(store => {
        const u = store.users.filter(x => x.id === user.id)[0];
        if (u) { u.verified = true; delete u.verify; }
        /* the address is proven now: enquiries sent from it before sign-up join this account */
        store.tickets.forEach(t => {
          if (!t.userId && String(t.email).toLowerCase() === user.email) {
            t.userId = user.id; t.claimedAt = new Date().toISOString();
          }
        });
        auditIn(store, 'account', `email confirmed ${user.email}`, user.email);
      });
      const w = templates.welcome({ name: user.name, email: user.email });
      await deliver({ to: user.email, subject: w.subject, html: w.html, text: w.text }, 'account');
      return html(res, 200, page({
        title: 'Email confirmed', nav: false,
        body: `<div class="card" style="max-width:560px;margin:8vh auto"><h1>Email confirmed</h1>
          <p>Thank you — ${esc(user.email)} is now the address we use for ticket replies and account notices.</p>
          <a class="btn primary" href="/app">Open the dashboard</a></div>`
      }));
    }

    if (path === '/api/verify/resend' && req.method === 'POST') {
      const user = userOf(req);
      if (!user) return respond(401, { ok: false, error: 'Sign in first.' });
      if (user.verified) return respond(200, { ok: true, message: 'That address is already confirmed.' });
      const code = token(24);
      mutate(store => {
        const u = store.users.filter(x => x.id === user.id)[0];
        if (u) u.verify = { code, expires: now() + VERIFY_MINUTES * 60000 };
      });
      const link = `${origin}/api/verify?code=${code}`;
      const v = templates.verify({ name: user.name, link, minutes: VERIFY_MINUTES });
      const r = await deliver({ to: user.email, subject: v.subject, html: v.html, text: v.text }, 'account');
      return respond(200, { ok: true, message: r.delivered ? 'Sent — check your inbox.' : 'Queued: ' + (r.note || 'no mail transport configured yet.') });
    }

    if (path === '/api/login' && req.method === 'POST') {
      if (limited('login:' + clientIp, 8, 3600e3)) return respond(429, { ok: false, error: 'Too many sign-in attempts. Try again in an hour.' });
      const b = await bodyOf();
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      const user = db.users.filter(u => u.email === email)[0];
      if (!user || !verifyPassword(password, user)) {
        mutate(store => auditIn(store, 'security', `failed sign-in for ${email}`, email));
        if (nativeForm) return html(res, 401, signInPage({ kind: 'bad', text: 'Those details do not match an account.' }));
        return respond(401, { ok: false, error: 'Those details do not match an account.' });
      }
      const sid = token(32);
      const device = String(req.headers['user-agent'] || 'Browser').slice(0, 120);
      mutate(store => {
        store.sessions.push({
          id: sha(sid), userId: user.id, created: now(), expires: now() + SESSION_MINUTES * 60000,
          device, ip: clientIp
        });
        store.sessions = store.sessions.slice(-200);
        auditIn(store, 'security', `signed in ${email}`, email);
      });
      const secure = process.env.RP_SECURE_COOKIES === '1' ? '; Secure' : '';
      const cookie = `rp_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MINUTES * 60}${secure}`;
      if (nativeForm) return html(res, 303, '', { location: '/app', 'set-cookie': cookie });
      return json(res, 200, { ok: true, redirect: '/app' }, { 'set-cookie': cookie });
    }

    if (path === '/api/logout' && req.method === 'POST') {
      const sid = sidOf(req);
      if (sid) mutate(store => { store.sessions = store.sessions.filter(s => s.id !== sha(sid)); });
      return json(res, 200, { ok: true, redirect: '/app' }, {
        'set-cookie': 'rp_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
      });
    }

    if (path === '/api/password/forgot' && req.method === 'POST') {
      if (limited('forgot:' + clientIp, 5, 3600e3)) return respond(429, { ok: false, error: 'Too many requests. Try again later.' });
      const b = await bodyOf();
      const email = String(b.email || '').trim().toLowerCase();
      const user = db.users.filter(u => u.email === email)[0];
      if (user) {
        const code = token(24);
        mutate(store => {
          const u = store.users.filter(x => x.id === user.id)[0];
          if (u) u.reset = { code, expires: now() + RESET_MINUTES * 60000 };
        });
        const link = `${origin}/app#reset=${code}`;
        const r = templates.password_reset({ name: user.name, link, minutes: RESET_MINUTES });
        await deliver({ to: user.email, subject: r.subject, html: r.html, text: r.text }, 'account');
      }
      return respond(200, { ok: true, message: 'If that address has an account, a reset link is on its way.' });
    }

    if (path === '/api/password/reset' && req.method === 'POST') {
      if (limited('reset:' + clientIp, 6, 3600e3)) return respond(429, { ok: false, error: 'Too many attempts. Try again in an hour.' });
      const b = await bodyOf();
      const code = String(b.code || '').trim();
      const password = String(b.password || '');
      const confirm = b.confirm === undefined ? password : String(b.confirm);
      if (password.length < 12) return respond(400, { ok: false, error: 'Choose a password of at least 12 characters.' });
      if (password !== confirm) return respond(400, { ok: false, error: 'The two passwords do not match.' });
      const user = db.users.filter(u => u.reset && u.reset.code === code)[0];
      if (!user || !user.reset.expires || user.reset.expires < now()) {
        return respond(400, { ok: false, error: 'That reset link has expired or was already used. Request a new one.' });
      }
      const fresh = hashPassword(password);
      mutate(store => {
        const u = store.users.filter(x => x.id === user.id)[0];
        if (u) { u.password = fresh; delete u.reset; u.verified = true; }
        store.sessions = store.sessions.filter(s => s.userId !== user.id);
        auditIn(store, 'security', `password reset for ${user.email}`, user.email);
      });
      const notice = templates.password_changed({ name: user.name, email: user.email, via: 'Reset link' });
      await deliver({ to: user.email, subject: notice.subject, html: notice.html, text: notice.text }, 'account');
      return respond(200, { ok: true, redirect: '/app', message: 'Password set. Sign in with the new one.' });
    }

    /* ------------------------------------------------ authenticated API */
    const user = userOf(req);
    const mutating = req.method === 'POST' || req.method === 'DELETE';
    if (path.startsWith('/api/') && mutating && path !== '/api/login' && path !== '/api/register' && path !== '/api/enquiry' && path !== '/api/password/forgot' && path !== '/api/password/reset') {
      if (!user) return respond(401, { ok: false, error: 'Your session ended. Sign in again.' });
      const sid = sidOf(req);
      const sent = req.headers['x-csrf'] || (await bodyOf()).csrf;
      if (!sent || sent !== csrfFor(sid)) return respond(403, { ok: false, error: 'Security token mismatch. Reload the page and try again.' });
    }

    if (path === '/api/me' && req.method === 'GET') {
      if (!user) return json(res, 401, { ok: false, error: 'Not signed in' });
      return json(res, 200, {
        ok: true,
        user: { name: user.name, email: user.email, verified: !!user.verified, plan: user.plan, createdAt: user.createdAt },
        tickets: ticketsOf(user.id).map(t => ({ ref: t.ref, subject: t.subject, status: t.status, messages: t.messages.length }))
      });
    }

    if (path === '/api/tickets' && req.method === 'POST') {
      if (limited('ticket:' + user.email, 12, 3600e3)) return respond(429, { ok: false, error: 'You have opened several tickets in the last hour. Add to an existing one instead.' });
      const b = await bodyOf();
      const subject = String(b.subject || '').trim().slice(0, 120);
      const message = String(b.body || '').trim().slice(0, 4000);
      const category = String(b.category || 'question').slice(0, 24);
      if (!subject || message.length < 5) return respond(400, { ok: false, error: 'Give the ticket a subject and a message.' });
      let ref = '';
      mutate(store => {
        ref = nextRef(store);
        const at = new Date().toISOString();
        store.tickets.unshift({
          ref, userId: user.id, email: user.email, name: user.name, subject, category,
          status: 'open', createdAt: at, updatedAt: at,
          source: 'dashboard', messages: [{ from: 'user', at, body: message }]
        });
        auditIn(store, 'ticket', `${ref} opened: ${subject}`, user.email);
      });
      const ack = templates.ticket_created({ name: user.name, subject, reference: ref, body: message });
      await deliver({ to: user.email, subject: ack.subject, html: ack.html, text: ack.text }, 'ticket');
      const notice = templates.admin_notice({
        kind: 'Ticket', summary: `New ticket · ${ref}`,
        detail: `From: ${user.name || user.email} <${user.email}>\nSubject: ${subject}\nCategory: ${category}\n\n${message}`
      });
      await deliver({ to: CFG.site.supportEmail || user.email, subject: notice.subject, html: notice.html, text: notice.text }, 'ticket');
      return respond(200, { ok: true, reference: ref, reload: true, message: `Ticket ${ref} opened. A copy is on its way to ${user.email}.` });
    }

    const replyMatch = /^\/api\/tickets\/(RP-\d+)\/reply$/.exec(path);
    if (replyMatch && req.method === 'POST') {
      const t = ticketByRef(replyMatch[1]);
      if (!t || t.userId !== user.id) return respond(404, { ok: false, error: 'That ticket is not on this account.' });
      const b = await bodyOf();
      const text = String(b.body || '').trim().slice(0, 4000);
      if (text.length < 2) return respond(400, { ok: false, error: 'Write something first.' });
      mutate(store => {
        const target = store.tickets.filter(x => x.ref === t.ref)[0];
        if (!target) return;
        const at = new Date().toISOString();
        target.messages.push({ from: 'user', at, body: text });
        target.status = 'open';
        target.updatedAt = at;
        auditIn(store, 'ticket', `${t.ref} replied by customer`, user.email);
      });
      const notice = templates.admin_notice({
        kind: 'Ticket reply', summary: `Customer replied · ${t.ref}`,
        detail: `From: ${user.email}\nSubject: ${t.subject}\n\n${text}`
      });
      await deliver({ to: CFG.site.supportEmail || user.email, subject: notice.subject, html: notice.html, text: notice.text }, 'ticket');
      return respond(200, { ok: true, reload: true, message: 'Added to the ticket — the team has been notified by email.' });
    }

    if (path === '/api/tickets' && req.method === 'GET') {
      if (!user) return json(res, 401, { ok: false, error: 'Not signed in' });
      return json(res, 200, { ok: true, tickets: ticketsOf(user.id) });
    }

    if (path === '/api/password/change' && req.method === 'POST') {
      const b = await bodyOf();
      const cur = String(b.current || ''), next = String(b.next || '');
      if (!verifyPassword(cur, user)) return respond(400, { ok: false, error: 'The current password is not right.' });
      if (next.length < 12) return respond(400, { ok: false, error: 'The new password needs at least 12 characters.' });
      const fresh = hashPassword(next);
      mutate(store => {
        const u = store.users.filter(x => x.id === user.id)[0];
        if (u) u.password = fresh;
        store.sessions = store.sessions.filter(s => s.userId !== user.id);   // every other device is signed out
        auditIn(store, 'security', `password changed for ${user.email}`, user.email);
      });
      const changedNotice = templates.password_changed({ name: user.name, email: user.email, via: 'Dashboard · password change' });
      await deliver({ to: user.email, subject: changedNotice.subject, html: changedNotice.html, text: changedNotice.text }, 'account');
      return json(res, 200, { ok: true, redirect: '/app', message: 'Password changed. Sign in again with the new one.' },
        { 'set-cookie': 'rp_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    if (path === '/api/sessions/revoke' && req.method === 'POST') {
      mutate(store => {
        store.sessions = store.sessions.filter(s => s.userId !== user.id);
        auditIn(store, 'security', `all sessions revoked for ${user.email}`, user.email);
      });
      return json(res, 200, { ok: true, redirect: '/app', message: 'Signed out everywhere. Sign in again to continue.' },
        { 'set-cookie': 'rp_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    if (path === '/api/account/export' && req.method === 'GET') {
      if (!user) return json(res, 401, { ok: false, error: 'Not signed in' });
      const payload = {
        exportedAt: new Date().toISOString(),
        account: { name: user.name, email: user.email, plan: user.plan, verified: user.verified, createdAt: user.createdAt },
        tickets: ticketsOf(user.id),
        activity: db.audit.filter(a => a.who === user.email)
      };
      res.writeHead(200, Object.assign({
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="revenuepilot-account.json"',
        'cache-control': 'no-store'
      }, SECURITY_HEADERS));
      return res.end(JSON.stringify(payload, null, 2));
    }

    if (path === '/api/account/close' && req.method === 'POST') {
      const email = user.email;
      mutate(store => {
        store.sessions = store.sessions.filter(s => s.userId !== user.id);
        store.tickets = store.tickets.filter(t => t.userId !== user.id);
        store.users = store.users.filter(u => u.id !== user.id);
        auditIn(store, 'account', `account closed ${email}`, email);
      });
      return json(res, 200, { ok: true, redirect: '/app', message: 'Your account and its data are deleted.' },
        { 'set-cookie': 'rp_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    /* the admin console reads tickets through a signed-in administrator, not here */
    if (path.startsWith('/api/admin/')) return json(res, 404, { ok: false, error: 'Administration lives on its own origin.' });

    /* ------------------------------------------------ static */
    if (req.method === 'GET' && serveStatic(req, res, path)) return;

    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    const tooBig = /body too large/.test(e.message || '');
    return json(res, tooBig ? 413 : 500, { ok: false, error: tooBig ? 'That request was too large.' : 'Server error: ' + e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  RevenuePilot application server');
  console.log('  ─────────────────────────────────────────────');
  console.log('  url        http://' + HOST + ':' + PORT);
  console.log('  site       /            (the marketing page, served from this origin)');
  console.log('  dashboard  /app         (accounts, tickets, security)');
  console.log('  enquiry    /enquiry     (no account needed)');
  console.log('  mail       ' + transportDescription());
  console.log('  store      ' + STORE);
  console.log('');
});

export { server, refresh, mutate };
