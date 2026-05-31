# Crub Bucks — Deployment Guide

Step-by-step setup for deploying Crub Bucks to an **Ionos VPS** with a
**managed Ionos Postgres** database, **Nginx** as the TLS-terminating
reverse proxy, and **PM2** supervising the Node process.

Companion files in this repo:

| Path | Purpose |
|------|---------|
| `ecosystem.config.cjs` | PM2 process config |
| `infra/nginx/crubbucks.conf` | Nginx site config (copy to `/etc/nginx/sites-available/`) |
| `src/routes/health/+server.ts` | `GET /health` — used by deploy probes |
| `.env.example` | Template for production `.env` |

---

## Architecture

```
Internet
   │
   ▼
┌─────────┐
│  Nginx  │   HTTPS, static caching, rate limiting, security headers
│ :80/443 │
└────┬────┘
     │ 127.0.0.1:3000
     ▼
┌──────────────┐         ┌──────────────────────────────┐
│ Node (PM2)   │ ──TLS──▶│  Ionos Managed Postgres 16   │
│ SvelteKit    │         │  sslmode=require             │
│ adapter-node │         └──────────────────────────────┘
└──────────────┘
```

- One Node process running the SvelteKit `adapter-node` build (single
  worker — plenty for a friends-and-family scale app)
- Postgres is managed elsewhere; no DB on the app server
- No Redis, no separate API process, no message queue

---

## Machine sizing

| Tier | Specs | Verdict |
|---|---|---|
| **VPS Linux S** | 1 vCPU / 1 GB RAM / 10 GB SSD | Works since Postgres is off-box. Tight during `npm ci` (can OOM). Add 1 GB swap and you're fine. |
| **VPS Linux M** ⭐ | 2 vCPU / 4 GB RAM / 80 GB NVMe | **Recommended.** Comfortable headroom for build, logs, and a few months of growth. |
| Cloud Server custom | 1 vCPU / 2 GB RAM | Cheapest balanced option. Sweet spot if you want to stretch. |

The Node process idles around 150 MB and peaks around 300 MB. Nginx is
~30 MB. With a managed DB, anything ≥ 2 GB RAM is comfortable.

Pick **Ubuntu 24.04 LTS** as the image — the commands below assume it.

---

## Prerequisites checklist

Before you start the server work, line these up:

- [ ] Ionos account with VPS / Cloud Server quota
- [ ] **Managed Ionos Postgres** instance provisioned in the same region
      as the VPS — capture the connection details (host, port, user,
      password, database name)
- [ ] **Domain name** with DNS access (or willingness to wait on DNS
      propagation)
