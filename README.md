# RevenuePilot

The marketing site, the customer dashboard and the administrator console for
RevenuePilot — one repository, three surfaces, and **no runtime dependencies**:
everything runs on Node 20's standard library.

```bash
node assemble.js            # build index.html from src/ + site.config.json + i18n/
node server/start.mjs       # public site + app on :8788, console on 127.0.0.1:8787
```

Then open <http://127.0.0.1:8788> for the site, `/app` for the dashboard,
`/enquiry` for the public form, and <http://127.0.0.1:8787> for the console.

## The three surfaces

| | where | what it does |
| --- | --- | --- |
| **Site** | `src/`, `site.config.json`, `i18n/` → `index.html` | the marketing page: hero, product story, pricing, evidence, FAQ, enquiry form. Built, never hand-edited |
| **App** | `server/app.mjs` on `:8788` | registration, email confirmation, sign-in, password reset, tickets, public enquiries, account export and close |
| **Console** | `admin/server.mjs` on `127.0.0.1:8787` | the super-admin side: inbox and replies, composer, site settings, pricing, locales, evidence, config snapshots with rollback, publish |

The console is **not part of the public site**: it is a separate process, bound
to loopback, not linked from any page, `noindex`, never framed, with its own
scrypt password, session store, CSRF tokens and lockout. The site cannot reach
it and nothing it serves is public.

## One store, two processes

`server/store.mjs` owns the paths (`RP_DATA_DIR`, default `./data`) and the
document everything lives in: accounts, sessions, tickets, audit, counters.

Both servers open the same file. Reads come from a snapshot that is re-read
whenever the file changes underneath, and every write runs inside an advisory
lock against the freshest version — so a reply typed in the console appears in
the running app on the next request, and neither side can overwrite the other
with a stale copy. Mail that could not be sent is kept in `data/outbox/` and can
be opened and read from the console.

## Repository layout

```
src/                 the site, in parts (CSS, body sections, JS modules)
site.config.json     single source of truth: brand, plans, locales, SEO, admin
i18n/                6 locales, 82 keys each (ar is right-to-left)
assemble.js          build + verifier; refuses to ship a broken config
index.html           generated — run `node assemble.js` after editing src/
server/app.mjs       the app server: pages and JSON API
server/store.mjs     the shared store: lock, atomic writes, change detection
server/templates.mjs 9 branded mail templates, logo included
server/mailer.mjs    SMTP · provider API · outbox, one interface
server/start.mjs     runs both processes for a host
admin/server.mjs     the console
tools/               asset build, responsive audit, browser checks, deploy check
```

## Configuration

The site reads `site.config.json`; the servers read the environment. Everything
has a safe default except the domain, the session secret and mail credentials —
`node tools/deploy-check.mjs` reports exactly what is still missing.

| variable | default | purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8788` / `127.0.0.1` | app server; hosts set `0.0.0.0` |
| `RP_DATA_DIR` | `./data` | the store, the outbox and the lock — put this on your persistent disk |
| `RP_SNAPSHOT_DIR` | `<data>/snapshots` | console rollback points |
| `SESSION_PEPPER` | placeholder | **set this** — salts session ids and CSRF tokens |
| `RP_SECURE_COOKIES` | off | set to `1` once the site is on HTTPS |
| `PUBLIC_URL` | `site.config.url` | the origin used in emails |
| `MAIL_FROM`, `RESEND_API_KEY`, `SMTP_*` | none | mail transport; with none set, mail is queued instead of sent |
| `RP_ADMIN_PASSWORD` | — | password for the console on first start |
| `RP_ADMIN_STATE` | `admin/.admin.json` | the console's own account and sessions |
| `RP_ADMIN_PORT` | `8787` | where the console listens (loopback) |
| `RP_ADMIN_HOSTS` | — | hostnames the app server may pass through to the console, for hosts with no shell |
| `RP_FRAME_ANCESTORS` | `'none'` | CSP for the console; leave alone in production |

## Checks

```bash
npm test              # site (140) · orb (27) · variants (17) · console (56) · app (41)
npm run audit         # 50 viewports, no overflow, mobile and desktop
npm run test:browser  # the real journey in a browser, isolated store
npm run deploy:check  # preflight for a live deployment
```

`node server/test-app.mjs` is the one to read first: it walks an enquiry →
sign-up → confirmation mail → sign-in → ticket → a reply written by a second
process → that reply arriving in the running app → reply back → password reset,
then the refusals that must happen (no CSRF, wrong password, someone else's
ticket, a replayed link) and a four-process race that must lose nothing.

## Deploying

See [DEPLOY.md](DEPLOY.md). Render with a persistent disk is the short path
(`render.yaml`); Fly.io with a volume is the same shape (`fly.toml`). The store
is a file, so the disk is not optional and the project runs on one instance.

## Ground rules this repository keeps

* No invented customers, results or metrics anywhere — the verifier fails the
  build if a figure has no source, and premade sample data was removed rather
  than relabelled.
* Every animation has a reduced-motion path; every page works without WebGL,
  without JavaScript, and on a 360 px screen.
* The admin surface never ships inside the public site.
