# Deploying RevenuePilot

Short version: **yes, Render with a persistent disk works** — `render.yaml` in this
repository creates the service and the disk in one step. Fly.io works too
(`fly.toml` + `Dockerfile` + a volume). A small VPS remains the cheapest
long-lived option (~€4–5/month).

Whatever you choose, three things are true of this project:

| what | where it must live | why |
| --- | --- | --- |
| the store — accounts, sessions, tickets, audit | `<disk>/store.json` | it is the whole database; lose it and every account is gone |
| queued mail | `<disk>/outbox/` | mail that could not be sent is kept, and the console shows it |
| the console's own account | `<disk>/admin-state.json` | hashed console password, sessions, lockout timers |

…and one thing is *not* true of it: there is nothing to scale out. One process,
one disk, no database. That is deliberate — it makes the whole thing auditable
and cheap to run. If you ever need more, the store is the piece to replace first.

---

## 1. Render, with a disk (recommended if you want a dashboard, not a shell)

1. Push this repository to GitHub (private is fine).
2. Render → **New → Blueprint** → pick the repository → Render reads `render.yaml`.
3. Fill in the four secrets it asks for:
   * `RP_ADMIN_PASSWORD` — the password for the console. Change it after the first sign-in.
   * `PUBLIC_URL` — `https://your-domain`.
   * `MAIL_FROM` — e.g. `RevenuePilot <hello@your-domain>`.
   * `RESEND_API_KEY` — or leave the mail variables empty and mail will be *queued* instead of sent (see §5).
   * `RP_ADMIN_HOSTS` — `admin.your-domain` (see §4). Without it, the console stays local to the container.
4. **Add the disk** — `render.yaml` already does it:
   `mountPath: /var/data`, `sizeGB: 1`, and `RP_DATA_DIR=/var/data`. Disks need a
   paid instance (Starter, ~$7/month). On the free plan there is no disk, so the
   store would be wiped on every deploy and every spin-down: **do not use the free
   plan for this project.**
5. Custom domains → add `your-domain` (and `admin.your-domain`, §4). Render issues
   the TLS certificate automatically; DNS records are shown in the dashboard.

Two limits that come with a disk, so you can plan around them: a service with a
disk runs a **single instance** and cannot do zero-downtime deploys — expect a few
seconds of downtime per release. Both are acceptable at this size, and both are
the trade for not running a database.

## 2. Fly.io, with a volume (good fallback, more control)

```bash
fly launch --no-deploy --copy-config          # keep fly.toml, pick a region (fra is nearest Lagos)
fly volumes create revenuepilot_data --size 1 --region fra
fly secrets set SESSION_PEPPER="$(openssl rand -hex 32)" \
                RP_ADMIN_PASSWORD='…' \
                PUBLIC_URL='https://your-domain' \
                MAIL_FROM='RevenuePilot <hello@your-domain>' \
                RESEND_API_KEY='re_…'
fly deploy
fly certs add your-domain
```

The volume is mounted at `/var/data` and `RP_DATA_DIR` already points there. Fly
suspends an idle machine and wakes it on the next request — the volume keeps the
store intact. Keep `min_machines_running = 0` unless you want to pay for an idle
machine. Reaching the console is in §4.

## 3. A small VPS (cheapest over a year, most control)

Hetzner CX22 or a $6 DigitalOcean droplet, Ubuntu LTS, then:

```bash
apt install -y nodejs npm caddy
git clone <your repo> /srv/revenuepilot && cd /srv/revenuepilot
node assemble.js                       # build the page
RP_DATA_DIR=/srv/data RP_ADMIN_PASSWORD='…' SESSION_PEPPER="$(openssl rand -hex 32)" \
PUBLIC_URL=https://your-domain MAIL_FROM='RevenuePilot <hello@your-domain>' \
node server/start.mjs                  # try it once, then run it as a service
```

Caddy gives you HTTPS in two lines (`your-domain { reverse_proxy 127.0.0.1:8788 }`).
Systemd unit, `/srv/data` owned by the service user, and the console stays bound
to `127.0.0.1` — reached through an SSH tunnel, §4. This is the setup with the
fewest moving parts and no platform that can lose your disk.