- [ ] **Resend account** with your sending domain verified — full
      walkthrough in [Phase 0.5](#phase-05--set-up-resend-email).
      Start this early; DNS propagation can take a few hours.
- [ ] **hCaptcha** site key + secret — full walkthrough in
      [Phase 0.6](#phase-06--set-up-hcaptcha). Free tier is generous
      (1 M verifications/month).
- [ ] **SSH key pair** on your laptop (`ed25519` recommended)
- [ ] **GitHub repository** with the code pushed

---

## Phase 0 — Provision the managed Postgres

In the Ionos Cloud Panel:

1. Create a **Managed Database → PostgreSQL 16** instance
2. Choose the smallest cluster size (1 node, 2 vCPU, 4 GB RAM is plenty)
3. Same region as where you'll put the VPS (lower latency, no egress fees)
4. Network: **same VLAN as the VPS** if possible, otherwise note the
   public hostname
5. Create a database named `crubbucks`
6. Note down the **connection string**, which will look like:
   ```
   postgres://USER:PASS@db-xxx.de-fra.ionos.com:5432/crubbucks
   ```
7. Append `?sslmode=require` — Ionos managed PG refuses plaintext:
   ```
   postgres://USER:PASS@db-xxx.de-fra.ionos.com:5432/crubbucks?sslmode=require
   ```

Make sure your VPS IP is on the database's **firewall allowlist** once
the VPS is up (Phase 1). You can leave it open to `0.0.0.0/0` for the
initial connection from your laptop too, but lock it down to the VPS
IP afterward.

---

## Phase 0.5 — Set up Resend (email)

The app sends two kinds of transactional email — **verify-your-email**
on signup and **password reset** — via Resend's HTTP API. No SDK
dependency; the transport is a plain `fetch` to
`https://api.resend.com/emails`. It auto-selects between Resend (when
`RESEND_API_KEY` is set) and a console transport (when it isn't), so
you can run the app without Resend for dev work — but real users need
a real sender.

**Do this before Phase 1.** DNS propagation typically takes a few
minutes but can stretch to hours; starting now means the records are
verified by the time you need them in Phase 3 (`.env`).

### 0.5.1 Pick a sending subdomain

Send from a **subdomain**, not your apex. Reasons:

- The DNS records Resend asks for don't conflict with anything you
  might already have at the apex (existing mail provider, SPF for
  newsletters, etc.).
- If a future Resend incident lands you on a blocklist, only the
  subdomain's reputation is hit — your main domain is unaffected.
- DKIM rotation is cleaner when isolated to a subdomain.

Recommended: `send.yourdomain.com` or `mail.yourdomain.com`. The user
never sees the subdomain; the visible `From:` can still be
`no-reply@yourdomain.com` if you want — what matters for deliverability
is the **return-path** subdomain.

### 0.5.2 Create the account + add the domain

1. Sign up at <https://resend.com>. Free tier covers 3 000 emails /
   month and 100 / day — fine for a friends-and-family bet tracker;
   upgrade later if you grow.
2. Dashboard → **Domains → Add Domain**. Enter your sending domain
   (e.g. `send.yourdomain.com`) and pick the closest region.
3. Resend shows you a list of **DNS records to add**. There are
   usually four:
   - **MX** record on the subdomain (for return-path / bounce handling)
   - **TXT (SPF)** authorising Resend's mail servers to send
   - **TXT or CNAME (DKIM)** for cryptographic signing
   - **TXT (DMARC)** *(strongly recommended — see 0.5.4)*

   Copy the exact values shown in the dashboard — don't paste guesses
   from this doc, Resend sometimes changes the host targets.

### 0.5.3 Add the DNS records at your registrar

Wherever you bought the domain (Ionos, Namecheap, Cloudflare, etc.):

1. Open the DNS editor for the apex domain.
2. Add each record exactly as Resend shows. **Name fields are relative
   to the apex**, so an entry like `send` actually means
   `send.yourdomain.com`.
3. Save. Most registrars publish within minutes; some take an hour.
4. Back in Resend, click **Verify**. Status flips to **Verified** once
   every record resolves. You can keep refreshing — it doesn't penalise.

If verification fails, the dashboard tells you which record is missing
or wrong; the most common mistakes are pasting a value with extra
quotes around it, or putting the record at the apex instead of the
subdomain.

### 0.5.4 Add a DMARC record *(strongly recommended)*

Google and Yahoo's bulk-sender rules effectively require DMARC since
2024. Add this TXT record at `_dmarc.yourdomain.com`:

```
v=DMARC1; p=none; rua=mailto:you@yourdomain.com; pct=100; adkim=s; aspf=s
```

`p=none` means "report but don't reject" — safe to start with. After
a few weeks of clean reports (`rua=` is where they land), tighten to
`p=quarantine` and eventually `p=reject`.

### 0.5.5 Create a sending-only API key

1. Resend dashboard → **API Keys → Create API Key**.
2. **Permission: "Sending access"** — *not* "Full access". Least
   privilege means if the VPS is ever compromised the attacker can
   send emails but can't reconfigure your domain or read previous
   sends.
3. **Domain: restrict to your verified domain** (don't leave as "All
   domains" — same reasoning).
4. Name it `production-vps` or similar so future-you remembers what
   it's for.
5. Copy the key (starts with `re_…`). You won't see it again — store
   it in your password manager *and* it's about to go in the `.env`
   on the VPS in Phase 3.

### 0.5.6 Pick your `EMAIL_FROM`

Must use an address on your verified domain. Format is the standard
RFC 5322:

```
EMAIL_FROM="Crub Bucks <no-reply@yourdomain.com>"
```

The display name (`Crub Bucks`) is what shows in inboxes; the address
after it (`no-reply@…`) is what receivers see in headers and what
DKIM/SPF are checked against. Apex `yourdomain.com` is fine here even
if you verified the `send.yourdomain.com` subdomain — Resend allows
the apex when the subdomain's records cover it.

### 0.5.7 Smoke test (after Phase 3)

Once `RESEND_API_KEY` and `EMAIL_FROM` are in the VPS `.env` and PM2
is running (Phase 6), trigger a real send by registering an account
on your live site with your own email. You should receive the
verify-email message within seconds. If you don't:

- Check `pm2 logs crub-bucks` for `Resend send failed: …` lines
- Check the Resend dashboard's **Logs** tab — every send (success or
  failure) shows there with the response from the recipient's mail
  server

See also the gotcha [`Resend onboarding sender only delivers to one
address`](#resend-onboarding-sender-only-delivers-to-one-address) at
the bottom of the doc if you skipped 0.5.1–0.5.5 and tried
`onboarding@resend.dev`.

---

## Phase 0.6 — Set up hCaptcha

hCaptcha gates the three public unauthenticated forms — **login,
registration, password reset** — against credential-stuffing and
account-creation bots. Server verification is a plain `fetch` to
`hcaptcha.com/siteverify`; no SDK.

### 0.6.1 The three configuration modes

The app reads `PUBLIC_HCAPTCHA_SITE_KEY` (client) and `HCAPTCHA_SECRET`
(server). What it does in each mode:

| Mode | When | Behaviour |
|---|---|---|
| **Both unset** | Local dev default | Widget renders nothing. Server short-circuits to "ok". Frictionless. |
| **hCaptcha public test keys** | Local UI development, staging | Real widget renders ("This is for testing only" banner), always passes verification, no signup. |
| **Real keys from hcaptcha.com** | **Production** | Real bot detection. |

For staging boxes you'd typically use the test keys; for production
you need real ones. Mixing — e.g. real site key but unset secret — is
a misconfiguration and the captcha won't render.

### 0.6.2 hCaptcha public test keys (staging / dev)

These are documented by hCaptcha for testing. Drop into `.env`:

```
PUBLIC_HCAPTCHA_SITE_KEY="10000000-ffff-ffff-ffff-000000000001"
HCAPTCHA_SECRET="0x0000000000000000000000000000000000000000"
```

Use them to develop the UI flow without signing up. The widget will
display a visible **"This is for testing only — do not use in
production"** banner, which is the point — you'll see it on any
preview box and know to swap before going live.

### 0.6.3 Create a production hCaptcha site

1. Sign up at <https://www.hcaptcha.com>. Free tier covers 1 M
   verifications / month — way more than a friends-and-family app
   will ever use.
2. Dashboard → **Sites → New Site**. Fields:
   - **Hostname**: `yourdomain.com` (and `www.yourdomain.com` if you
     use it — hCaptcha is hostname-locked).
   - **Difficulty**: leave at **"Easy"**. The defaults are tuned for
     low-friction human users. "Always Challenge" is overkill for
     this app and will annoy your friends.
3. Save. The new site's page shows two values:
   - **Sitekey** → goes into `PUBLIC_HCAPTCHA_SITE_KEY`
   - **Secret** → goes into `HCAPTCHA_SECRET`

### 0.6.4 Put the keys in your production `.env`

You'll set these in Phase 3 alongside the rest of the env vars. The
site key is exposed to the browser (anything starting with `PUBLIC_`
is); the secret must **never** appear in client code or repo. The
`.env` file is gitignored and will be `chmod 600` on the VPS.

### 0.6.5 Smoke test (after Phase 6)

Visit `/login`, `/register`, `/forgot-password` on the live site. The
widget should render under the form. Submit without solving it →
server rejects with the same `Captcha failed.` error you'd get from
forging the token. Solve it → form proceeds.

If the widget doesn't render at all:

- DevTools → Network — is `js.hcaptcha.com/1/api.js` loading? If
  blocked by an ad-blocker, that's a client-side issue; the server
  will still validate.
- Confirm `PUBLIC_HCAPTCHA_SITE_KEY` reaches the browser: source view
  the page, search for the key value — SvelteKit inlines `PUBLIC_`
  env vars into the rendered HTML.
- Check the browser console for `[hcaptcha]` errors. A wrong hostname
  in the site config is the usual cause.

---

## Phase 1 — Provision the VPS

In the Ionos Cloud Panel:

1. Order a VPS Linux M (or your chosen size) with Ubuntu 24.04
2. Add your SSH public key during provisioning
3. Note the public IPv4 address
4. Set the **PTR (reverse DNS)** to your domain — improves Resend
   deliverability

### 1.1 First SSH and harden

```bash
ssh root@VPS_IP

# Patch everything
apt update && apt upgrade -y && apt autoremove -y

# Create the app user
adduser --disabled-password --gecos "" crubbucks
usermod -aG sudo crubbucks
mkdir -p /home/crubbucks/.ssh
cp /root/.ssh/authorized_keys /home/crubbucks/.ssh/
chown -R crubbucks:crubbucks /home/crubbucks/.ssh
chmod 700 /home/crubbucks/.ssh
chmod 600 /home/crubbucks/.ssh/authorized_keys

# Disable password SSH and root SSH (key-only, non-root)
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: SSH, HTTP, HTTPS only
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# fail2ban for SSH brute-force protection
apt install -y fail2ban
systemctl enable --now fail2ban
```

From here on, log in as the app user:

```bash
ssh crubbucks@VPS_IP
```

### 1.2 Install Nginx, Certbot, Postgres client

```bash
sudo apt install -y nginx certbot python3-certbot-nginx postgresql-client-16
```

### 1.3 Install Node 22 via nvm (as the `crubbucks` user)

PM2 ties to whichever Node installation it sees first. Installing both
via nvm under the same user keeps everything coherent.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# Reload the shell so nvm is on PATH
exec bash -l

nvm install 22 --lts
nvm alias default 22
node --version    # → v22.x
npm  --version

npm install -g pm2
```

> **Gotcha:** PM2 commands only work from an interactive shell because
> nvm initializes in `.bashrc`. If you need to run PM2 as `crubbucks`
> from a script (e.g. CI), use `bash -l -c "pm2 ..."` so the login
> shell loads nvm.

---

## Phase 2 — Get the code on the box

```bash
# As crubbucks:
mkdir -p ~/app ~/logs
cd ~/app
git clone https://github.com/YOUR_GH_USER/crub-bucks.git .
```

(Or `scp` the repo up if it's not on GitHub yet.)

```bash
npm ci
```

> npm ci on Linux pulls native bindings (e.g. for `postgres-js`'s
> optional `pg-native`) — this is normal and faster than `npm install`.

---

## Phase 3 — Production `.env`

Copy the template and fill in real values:

```bash
cp .env.example .env
nano .env
```

What goes in each field:

| Variable | Value |
|---|---|
| `DATABASE_URL` | The connection string from Phase 0, **with `?sslmode=require`** |
| `RESEND_API_KEY` | From your Resend dashboard |
| `EMAIL_FROM` | `"Crub Bucks <no-reply@yourdomain.com>"` (sender on a verified domain) |
| `PUBLIC_APP_URL` | `https://yourdomain.com` (no trailing slash) |
| `PUBLIC_HCAPTCHA_SITE_KEY` | Sitekey from your hCaptcha site (Phase 0.6). Exposed to the browser. |
| `HCAPTCHA_SECRET` | Secret from your hCaptcha site (Phase 0.6). Server-only — never put in `PUBLIC_*`. |
| `ORIGIN` | `https://yourdomain.com` — same as `PUBLIC_APP_URL`. **Required for CSRF.** |
| `PORT` | `3000` (matches `ecosystem.config.cjs` + Nginx config) |
| `HOST` | `127.0.0.1` (only Nginx talks to Node; don't expose to 0.0.0.0) |

Lock the file down:

```bash
chmod 600 .env
```

> **Gotcha (carried over from ironledger):** After enabling HTTPS in
> Phase 5, the `ORIGIN` value must match the public HTTPS URL exactly.
> SvelteKit compares the request's `Origin` header to this env var on
> POST form submissions; a mismatch returns `Cross-site POST form
> submissions are forbidden` and every login silently fails.

---

## Phase 4 — Run migrations

```bash
cd ~/app
npm run db:migrate
```

You should see the eight `0000_init.sql` … `0008_drop_bet_description.sql`
files apply one at a time, ending with `Migrations complete.`

If `psql` errors with "no pg_hba.conf entry" or "SSL required", your
`DATABASE_URL` is missing `?sslmode=require`.

---

## Phase 5 — Nginx + Let's Encrypt

### 5.1 Drop in the site config

```bash
sudo cp infra/nginx/crubbucks.conf /etc/nginx/sites-available/crubbucks

# Replace the placeholder domain in-place
sudo sed -i 's/YOURDOMAIN.COM/yourdomain.com/g' /etc/nginx/sites-available/crubbucks

# Enable
sudo ln -s /etc/nginx/sites-available/crubbucks /etc/nginx/sites-enabled/

# Remove the default site if present
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx
```

### 5.2 Point DNS

Add an **A record** for your domain → the VPS IP. Wait for propagation
(usually a few minutes; `dig yourdomain.com` should resolve to the
VPS).

### 5.3 Get the cert

```bash
sudo certbot --nginx -d yourdomain.com
```

Choose option 2 (redirect HTTP → HTTPS). Certbot edits the site file
in place to add the TLS paths and creates a renewal timer.

Verify renewal works:

```bash
sudo certbot renew --dry-run
```

### 5.4 Update `ORIGIN` if you hadn't already

```bash
nano ~/app/.env
# Set ORIGIN="https://yourdomain.com"
```

(We'll reload PM2 in the next phase, which picks up the new env.)

---

## Phase 6 — Start the app with PM2

```bash
cd ~/app
npm run build

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
# Copy and run the sudo command pm2 prints — it registers the systemd
# unit so PM2 (and your apps) start on reboot.
```

Smoke test:

```bash
curl -i https://yourdomain.com/health
# → HTTP/2 200
# → {"ok":true}

curl -I https://yourdomain.com/
# → HTTP/2 200, with HSTS + X-Frame-Options headers
```

Open `https://yourdomain.com` in a browser. The landing page should
render with the Crub Buck bill hero.

---

## Phase 7 — Promote the first admin

The app has no admin self-service signup; the first admin has to be
promoted by hand.

1. Sign up through the registration page like any user
2. Verify your email (click the link Resend delivers)
3. From the VPS, connect to the managed DB:
   ```bash
   psql "$DATABASE_URL"
   ```
4. Promote yourself:
   ```sql
   UPDATE users
   SET role = 'admin'
   WHERE email = 'you@yourdomain.com';
   ```
5. Log out and back in. The `Admin` button now appears in the navbar.

From there you can promote other admins through `/admin/users` — no
psql needed.

---

## Phase 8 — Lock down the managed DB

In the Ionos Cloud Panel, set the database firewall to only accept
connections from:

- The VPS public IP
- Your laptop's IP (optional, for one-off psql sessions)

Block everything else. This is the single biggest hardening step after
HTTPS.

---

## Phase 9 — GitHub Actions for push-to-deploy

Once the first manual deploy works, every subsequent change ships by
pushing to `main`. The workflow file is **already in the repo** at
`.github/workflows/deploy.yml`; you only need to authorize CI on the
VPS and add three (or four) secrets to the GitHub repo.

### 9.1 What the workflow does

On every push to `main` (and on demand via the Actions tab):

1. Check out the repo, install deps, run `npm run check` on a
   GitHub-hosted Ubuntu runner.
2. Spin up a **sidecar `postgres:16-alpine`** service container next to
   the runner, apply migrations to it via `npm run db:migrate`, and run
   `npm test` against it. This makes the DB-backed tests in
   `src/lib/server/ledger.db.test.ts` actually execute on CI — without
   the sidecar they would silently skip (the test guard in
   `src/test/db.ts` requires `DATABASE_URL` to end in `_test`).
3. Run `npm run build` to confirm the production bundle compiles.
   **Any failure in steps 1–3 aborts before anything touches the VPS**
   — broken main never deploys.
4. SSH to the VPS as `crubbucks` and run, in `~/app`:
   - `git fetch origin main && git reset --hard origin/main`
   - `npm ci` (production deps + drizzle-kit for the next step)
   - `npm run db:migrate`
   - `npm run build`
   - `pm2 reload ecosystem.config.cjs --update-env && pm2 save`
3. Probe `https://<your domain>/health` for up to 60 seconds. A
   non-200 fails the workflow so you'll see red in the Actions tab.

Concurrency: only one deploy at a time, and in-flight deploys are NOT
cancelled by a newer push — letting them finish is safer than leaving
the box mid-migration. Subsequent pushes queue.

### 9.2 Add a deploy SSH key

On the VPS, as `crubbucks`:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" -C "github-actions"
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key   # copy this private key (incl. header/footer) into GH Secrets
```

Keep the private key in your password manager too, in case you ever
need to rotate or troubleshoot.

### 9.3 Capture the host key fingerprint *(recommended)*

Strict host-key checking prevents a MITM if your VPS is ever replaced.
On your **laptop**:

```bash
ssh-keyscan -t ed25519 VPS_IP \
  | ssh-keygen -lf - \
  | awk '{print $2}'
# Example output:
#   SHA256:abc123…xyz
```

Save the entire `SHA256:…` line as the `IONOS_SSH_FINGERPRINT` secret
below. If you skip this, the action still connects — it just trusts
whatever host answers at `IONOS_HOST` on first contact.

### 9.4 Add GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository
secret. Add:

| Secret | Value |
|---|---|
| `IONOS_HOST` | VPS IP address or DNS name |
| `IONOS_DEPLOY_KEY` | Contents of `~/.ssh/deploy_key` — the **private** key, including the `-----BEGIN OPENSSH PRIVATE KEY-----` / `-----END…` lines |
| `IONOS_DOMAIN` | `yourdomain.com` — what the health probe hits |
| `IONOS_SSH_FINGERPRINT` | `SHA256:…` from 9.3 (optional but recommended) |

Also create a GitHub **environment** named `production` (Settings →
Environments → New) — the workflow targets it, which gives you a place
to add approvals later if you want a "wait for human review" gate on
deploys.

### 9.5 First automated deploy

```bash
# Make a trivial change, e.g. bump README, commit, push.
git push origin main
```

Watch the Actions tab. The workflow runs `check + migrate-test-db + test + build` on the
runner first; if that's green, it SSHes in, deploys, and probes
`/health`. Total time on a small change is usually 2–4 minutes.

If the health probe fails, the workflow turns red but the new code is
still on the box (PM2 is reloading from whatever pulled cleanly).
SSH in, run `pm2 logs crub-bucks`, and iterate.

### 9.6 Rollback

The deploy script does `git reset --hard origin/main`, so the canonical
way to roll back is:

```bash
git revert <bad-sha>
git push origin main
```

CI redeploys the revert.

Bear in mind: **migrations are forward-only.** If the bad deploy
included a destructive migration (e.g. dropping a column), the revert
of the code does *not* automatically restore the DB shape — you'd need
a follow-up "fix-up" migration. For app-only bugs (UI, ledger logic,
etc.) this never comes up.

### 9.7 Manual re-deploy

If you need to redeploy without a new commit (e.g. after editing
something on the box by hand and wanting CI to put it back in a known
state), open the Actions tab → Deploy workflow → "Run workflow" on the
`main` branch.

---

## Phase 10 — Backups

**Ionos Managed Postgres takes daily snapshots automatically** — verify
the retention window in the Cloud Panel (default is 7 days; can be
extended).

For belt-and-suspenders, you can also dump to a separate location:

```bash
# As crubbucks, dump to a local file
pg_dump "$DATABASE_URL" | gzip > ~/backups/$(date +%Y%m%d).sql.gz
```

Wire that into cron (and optionally push to Ionos Object Storage) once
you have real users.

---

## Monitoring

```bash
# Process status
pm2 status

# Live logs
pm2 logs crub-bucks --lines 50

# Real-time CPU/memory
pm2 monit

# Nginx
sudo tail -f /var/log/nginx/crubbucks.access.log
sudo tail -f /var/log/nginx/crubbucks.error.log

# OS
htop          # apt install -y htop if not already
df -h         # disk space
free -h       # RAM
```

External: point an uptime monitor (Uptime Kuma, BetterUptime,
Healthchecks.io) at `https://yourdomain.com/health` with a 1–5 min
interval.

---

## Gotchas worth re-reading

These are real failure modes carried over from a previous Ionos +
adapter-node deploy. Skim before debugging.

### `Cross-site POST form submissions are forbidden`

`ORIGIN` env var doesn't match the URL the browser is on. Most common
right after Certbot succeeds — `ORIGIN` is still `http://…` while the
browser is now on `https://…`. Fix:

```bash
sed -i 's|ORIGIN="http://|ORIGIN="https://|' ~/app/.env
cd ~/app && pm2 reload ecosystem.config.cjs --update-env
```

### Logout doesn't clear the session cookie

`cookies.delete()` must pass the **same** `httpOnly`, `sameSite`, and
`secure` options that were used at `cookies.set()`. The browser
silently ignores mismatched deletions.

### `pm2: command not found` when running as root

PM2 lives in `crubbucks`'s nvm. Use:

```bash
su - crubbucks    # interactive (-) loads .bashrc / nvm
cd ~/app
pm2 ...
```

### `ecosystem.config.js: ECMAScript module is not supported`

`package.json` has `"type": "module"`, so PM2 can't load a `.js` config
as CommonJS. We use `.cjs`. If you copy the file, keep the extension.

### `pm2 reload crub-bucks --update-env` doesn't pick up new env

`--update-env` works only when reloading via the config file, not by
app name:

```bash
cd ~/app
pm2 reload ecosystem.config.cjs --update-env
```

### Resend onboarding sender only delivers to one address

`onboarding@resend.dev` only delivers to the Resend account owner's
verified email. Set `EMAIL_FROM` to a sender on a domain you've verified
in Resend (DKIM/SPF records on your registrar).

### `npm ci` OOMs on a 1 GB VPS

The `emoji-picker-element` and SvelteKit toolchain pull a lot during
install. On the small tier, add a swapfile once:

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Managed DB connections fail with `no encryption`

`DATABASE_URL` must include `?sslmode=require`. Ionos managed Postgres
refuses plaintext. `postgres-js` (which the app uses) negotiates TLS
when this flag is set.

---

## Quick reference: deploy a code change

```bash
# Local:
git push origin main      # if GitHub Actions is set up, you're done

# Or manual:
ssh crubbucks@VPS_IP
cd ~/app
git pull
npm ci
npm run db:migrate
npm run build
pm2 reload ecosystem.config.cjs --update-env
curl -sf -o /dev/null -w "%{http_code}\n" https://yourdomain.com/health  # → 200
```

---

## Cost estimate (rough)

| Item | Approx. monthly |
|---|---|
| Ionos VPS Linux M (2 vCPU / 4 GB / 80 GB) | ~€9–13 |
| Ionos Managed Postgres (smallest cluster) | ~€10–20 |
| Domain | ~€1 |
| Resend (free tier covers 3 000 emails/mo) | €0 |
| hCaptcha | €0 |
| **Total** | **~€20–35 / mo** |

Numbers are illustrative — check Ionos's current pricing for your region.
