/**
 * mailer.mjs — delivery for every message the platform sends.
 *
 * Three transports, chosen by configuration, all with the same interface:
 *
 *   1. smtp      — SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS, with STARTTLS
 *                  or implicit TLS on 465. Implemented here on node:net and
 *                  node:tls so the app has no runtime dependencies.
 *   2. provider  — RESEND_API_KEY (or MAIL_WEBHOOK_URL) posts JSON over https.
 *   3. outbox    — no credentials yet: the message is rendered and stored in
 *                  data/outbox, listed in the admin console, and reported as
 *                  "queued, not delivered" instead of pretending it was sent.
 *
 * Nothing here is fire-and-forget: every attempt returns a result object, and
 * failures are visible to the administrator rather than swallowed.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/* the store owns every path: RP_DATA_DIR, the live data/ dir, one source */
import { OUTBOX } from './store.mjs';

export function transport() {
  if (process.env.SMTP_HOST) return 'smtp';
  if (process.env.RESEND_API_KEY || process.env.MAIL_WEBHOOK_URL) return 'provider';
  return 'outbox';
}

export function fromAddress() {
  return process.env.MAIL_FROM || 'RevenuePilot <no-reply@revenuepilot.example.com>';
}

/* ------------------------------------------------------------------ outbox */
function writeOutbox(message) {
  mkdirSync(OUTBOX, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
  const record = {
    id,
    to: message.to, from: fromAddress(), subject: message.subject,
    transport: 'outbox', delivered: false, queuedAt: new Date().toISOString(),
    reason: 'No SMTP or provider credentials configured — the message is stored, not sent.'
  };
  writeFileSync(join(OUTBOX, id + '.json'), JSON.stringify(record, null, 2));
  writeFileSync(join(OUTBOX, id + '.html'), message.html);
  writeFileSync(join(OUTBOX, id + '.txt'), message.text || '');
  return { ok: true, transport: 'outbox', delivered: false, id, note: record.reason };
}

export function outboxList(limit = 50) {
  if (!existsSync(OUTBOX)) return [];
  return readdirSync(OUTBOX)
    .filter(f => f.endsWith('.json'))
    .sort().reverse().slice(0, limit)
    .map(f => { try { return JSON.parse(readFileSync(join(OUTBOX, f), 'utf8')); } catch (e) { return null; } })
    .filter(Boolean);
}
export function outboxRead(id) {
  const p = join(OUTBOX, id + '.html');
  if (!/^[\w.:-]+$/.test(id) || !existsSync(p)) return null;
  return { html: readFileSync(p, 'utf8'), text: existsSync(join(OUTBOX, id + '.txt')) ? readFileSync(join(OUTBOX, id + '.txt'), 'utf8') : '' };
}
export function outboxClear() {
  if (!existsSync(OUTBOX)) return 0;
  const files = readdirSync(OUTBOX);
  files.forEach(f => { try { writeFileSync(join(OUTBOX, f), ''); } catch (e) {} });
  return files.length;
}

/* ------------------------------------------------------------------ SMTP  */
function smtpSend(message, cfg) {
  return new Promise((resolve) => {
    const host = cfg.host, port = cfg.port;
    const secure = cfg.secure;
    const timeoutMs = 12000;
    let socket = secure
      ? tlsConnect({ host, port, servername: host })
      : netConnect({ host, port });
    let buffer = '';
    let step = 0;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.write('QUIT\r\n'); } catch (e) {}
      try { socket.end(); } catch (e) {}
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, transport: 'smtp', delivered: false, error: 'SMTP timeout after ' + timeoutMs + 'ms' }), timeoutMs);

    const say = (line) => socket.write(line + '\r\n');
    const cmd = (line) => new Promise(res => { waiter = res; say(line); });
    let waiter = null;

    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      const last = lines[lines.length - 1] || '';
      if (!/^\d{3}[ ]/.test(last)) return;         // multi-line reply still streaming
      const code = parseInt(last.slice(0, 3), 10);
      const responder = waiter;
      waiter = null;
      if (responder) return responder({ code, text: lines.join(' | ') });
      handle(code);
    });
    socket.on('error', err => done({ ok: false, transport: 'smtp', delivered: false, error: 'SMTP socket error: ' + err.message }));
    socket.on('close', () => { if (!settled) done({ ok: false, transport: 'smtp', delivered: false, error: 'SMTP connection closed early' }); });

    function handle(code) {
      if (step === 0) { step = 1; say('EHLO revenuepilot.local'); return; }
      if (step === 1) {
        if (code >= 400) return fail('EHLO rejected: ' + code);
        step = 2;
        if (!secure && cfg.starttls) return startTls();
        return authOrMail();
      }
      if (step === 3) {                                 // after STARTTLS
        if (code !== 220) return fail('STARTTLS refused: ' + code);
        socket.removeAllListeners('data');
        socket = tlsConnect({ socket, servername: host }, () => { buffer = ''; say('EHLO revenuepilot.local'); });
        socket.setEncoding('utf8');
        socket.on('data', chunk => {
          buffer += chunk;
          const lines = buffer.split('\r\n');
          buffer = lines.pop();
          const last = lines[lines.length - 1] || '';
          if (!/^\d{3}[ ]/.test(last)) return;
          if (step === 3) { step = 4; authOrMail(); }
        });
        socket.on('error', err => fail('STARTTLS error: ' + err.message));
        step = 3;
        return;
      }
      if (step === 5) { if (code !== 235) return fail('AUTH rejected: ' + code); return mailFrom(); }
      if (step === 6) { if (code !== 250) return fail('MAIL FROM rejected: ' + code); return rcptTo(); }
      if (step === 7) { if (code !== 250) return fail('RCPT TO rejected: ' + code); step = 8; return dataPhase(); }
      if (step === 9) { if (code !== 250) return fail('message rejected: ' + code); clearTimeout(timer); return done({ ok: true, transport: 'smtp', delivered: true }); }
    }
    function fail(why) { clearTimeout(timer); done({ ok: false, transport: 'smtp', delivered: false, error: why }); }
    function startTls() { step = 3; say('STARTTLS'); }
    function authOrMail() {
      if (!cfg.user) { step = 6; return mailFrom(); }
      step = 5;
      const token = Buffer.from('\u0000' + cfg.user + '\u0000' + cfg.pass).toString('base64');
      say('AUTH PLAIN ' + token);
    }
    function mailFrom() { step = 6; say('MAIL FROM:<' + cfg.from + '>'); }
    function rcptTo() { step = 7; say('RCPT TO:<' + message.to + '>'); }
    function dataPhase() {
      step = 9;
      const head = [
        'From: ' + cfg.from,
        'To: ' + message.to,
        'Subject: ' + message.subject,
        'Date: ' + new Date().toUTCString(),
        'Message-ID: <' + randomBytes(8).toString('hex') + '@revenuepilot.local>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="rpboundary"'
      ].join('\r\n');
      const body = [
        '', '--rpboundary',
        'Content-Type: text/plain; charset="utf-8"', '', message.text || '',
        '--rpboundary',
        'Content-Type: text/html; charset="utf-8"', '', message.html,
        '--rpboundary--', ''
      ].join('\r\n');
      say('DATA');
      setTimeout(() => { socket.write(head + '\r\n' + body + '\r\n.\r\n'); }, 60);
    }
  });
}

