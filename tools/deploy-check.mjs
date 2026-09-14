#!/usr/bin/env node
/**
 * deploy-check.mjs — the preflight for going live.
 *
 *   node tools/deploy-check.mjs            · check the machine you are on
 *   node tools/deploy-check.mjs --url …    · also probe a running server
 *
 * It reads exactly what a host would read: the environment, site.config.json,
 * the data directory and the built page. Nothing here is guessed — every line
 * is OK, WARN or GAP with the reason, and any GAP exits non-zero so a deploy
 * pipeline stops before it serves the wrong thing to a customer.
 */
import { readFileSync, existsSync, statSync, readdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const CFG = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const env = process.env;
const rows = [];
const add = (level, name, detail) => rows.push({ level, name, detail });
const isPlaceholder = v => !v || /example\.(com|org|net)|your-domain|placeholder/i.test(String(v));

/* ── environment ─────────────────────────────────────────────────────────── */
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
add(nodeMajor >= 20 ? 'OK' : 'GAP', 'Node version', process.versions.node + (nodeMajor >= 20 ? ' (20+ required, fine)' : ' — this project needs Node 20 or newer'));

add(env.NODE_ENV === 'production' ? 'OK' : 'WARN', 'NODE_ENV', env.NODE_ENV || 'not set — set it to production so errors are not printed to visitors');

const pepper = env.SESSION_PEPPER || '';
add(pepper.length >= 32 ? 'OK' : (pepper ? 'GAP' : 'GAP'), 'SESSION_PEPPER', pepper ? `${pepper.length} characters` : 'not set — sessions and CSRF tokens fall back to the placeholder pepper');

if (env.RP_SECURE_COOKIES === '1') add('OK', 'Secure cookies', 'session cookie is HTTPS-only');
else add('WARN', 'Secure cookies', 'RP_SECURE_COOKIES is not 1 — set it once the site is on HTTPS');

const adminState = env.RP_ADMIN_STATE || join(ROOT, 'admin', '.admin.json');
if (existsSync(adminState)) {
  const mode = statSync(adminState).mode & 0o777;
  add(mode === 0o600 ? 'OK' : 'WARN', 'Admin console account', `${adminState} (mode ${mode.toString(8)})`);
} else if (env.RP_ADMIN_PASSWORD) {
  add('OK', 'Admin console account', 'will be created on first start from RP_ADMIN_PASSWORD');
} else {
  add('GAP', 'Admin console account', 'neither an existing state file nor RP_ADMIN_PASSWORD — the console cannot sign anyone in');
}

const adminHosts = (env.RP_ADMIN_HOSTS || '').split(',').filter(Boolean);
add(adminHosts.length ? 'OK' : 'WARN', 'Admin console access',
  adminHosts.length ? `served through ${adminHosts.join(', ')} (the app server proxies it to 127.0.0.1:${env.RP_ADMIN_PORT || 8787})`
    : `local only — reach it with an SSH tunnel (ssh -L ${env.RP_ADMIN_PORT || 8787}:127.0.0.1:${env.RP_ADMIN_PORT || 8787} …) or set RP_ADMIN_HOSTS on a host with no shell`);

/* ── the store and its disk ──────────────────────────────────────────────── */
const dataDir = env.RP_DATA_DIR || join(ROOT, 'data');
try {
  accessSync(dataDir, constants.W_OK);
  let files = [];
  try { files = readdirSync(dataDir); } catch (e) { /* empty */ }
  const store = join(dataDir, 'store.json');
  const size = existsSync(store) ? statSync(store).size : 0;
  add('OK', 'Data directory', `${dataDir} · writable · ${files.filter(f => f.endsWith('.json')).length ? 'store.json ' + Math.round(size / 1024) + ' KB' : 'empty (first start creates the store)'}`);
  if (env.RP_DATA_DIR && dataDir === join(ROOT, 'data')) {
    add('WARN', 'Data directory', 'RP_DATA_DIR points inside the repository — on a host it should be the mounted disk (/var/data)');
  }
} catch (e) {
  add('GAP', 'Data directory', `${dataDir} is not writable (${e.code}) — the store cannot be saved, so every account would be lost`);
}

/* ── the site itself ─────────────────────────────────────────────────────── */
const index = join(ROOT, 'index.html');
if (!existsSync(index)) add('GAP', 'Built page', 'index.html is missing — run `node assemble.js` (npm run build)');
else {
  const age = Math.round((Date.now() - statSync(index).mtimeMs) / 60000);
  add('OK', 'Built page', `index.html · ${Math.round(statSync(index).size / 1024)} KB · ${age} min old`);
}

const url = (CFG.site && CFG.site.url) || '';
if (isPlaceholder(url)) add('GAP', 'Domain', `site.config.json still says ${url || '(nothing)'} — canonical links, hreflang, sitemap and every emailed link use it`);
else add('OK', 'Domain', url);

const publicUrl = env.PUBLIC_URL || '';
if (!publicUrl) add('WARN', 'PUBLIC_URL', 'not set — emails sent by the console fall back to site.url; set it to the same domain on a host');
else if (!isPlaceholder(url) && publicUrl.replace(/\/$/, '') !== url.replace(/\/$/, '')) add('WARN', 'PUBLIC_URL', `${publicUrl} does not match site.config.json (${url})`);
else add('OK', 'PUBLIC_URL', publicUrl);

/* ── mail ────────────────────────────────────────────────────────────────── */
const provider = env.RESEND_API_KEY || env.MAIL_WEBHOOK_URL || '';
const smtp = env.SMTP_HOST || '';
if (provider) add('OK', 'Mail transport', 'provider API — confirmation, ticket and reset mail is delivered');
else if (smtp) add('OK', 'Mail transport', `SMTP via ${smtp}:${env.SMTP_PORT || 587}`);
else add('WARN', 'Mail transport', 'none configured — mail is written to data/outbox and reported as queued, nothing reaches the customer');

if (isPlaceholder(env.MAIL_FROM)) add('WARN', 'MAIL_FROM', `"${env.MAIL_FROM || 'not set'}" — use an address on the domain you are sending from, or SPF/DKIM will fail`);
else add('OK', 'MAIL_FROM', env.MAIL_FROM);

/* ── optional live probe ─────────────────────────────────────────────────── */
const probeAt = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : '';
if (probeAt) {
  const base = probeAt.replace(/\/$/, '');
  const probe = async (path, expect) => {
    try {
      const r = await fetch(base + path, { redirect: 'manual' });
      add(r.status === expect ? 'OK' : 'GAP', `Probe ${path}`, `HTTP ${r.status} (expected ${expect})`);
    } catch (e) {
      add('GAP', `Probe ${path}`, e.message);
    }
  };
  await probe('/health', 200);
  await probe('/', 200);
  await probe('/app', 200);
  await probe('/enquiry', 200);
  try {
    const r = await fetch(base + '/data/store.json', { redirect: 'manual' });
    add(r.status === 404 ? 'OK' : 'GAP', 'Probe /data/store.json', `HTTP ${r.status} — the store must never be served`);
  } catch (e) { add('GAP', 'Probe /data/store.json', e.message); }
}

/* ── report ──────────────────────────────────────────────────────────────── */
const order = { OK: 0, WARN: 1, GAP: 2 };
rows.sort((a, b) => order[b.level] - order[a.level]);
const mark = { OK: '\u2713', WARN: '!', GAP: '\u2717' };
console.log('\n  RevenuePilot deploy check\n  ─────────────────────────────────────────────');
rows.forEach(r => console.log(`  ${mark[r.level]} ${r.name.padEnd(26)} ${r.detail}`));
const gaps = rows.filter(r => r.level === 'GAP').length;
const warns = rows.filter(r => r.level === 'WARN').length;
console.log(`\n  ${rows.length - gaps - warns} ok · ${warns} warning${warns === 1 ? '' : 's'} · ${gaps} gap${gaps === 1 ? '' : 's'}\n`);
process.exit(gaps ? 1 : 0);
