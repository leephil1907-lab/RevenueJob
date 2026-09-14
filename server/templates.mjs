/**
 * templates.mjs — branded email templates and the shared page shell.
 *
 * Every message the platform sends is built here, so the brand lives in one
 * place: the same mark as the website, the same palette, the same voice. Each
 * template returns { subject, html, text } — HTML for the inbox, plain text for
 * clients that refuse it, and both are generated from the same data so they can
 * never disagree.
 *
 * The logo is inlined as SVG (mail clients that strip it simply show the
 * wordmark) with a hosted PNG fallback referenced from the site root.
 */
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let CFG = {};
try { CFG = JSON.parse(readFileSync(ROOT + '/site.config.json', 'utf8')); } catch (e) { /* defaults below */ }

const SITE = (CFG.site && CFG.site.name) || 'RevenuePilot';
const CONFIGURED = ((CFG.site && CFG.site.url) || '').replace(/\/$/, '');
/* Until the real domain is in site.config.json, a placeholder host cannot be
   clicked and cannot serve the hosted logo. setBase() lets the server hand in
   the origin it was actually reached on (host header, or PUBLIC_URL). */
const PLACEHOLDER = /\.example\.(com|org|net)$/i;
export function setBase(url) {
  const clean = String(url || ENV_BASE || '').replace(/\/$/, '');
  URLBASE = (!CONFIGURED || PLACEHOLDER.test(CONFIGURED)) && clean ? clean : CONFIGURED;
  return URLBASE;
}
const ENV_BASE = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
let URLBASE = CONFIGURED && !PLACEHOLDER.test(CONFIGURED) ? CONFIGURED
  : (ENV_BASE || 'https://revenuepilot.example.com');
const SUPPORT = (CFG.site && CFG.site.supportEmail) || 'support@revenuepilot.example.com';
const LEGAL = (CFG.site && CFG.site.legalEmail) || SUPPORT;
const YEAR = new Date().getFullYear();

/* Palette mirrors the site tokens (dark surface + cyan/indigo accent). */
const C = {
  bg: '#0b1220', card: '#111a2b', ink: '#e9eefb', ink2: '#a8b6cd', ink3: '#6f7f99',
  line: '#23324d', cyan: '#22d3ee', blue: '#4f7cff', violet: '#8b5cf6',
  ok: '#34d399', warn: '#fbbf24'
};

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ---------------------------------------------------------------- logo mark */
function logoBlock() {
  const mark = `<svg width="30" height="30" viewBox="0 0 512 512" aria-hidden="true" style="display:inline-block;vertical-align:middle">
    <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5ae7ff"/><stop offset="55%" stop-color="#6fa8ff"/><stop offset="100%" stop-color="#8a6bff"/>
    </linearGradient></defs>
    <path d="M256 34 470 158v196L256 478 42 354V158Z" fill="#080e1b" stroke="url(#lg)" stroke-width="16" stroke-linejoin="round"/>
    <path d="M206 262l40 23 40-23" fill="none" stroke="url(#lg)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="256" cy="292" r="27" fill="url(#lg)"/>
  </svg>`;
  const png = existsSync(ROOT + '/assets/icons/icon-192.png')
    ? `<img src="${URLBASE}/assets/icons/icon-192.png" width="30" height="30" alt="${esc(SITE)}" style="display:inline-block;vertical-align:middle;border-radius:8px">`
    : '';
  return png || mark;
}