/* --------------------------------------------------------------- provider  */
async function providerSend(message) {
  const key = process.env.RESEND_API_KEY;
  const hook = process.env.MAIL_WEBHOOK_URL;
  const payload = { from: fromAddress(), to: [message.to], subject: message.subject, html: message.html, text: message.text };
  try {
    const res = await fetch(key ? 'https://api.resend.com/emails' : hook, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' },
        key ? { authorization: 'Bearer ' + key } : (process.env.MAIL_WEBHOOK_SECRET ? { 'x-rp-secret': process.env.MAIL_WEBHOOK_SECRET } : {})),
      body: JSON.stringify(key ? payload : { type: 'email', ...payload })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, transport: 'provider', delivered: false, error: 'provider responded ' + res.status + ' ' + detail.slice(0, 180) };
    }
    return { ok: true, transport: 'provider', delivered: true };
  } catch (e) {
    return { ok: false, transport: 'provider', delivered: false, error: 'provider request failed: ' + e.message };
  }
}

/* ------------------------------------------------------------------- send  */
export async function send(message) {
  const t = transport();
  if (t === 'outbox') return writeOutbox(message);
  if (t === 'provider') return providerSend(message);
  const m = /<([^>]+)>/.exec(fromAddress());
  return smtpSend(message, {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: String(process.env.SMTP_SECURE || (process.env.SMTP_PORT === '465' ? '1' : '0')) === '1',
    starttls: String(process.env.SMTP_STARTTLS || '1') === '1',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: m ? m[1] : fromAddress()
  });
}

/** a human-readable description of where mail is going, for the admin console */
export function transportDescription() {
  const t = transport();
  if (t === 'smtp') return 'SMTP · ' + process.env.SMTP_HOST + ':' + (process.env.SMTP_PORT || '587') +
    (process.env.SMTP_USER ? ' (authenticated)' : ' (no auth)');
  if (t === 'provider') return process.env.RESEND_API_KEY ? 'Resend API' : 'Webhook · ' + process.env.MAIL_WEBHOOK_URL;
  return 'Outbox only — set SMTP_HOST or RESEND_API_KEY to deliver for real';
}