---

## 4. Reaching the administrator console

The console is a **separate process on `127.0.0.1:8787`** and is never part of the
public site. How you get to it depends on what your host gives you:

| host | how the admin signs in |
| --- | --- |
| VPS / Fly.io / any host with a shell | `ssh -L 8787:127.0.0.1:8787 user@host` then `http://127.0.0.1:8787` — the password never crosses the public internet |
| Fly.io without SSH | `fly proxy 8787:127.0.0.1:8787` (same result) |
| Render, Railway, any host with no shell | point a **second hostname** at the same service (`admin.your-domain`) and set `RP_ADMIN_HOSTS=admin.your-domain`. The app server sees that hostname, passes the request to the console on `127.0.0.1:8787`, and answers nothing for any other host. The console keeps its own password, sessions, CSRF tokens and `noindex` headers |
| any | `RP_ADMIN_HOSTS` is the only way in. If it is empty, nothing at all is proxied |

Guarding the admin hostname further is up to you and cheap: a Cloudflare access
rule, an IP allow-list, or a second password at the edge. The console's own
protection (scrypt password, 5 attempts then a 15-minute lockout, 120-minute
sessions, per-session CSRF token, hashed session ids, `noindex`, `frame-ancestors
'none'`) already assumes it is reachable.

## 5. Mail — the part that decides whether customers see anything

The app writes mail through one interface, chosen by environment:

| variables set | transport | effect |
| --- | --- | --- |
| `RESEND_API_KEY` **or** `MAIL_WEBHOOK_URL` | provider API | real delivery |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP (465 or STARTTLS) | real delivery |
| none | **outbox** | the message is written to `<disk>/outbox/` and reported as *queued*; the console lists it and shows the rendered email |

Nothing else in the app changes: the same branded templates are used either way,
and every send is recorded in the audit with its transport. Some hosts block
outbound SMTP ports — a provider API avoids that conversation entirely.

Deliverability needs three DNS records for `your-domain`: **SPF**, **DKIM** (from
your provider) and a **DMARC** policy (`v=DMARC1; p=none; rua=mailto:…` to start).
The logo in every email is an absolute `https://your-domain/assets/icons/…` URL,
so it renders once the domain is live and `site.url` is set.

## 6. Backups (five minutes, worth it)

Everything is plain files. One cron line on the host — or a scheduled job that
pulls from the disk — is enough:

```bash
tar -czf /backups/revenuepilot-$(date +%F).tgz -C "$RP_DATA_DIR" store.json outbox
```

Keep them off the machine that runs the app. Restoring is copying the file back:
the store validates itself on read and quarantines a corrupt file rather than
overwriting it.

## 7. Before you announce it

```bash
node tools/deploy-check.mjs --url https://your-domain
```

It reads what a host reads — environment, config, disk, built page — and lists
`GAP`s that would break the launch (a placeholder domain, a missing session
pepper, an unwritable disk) separately from the `WARN`ings you can live with
(mail still queued, cookies not yet HTTPS-only). Both must be empty of `GAP`s
before you point the domain at it.

Then, in order: sign in to the console and change the password → put the real
domain in `site.config.json` (`site.url`) → `node assemble.js` → publish from the
console → send yourself an enquiry from the public form and reply to it from the
console → check the mail arrived with the logo.

## 8. What this deployment is not

* **Not horizontally scalable.** One process, one disk. The store is a JSON file
  with a lock, not a database.
* **Not backed up by your host.** Render's disk and Fly's volume are storage, not
  backups. §6 is yours to run.
* **Not zero-downtime on hosts with a disk.** A few seconds during a deploy.
* **Not free** anywhere that keeps data. €4–7 a month is the realistic floor.
* **Not deployable on a static host.** Vercel, Netlify, Cloudflare Pages and
  GitHub Pages cannot run the app server or keep the store — the marketing page
  could live there, but accounts, tickets and the console could not.
