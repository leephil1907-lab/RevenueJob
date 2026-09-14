/**
 * start.mjs — the one command to run in production.
 *
 *   node server/start.mjs
 *
 * It brings up both processes the project needs, in the order that matters:
 *
 *   1. the administrator console, bound to 127.0.0.1 only — never a public
 *      port. A platform with no shell for you (a Render web service, say) can
 *      still reach it safely by listing RP_ADMIN_HOSTS on the app server,
 *      which passes that hostname through to this process.
 *   2. the public app server, which serves the marketing site, /app, /enquiry,
 *      the API and the /health probe.
 *
 * Both share one data directory (RP_DATA_DIR — attach your persistent disk
 * there). If the app server exits, this process exits too, so the platform
 * restarts the whole thing; if only the console dies, it is restarted here.
 *
 * Env: see DEPLOY.md. Everything has a safe default except the domain, the
 * session secret and the mail credentials, and tools/deploy-check.mjs reports
 * what is still missing.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const APP_PORT = process.env.PORT || '8788';
const ADMIN_PORT = process.env.RP_ADMIN_PORT || '8787';
const HOST = process.env.HOST || '0.0.0.0';
const DATA = process.env.RP_DATA_DIR || join(ROOT, 'data');

let CFG = {};
try { CFG = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8')); } catch (e) { /* defaults below */ }
const SITE = (CFG.site && CFG.site.url) || '';

function banner() {
  console.log('');
  console.log('  RevenuePilot');
  console.log('  ─────────────────────────────────────────────');
  console.log('  site + app   http://' + HOST + ':' + APP_PORT + '   (public)');
  console.log('  admin        http://127.0.0.1:' + ADMIN_PORT + ' (local only)');
  console.log('  data         ' + DATA);
  console.log('  domain       ' + (SITE || 'site.config.json still has a placeholder — set site.url'));
  if (!process.env.RP_ADMIN_HOSTS) {
    console.log('  admin access ssh -L ' + ADMIN_PORT + ':127.0.0.1:' + ADMIN_PORT + ' (or set RP_ADMIN_HOSTS)');
  } else {
    console.log('  admin host   ' + process.env.RP_ADMIN_HOSTS + ' (proxied by the app server)');
  }
  console.log('');
}

if (!existsSync(join(ROOT, 'index.html'))) {
  console.log('\n  index.html is missing — run `npm run build` once before starting.\n');
}

let admin = null;
let app = null;
function startAdmin() {
  admin = spawn(process.execPath, [join(ROOT, 'admin', 'server.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PORT: ADMIN_PORT, HOST: '127.0.0.1' }
  });
  admin.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`\n  admin console exited (${signal || code}) — restarting in 2s\n`);
    setTimeout(() => { if (!shuttingDown) startAdmin(); }, 2000);
  });
}

let shuttingDown = false;
function shutdown(signal) {
  shuttingDown = true;
  const kill = (child, name) => {
    if (!child || child.exitCode !== null) return;
    console.log(`  stopping ${name}`);
    try { child.kill('SIGTERM'); } catch (e) { /* already gone */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 4000).unref();
  };
  kill(admin, 'admin console');
  kill(app, 'app server');
  const done = () => process.exit(0);
  setTimeout(done, 4200).unref();
  process.on('exit', done);
  if (signal) console.log(`  received ${signal}`);
}

banner();
startAdmin();

app = spawn(process.execPath, [join(ROOT, 'server', 'app.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, HOST, PORT: APP_PORT, RP_ADMIN_PORT: ADMIN_PORT }
});
app.on('exit', (code, signal) => {
  console.log(`\n  app server exited (${signal || code}) — shutting the process down so the platform restarts it\n`);
  shutdown(null);
});

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal));