/* ---------------------------------------------------------------- shell */
export function shell(title, bodyHtml, opts = {}) {
  const preheader = opts.preheader || '';
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f8;">
<div style="display:none;font-size:1px;color:#eef2f8;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.bg};border-radius:18px;overflow:hidden;box-shadow:0 18px 50px -28px rgba(11,18,32,.45)">
    <tr><td style="padding:22px 26px;border-bottom:1px solid #23324d">
      <a href="${URLBASE}" style="text-decoration:none;color:${C.ink};font-weight:650;font-size:16px;letter-spacing:-.02em">
        ${logoBlock()}<span style="margin-left:10px">Revenue<b style="font-weight:800">Pilot</b></span>
      </a>
      <div style="color:${C.ink3};font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-top:6px">${esc(opts.kicker || 'AI revenue agents, supervised and auditable')}</div>
    </td></tr>
    <tr><td style="padding:26px;color:${C.ink};font-size:15px;line-height:1.62">${bodyHtml}</td></tr>
    <tr><td style="padding:18px 26px;border-top:1px solid #23324d;color:${C.ink3};font-size:12px;line-height:1.7">
      ${esc(SITE)} · <a href="${URLBASE}" style="color:${C.ink2}">${esc(URLBASE.replace(/^https?:\/\//, ''))}</a><br>
      Questions? Reply to this message or write to <a href="mailto:${esc(SUPPORT)}" style="color:${C.ink2}">${esc(SUPPORT)}</a>.<br>
      <span style="opacity:.8">© ${YEAR} ${esc((CFG.site && CFG.site.legalName) || SITE)}. Sent because you have an account or asked us a question. You can close your account at any time.</span>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const btn = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:${C.blue};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:10px;margin:6px 0">${esc(label)}</a>`;

const h1 = t => `<h1 style="margin:0 0 12px;font-size:20px;letter-spacing:-.02em;color:${C.ink}">${esc(t)}</h1>`;
const p = t => `<p style="margin:0 0 14px;color:${C.ink2}">${t}</p>`;
const note = t => `<div style="margin:16px 0 0;padding:13px 15px;border-radius:11px;border:1px solid #23324d;background:#0f1729;color:${C.ink3};font-size:12.5px;line-height:1.6">${t}</div>`;

function factsTable(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;border-collapse:collapse">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:9px 12px;border:1px solid #23324d;background:#0f1729;color:${C.ink3};font-size:12px;width:38%">${esc(k)}</td>
      <td style="padding:9px 12px;border:1px solid #23324d;color:${C.ink};font-size:13px">${v}</td></tr>`).join('')}
  </table>`;
}

const sig = `${esc(SITE)} · customer team`;

/* ---------------------------------------------------------------- templates */
export const templates = {
  /** sent on sign-up: confirms the address that will receive everything else */
  verify: ({ name, link, minutes = 60 }) => ({
    subject: `Confirm your ${SITE} account`,
    html: shell('Confirm your account', [
      h1(`Welcome, ${esc(name || 'there')}`),
      p('One click and your workspace is ready. Confirming the address is what lets us send you ticket updates and receipts here.'),
      btn(link, 'Confirm my email'),
      note(`The link is valid for ${minutes} minutes. If you did not create this account, ignore this message — nothing was activated.`)
    ].join(''), { preheader: 'Confirm the address for your RevenuePilot account' }),
    text: `Welcome${name ? ', ' + name : ''}.\n\nConfirm your ${SITE} account:\n${link}\n\nThe link is valid for ${minutes} minutes. If you did not create this account, ignore this message.`
  }),

  /** anyone can open a conversation without an account */
  enquiry_received: ({ name, subject, reference, body }) => ({
    subject: `We have your enquiry (${reference})`,
    html: shell('Enquiry received', [
      h1('Your enquiry is in the queue'),
      p(`Thanks${name ? ', ' + esc(name) : ''} — a person from our team reads every message. You will get a reply at this address, usually within one business day.`),
      factsTable([['Reference', esc(reference)], ['Subject', esc(subject)], ['Status', 'Open · awaiting a reply']]),
      note('Replying to this message adds your reply to the same thread.')
    ].join(''), { preheader: 'Your enquiry reached the team', kicker: 'Support' }),
    text: `Thanks${name ? ', ' + name : ''}.\n\nYour enquiry is in the queue.\nReference: ${reference}\nSubject: ${subject}\nStatus: open\n\nWe reply to this address within one business day.`
  }),

  /** administrator answered — goes to the address used at sign-up */
  ticket_reply: ({ name, subject, reference, reply, status }) => ({
    subject: `Re: ${subject} (${reference})`,
    html: shell('New reply', [
      h1('You have a reply'),
      p(`${esc(name || 'Hello')} — your conversation with our team has an update.`),
      factsTable([['Reference', esc(reference)], ['Subject', esc(subject)], ['Status', esc(status)]]),
      `<div style="margin:16px 0 0;padding:14px 16px;border-radius:12px;border:1px solid #23324d;background:#0f1729;color:${C.ink};font-size:14px;line-height:1.66;white-space:pre-wrap">${esc(reply)}</div>`,
      p('<span style="display:block;margin-top:16px">Reply in your dashboard to keep the thread together.</span>'),
      btn(`${URLBASE}/app#tickets`, 'Open my tickets')
    ].join(''), { preheader: 'A reply to your enquiry', kicker: 'Support' }),
    text: `${name || 'Hello'} — you have a reply.\n\nReference: ${reference}\nSubject: ${subject}\nStatus: ${status}\n\n${reply}\n\nOpen your dashboard: ${URLBASE}/app#tickets`
  }),

  /** confirmation to the person who just opened a ticket in their dashboard */
  ticket_created: ({ name, subject, reference, body }) => ({
    subject: `We received: ${subject} (${reference})`,
    html: shell('Ticket received', [
      h1('Your ticket is open'),
      p(`Thanks${name ? ', ' + esc(name) : ''} — here is a copy of what you sent, so you have it on file.`),
      factsTable([['Reference', esc(reference)], ['Subject', esc(subject)], ['Status', 'Open']]),
      `<div style="margin:16px 0 0;padding:14px 16px;border-radius:12px;border:1px solid #23324d;background:#0f1729;color:${C.ink};font-size:14px;line-height:1.66;white-space:pre-wrap">${esc(body)}</div>`,
      btn(`${URLBASE}/app#tickets`, 'Track this ticket')
    ].join(''), { preheader: 'We opened your ticket', kicker: 'Support' }),
    text: `Thanks${name ? ', ' + name : ''}.\n\nYour ticket is open.\nReference: ${reference}\nSubject: ${subject}\n\n${body}\n\nTrack it: ${URLBASE}/app#tickets`
  }),

  password_reset: ({ name, link, minutes = 30 }) => ({
    subject: `Reset your ${SITE} password`,
    html: shell('Password reset', [
      h1('Choose a new password'),
      p(`${esc(name || 'Hello')} — we received a request to reset the password on your account.`),
      btn(link, 'Set a new password'),
      note(`This link expires in ${minutes} minutes and can be used once. If you did not ask for it, your password is unchanged and no action is needed.`)
    ].join(''), { preheader: 'Reset link inside', kicker: 'Account' }),
    text: `Reset your ${SITE} password:\n${link}\n\nThe link expires in ${minutes} minutes. If you did not request it, nothing changed.`
  }),

  welcome: ({ name, email }) => ({
    subject: `Your ${SITE} account is active`,
    html: shell('Account active', [
      h1('Your account is active'),
      p(`${esc(name || 'Hello')} — thank you for confirming ${esc(email)}. This is the address we will use for tickets, receipts and account notices.`),
      factsTable([['Email', esc(email)], ['Plan', 'Trial · no card required'], ['Agents', 'None deployed yet']]),
      p('<span style="display:block;margin-top:14px">Two things worth doing first: open a ticket if anything is unclear, and connect a mailbox so your first agent has somewhere to work.</span>'),
      btn(`${URLBASE}/app`, 'Open my dashboard')
    ].join(''), { preheader: 'Everything is set up', kicker: 'Account' }),
    text: `Your ${SITE} account is active.\nEmail: ${email}\n\nOpen your dashboard: ${URLBASE}/app`
  }),

  /** free-form message an administrator writes from the console */
  admin_message: ({ name, subject, body, reference }) => ({
    subject: subject,
    html: shell('Message from the team', [
      h1(esc(subject)),
      p(`${esc(name || 'Hello')} - a note from the ${SITE} team, written and sent by a person, not an automation.`),
      `<div style="margin:16px 0 0;padding:14px 16px;border-radius:12px;border:1px solid ${C.line};background:${C.card};color:${C.ink};font-size:14px;line-height:1.68;white-space:pre-wrap">${esc(body)}</div>`,
      reference ? factsTable([['Reference', esc(reference)], ['Sent', new Date().toISOString()]]) : '',
      p('<span style="display:block;margin-top:16px">Reply to this email, or answer in your dashboard, and the thread stays together.</span>'),
      btn(`${URLBASE}/app#tickets`, 'Open my tickets')
    ].join(''), { preheader: subject, kicker: 'Support' }),
    text: `${name || 'Hello'} - a note from the ${SITE} team.\n\n${subject}\n\n${body}\n\nReply to this message or answer in your dashboard: ${URLBASE}/app#tickets`
  }),

  /** a password change the account owner did not make is worth a warning mail */
  password_changed: ({ name, email, when, via }) => ({
    subject: `Your ${SITE} password was changed`,
    html: shell('Password changed', [
      h1('Your password was changed'),
      p(`${esc(name || 'Hello')} — the password on your account was changed and every signed-in device was signed out.`),
      factsTable([['Account', esc(email || '')], ['When', esc(when || new Date().toISOString())], ['How', esc(via || 'From the dashboard')]]),
      p('<span style="display:block;margin-top:14px">If this was not you, reset the password from the sign-in page immediately and open a ticket so we can look at the session list with you.</span>'),
      btn(`${URLBASE}/app`, 'Open my dashboard')
    ].join(''), { preheader: 'A security notice for your account', kicker: 'Account' }),
    text: `Your ${SITE} password was changed.\nAccount: ${email || ''}\nWhen: ${when || new Date().toISOString()}\nHow: ${via || 'From the dashboard'}\n\nIf this was not you, reset it from the sign-in page and open a ticket.`
  }),

  /** internal copy to the administrator, so nothing depends on the CLI */
  admin_notice: ({ kind, summary, detail }) => ({
    subject: `[${SITE} admin] ${summary}`,
    html: shell('Admin notice', [
      h1(esc(summary)),
      factsTable([['Type', esc(kind)], ['When', new Date().toISOString()]]),
      `<div style="margin:14px 0 0;padding:14px 16px;border-radius:12px;border:1px solid #23324d;background:#0f1729;color:${C.ink};font-size:13.5px;line-height:1.66;white-space:pre-wrap">${esc(detail)}</div>`,
      btn(`${URLBASE}/admin`, 'Open the admin console')
    ].join(''), { preheader: summary, kicker: 'Operations' }),
    text: `${summary}\n${kind}\n${new Date().toISOString()}\n\n${detail}\n`
  })
};

/* ---------------------------------------------------------------- page shell
   The dashboard and the enquiry page are served by the app server and share
   this shell, so the logged-in experience matches the marketing site. */
export function page({ title, description, body, scripts = '', nav = true, user = null }) {
  const theme = (CFG.theme && CFG.theme.dark) || {};
  return `<!DOCTYPE html>
<html lang="${esc((CFG.site && CFG.site.defaultLocale) || 'en')}" data-theme="dark">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · ${esc(SITE)}</title>
<meta name="description" content="${esc(description || '')}">
<link rel="icon" href="/assets/icons/favicon-32x32.png" sizes="32x32">
<link rel="icon" href="/assets/logo-mark.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="${esc(theme.bg || '#0b1220')}">
<script>(function(){var d=document.documentElement;try{var s=localStorage.getItem('rp.theme');}catch(e){}
var t=(s==='light'||s==='dark')?s:'dark';d.setAttribute('data-theme',t);})();</script>
<style>
:root{--bg:#0b1220;--surface:#111a2b;--line:#23324d;--ink:#e9eefb;--ink2:#a8b6cd;--ink3:#6f7f99;--bl:#4f7cff;--cy:#22d3ee;--ok:#34d399;--warn:#fbbf24;--rose:#fb7185;
  --r:14px;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --font:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif}
:root[data-theme="light"]{--bg:#f6f8fc;--surface:#fff;--line:#dfe6f1;--ink:#101b2d;--ink2:#475569;--ink3:#6b7a90;--bl:#2557e8;--cy:#0e7490;--ok:#0f9d6e;--warn:#b45309;--rose:#e11d48}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15.5px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--bl);text-decoration:none}
header.top{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px clamp(16px,4vw,32px);border-bottom:1px solid var(--line);position:sticky;top:0;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(14px);z-index:10}
.brand{display:flex;align-items:center;gap:10px;font-weight:640;letter-spacing:-.02em;color:var(--ink)}
.brand svg{width:26px;height:26px}
.wrap{max-width:1000px;margin:0 auto;padding:clamp(20px,4vw,40px) clamp(16px,4vw,32px) 80px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:clamp(16px,2.6vw,24px);margin-bottom:16px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
h1{font-size:clamp(22px,3vw,30px);letter-spacing:-.03em;margin:0 0 8px}
h2{font-size:17px;letter-spacing:-.02em;margin:0 0 10px}
h3{font-size:14px;letter-spacing:-.01em;margin:0 0 8px}
p{margin:0 0 12px;color:var(--ink2)}
.muted{color:var(--ink3)}
label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3);margin-bottom:7px}
input,select,textarea{width:100%;padding:11px 13px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit}
input:focus,select:focus,textarea:focus{outline:2px solid color-mix(in srgb,var(--bl) 55%,transparent);outline-offset:1px;border-color:transparent}
.field{margin-bottom:14px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font-weight:560;cursor:pointer;font-size:14.5px}
.btn:hover{border-color:color-mix(in srgb,var(--bl) 45%,var(--line))}
.btn.primary{background:var(--bl);border-color:transparent;color:#fff}
.btn.ghost{color:var(--ink2)}
.btn.danger{color:var(--rose);border-color:color-mix(in srgb,var(--rose) 40%,var(--line))}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pill{display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.pill.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}
.pill.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,var(--line))}
.pill.bad{color:var(--rose);border-color:color-mix(in srgb,var(--rose) 40%,var(--line))}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}
th{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.msg{border-left:3px solid var(--line);padding:12px 14px;margin:10px 0;border-radius:0 10px 10px 0;background:color-mix(in srgb,var(--surface) 80%,var(--bg))}
.msg.me{border-left-color:var(--bl)}
.msg.admin{border-left-color:var(--cy)}
.msg .who{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);display:block;margin-bottom:6px}
.notice{padding:12px 14px;border-radius:11px;border:1px solid var(--line);margin-bottom:14px;font-size:14px}
.notice.ok{border-color:color-mix(in srgb,var(--ok) 40%,var(--line));background:color-mix(in srgb,var(--ok) 8%,transparent)}
.notice.bad{border-color:color-mix(in srgb,var(--rose) 40%,var(--line));background:color-mix(in srgb,var(--rose) 8%,transparent)}
.notice.warn{border-color:color-mix(in srgb,var(--warn) 40%,var(--line));background:color-mix(in srgb,var(--warn) 8%,transparent)}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.tabs a{padding:9px 14px;border-radius:10px;border:1px solid transparent;color:var(--ink2);font-size:14px}
.tabs a.on{border-color:var(--line);background:var(--surface);color:var(--ink)}
.kv{display:grid;gap:2px}
.kv div{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:14px}
.kv div:last-child{border-bottom:0}
.mono{font-family:var(--mono);font-size:12.5px}
.theme-btn{width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink2);cursor:pointer;display:grid;place-items:center}
.theme-btn svg{width:16px;height:16px}
:root[data-theme="light"] .ic-moon{display:none} :root[data-theme="dark"] .ic-sun{display:none}
@media (max-width:560px){.grid{grid-template-columns:1fr}.kv div{flex-direction:column;gap:2px}}
</style>
</head>
<body>
${nav ? `<header class="top">
  <a class="brand" href="/">
    <svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5ae7ff"/><stop offset="55%" stop-color="#6fa8ff"/><stop offset="100%" stop-color="#8a6bff"/></linearGradient></defs>
      <path d="M256 34 470 158v196L256 478 42 354V158Z" fill="none" stroke="url(#bm)" stroke-width="20" stroke-linejoin="round"/>
      <path d="M206 262l40 23 40-23" fill="none" stroke="url(#bm)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="256" cy="292" r="27" fill="url(#bm)"/></svg>
    RevenuePilot
  </a>
  <div class="row">
    ${user ? `<span class="pill ok">${esc(user.email)}</span>
      <a class="btn ghost" href="/app">Dashboard</a>
      <button class="btn ghost" data-logout>Sign out</button>`
      : `<a class="btn ghost" href="/enquiry">Contact</a><a class="btn primary" href="/app#signin">Sign in</a>`}
    <button class="theme-btn" data-theme-toggle aria-label="Light or dark theme" title="Light / dark theme">
      <svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>
      <svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z"/></svg>
    </button>
  </div>
</header>` : ''}
<main class="wrap">${body}</main>
<script>${scripts}</script>
</body></html>`;
}
