# Crub Bucks — Deployment Guide

Step-by-step setup for deploying Crub Bucks to an **Ionos VPS** with a
**self-hosted PostgreSQL 16** instance on the same box, **Nginx** as
the TLS-terminating reverse proxy, and **PM2** supervising the Node
process. The database lives on `127.0.0.1` — never exposed to the
public Internet — and the deploy step (Phase 10) backs it up daily.

Companion files in this repo:

| Path                           | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `ecosystem.config.cjs`         | PM2 process config                                        |
| `infra/nginx/crubbucks.conf`   | Nginx site config (copy to `/etc/nginx/sites-available/`) |
| `src/routes/health/+server.ts` | `GET /health` — used by deploy probes                     |
| `.env.example`                 | Template for production `.env`                            |

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
┌──────────────┐         ┌─────────────────────────────┐
│ Node (PM2)   │ ──loop─▶│  PostgreSQL 16  127.0.0.1   │
│ SvelteKit    │   back  │  unix socket / TCP loopback │
│ adapter-node │         │  bound to localhost only    │
└──────────────┘         └─────────────────────────────┘
                                       │
                                       ▼
                              ┌──────────────────────┐
                              │  pg_dump cron (3 AM) │
                              │  /var/backups/crub   │
                              │  + optional off-box  │
                              └──────────────────────┘
```

- One Node process running the SvelteKit `adapter-node` build (single
  worker — plenty for a friends-and-family scale app)
- PostgreSQL 16 lives on the same VPS, bound to `127.0.0.1` — never
  reachable from the public Internet, no TLS overhead since traffic
  never leaves the box
- Daily `pg_dump` cron snapshots the database to `/var/backups/`;
  optional off-box copy (S3 / Backblaze / IONOS Object Storage) is
  the safety net if the entire VPS is ever lost
- No Redis, no separate API process, no message queue

---

## Machine sizing

Running Postgres on the same box raises the floor — both the DB and
the Node build need to coexist with OS overhead.

| Tier               | Specs                           | Verdict                                                                                                                                       |
| ------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS Linux S        | 1 vCPU / 1 GB RAM / 10 GB SSD   | **Don't.** Postgres + Node + Nginx + Ubuntu base ≈ 900 MB resident before you've served a request; `npm ci` will OOM during deploy.           |
| **VPS Linux M** ⭐ | 2 vCPU / 4 GB RAM / 80 GB NVMe  | **Recommended.** Postgres (default tuning) ≈ 300 MB, Node 150–300 MB, Nginx 30 MB, OS 250 MB — leaves 3 GB free for OS cache + build bursts.  |
| VPS Linux L        | 4 vCPU / 8 GB RAM / 160 GB NVMe | Pick this if you expect to grow past 100 active users or want a bigger Postgres `shared_buffers` and OS page cache without thinking about it. |

The Node process idles around 150 MB and peaks around 300 MB; Nginx
~30 MB; Postgres 16 with defaults around 200–400 MB resident
(grows with connection count + `shared_buffers`). On a 4 GB box
the steady-state usage is ~1 GB and the rest is OS cache — which is
what makes Postgres fast on commodity hardware.

Pick **Ubuntu 24.04 LTS** as the image — it ships Postgres 16 in
`main`, and the commands below assume it.

---

## Prerequisites checklist

Before you start the server work, line these up:

- [ ] Ionos account with VPS / Cloud Server quota
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

## Phase 0 — Plan the database

PostgreSQL 16 will run on the **same VPS** as the Node process,
bound to `127.0.0.1` only — never reachable from the Internet. The
actual install happens in Phase 1.4 after the VPS is up; this section
is just orientation.

What you're signing up for vs. a managed cluster:

| You own                                                      | Managed would handle           |
| ------------------------------------------------------------ | ------------------------------ |
| `apt upgrade postgresql-16` on patch days                    | Maintenance windows handled    |
| Daily `pg_dump` cron + retention (Phase 10)                  | Automatic snapshots            |
| Tuning `shared_buffers` / `work_mem` if you outgrow defaults | Pre-tuned for the cluster size |
| Restoring from `pg_dump` after a disaster                    | Point-in-time recovery         |

For a friends-and-family play-currency app the defaults are fine and
the ops load is "10 minutes a quarter" once it's set up. The savings
vs. a managed cluster pay for everything else on the VPS.

If at any point you want to move to managed Ionos Postgres later, the
migration path is straightforward: `pg_dump` from the VPS, restore
into the managed cluster, swap `DATABASE_URL` in `.env`, restart PM2.
The schema, code, and CI are agnostic — only the connection string
changes (with `?sslmode=require` appended for managed).

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
   - **TXT (DMARC)** _(strongly recommended — see 0.5.4)_

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

### 0.5.4 Add a DMARC record _(strongly recommended)_

Google and Yahoo's bulk-sender rules effectively require DMARC since 2024. Add this TXT record at `_dmarc.yourdomain.com`:

```
v=DMARC1; p=none; rua=mailto:you@yourdomain.com; pct=100; adkim=s; aspf=s
```

`p=none` means "report but don't reject" — safe to start with. After
a few weeks of clean reports (`rua=` is where they land), tighten to
`p=quarantine` and eventually `p=reject`.

### 0.5.5 Create a sending-only API key

1. Resend dashboard → **API Keys → Create API Key**.
2. **Permission: "Sending access"** — _not_ "Full access". Least
   privilege means if the VPS is ever compromised the attacker can
   send emails but can't reconfigure your domain or read previous
   sends.
3. **Domain: restrict to your verified domain** (don't leave as "All
   domains" — same reasoning).
4. Name it `production-vps` or similar so future-you remembers what
   it's for.
5. Copy the key (starts with `re_…`). You won't see it again — store
   it in your password manager _and_ it's about to go in the `.env`
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

| Mode                            | When                          | Behaviour                                                                                       |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| **Both unset**                  | Local dev default             | Widget renders nothing. Server short-circuits to "ok". Frictionless.                            |
| **hCaptcha public test keys**   | Local UI development, staging | Real widget renders ("This is for testing only" banner), always passes verification, no signup. |
| **Real keys from hcaptcha.com** | **Production**                | Real bot detection.                                                                             |

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

# Set a password so the user can sudo (the --disabled-password above only
# disables password-based LOGIN, not sudo). Pick a strong one and save it.
passwd crubbucks

# Copy your SSH key over with install(1) to set owner + mode atomically.
# install is safer than mkdir + cp + chown + chmod when the script could
# be interrupted halfway through.
install -d -m 700 -o crubbucks -g crubbucks /home/crubbucks/.ssh
install -m 600 -o crubbucks -g crubbucks \
    /root/.ssh/authorized_keys \
    /home/crubbucks/.ssh/authorized_keys

# CRITICAL: open the home dir for Nginx (www-data) traversal. Default
# from `adduser` is 750, which blocks www-data from reading
# /home/crubbucks/app/build/client/*. Without this Nginx returns 403 for
# every static asset (Cala images, /_app/* bundles, etc).
chmod 755 /home/crubbucks
```

Now harden sshd. **Don't edit `/etc/ssh/sshd_config` directly** — Ubuntu
ships drop-in files in `/etc/ssh/sshd_config.d/` that are processed BEFORE
the main config, and `50-cloud-init.conf` sets `PasswordAuthentication
yes`. sshd uses the **first** occurrence of each directive, so the main
config's `no` gets ignored. Use a `01-` prefix drop-in to win:

```bash
tee /etc/ssh/sshd_config.d/01-hardening.conf > /dev/null <<'EOF'
# Loads before /etc/ssh/sshd_config.d/50-cloud-init.conf (which would
# otherwise enable PasswordAuthentication). sshd takes the FIRST
# occurrence of each directive — alphabetical order is what matters.
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
EOF

# Validate syntax BEFORE reloading (a typo here locks you out).
sshd -t

# Confirm the effective config matches what we want
sshd -T | grep -iE 'passwordauthentication|permitrootlogin|pubkeyauthentication'
# Expected:
#   passwordauthentication no
#   permitrootlogin no
#   pubkeyauthentication yes

systemctl reload ssh
```

```bash
# Firewall: SSH, HTTP, HTTPS only
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# fail2ban for SSH brute-force protection (botnets start hammering port
# 22 within minutes of a VPS coming online — enable this BEFORE you
# leave the box unattended overnight).
apt install -y fail2ban
systemctl enable --now fail2ban
```

**Verify from a second laptop terminal before closing the root session.**
Keep the root session as a recovery escape hatch until you've confirmed:

```bash
ssh crubbucks@VPS_IP    # should work, key auth
ssh root@VPS_IP         # should fail INSTANTLY: "Permission denied (publickey)."
                         # with no password prompt before the rejection
```

From here on, log in as the app user:

```bash
ssh crubbucks@VPS_IP
```

### 1.2 Install Nginx, Certbot, PostgreSQL 16

```bash
sudo apt install -y nginx certbot python3-certbot-nginx postgresql-16
```

Ubuntu 24.04 ships Postgres 16 in `main`. The package starts a
`postgres` cluster automatically, bound to `127.0.0.1:5432` by
default (Debian/Ubuntu policy — your VPS firewall already blocks
external 5432 from the previous step, belt-and-braces).

Confirm it's listening locally only:

```bash
sudo ss -lntp | grep 5432
# Expect:  LISTEN  0  244  127.0.0.1:5432  ...
# (NOT  0.0.0.0:5432  — that would mean it's externally reachable)
```

If `pg_hba.conf` or `postgresql.conf` ever change to listen on a
public IP, re-bind to localhost only:

```bash
sudo sed -i "s/^#*listen_addresses.*/listen_addresses = 'localhost'/" \
    /etc/postgresql/16/main/postgresql.conf
sudo systemctl restart postgresql
```

#### Create the app's database and role

Postgres ships with a `postgres` superuser whose login is the
`postgres` system account. We create a dedicated non-superuser role
for the app and a database it owns. **Pick a strong password** —
local-only or not, a leaked DB password is still a vulnerability.

```bash
# Generate a 32-byte URL-safe random password and save it for the .env step.
DB_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
echo "Save this — Phase 3 puts it in DATABASE_URL:"
echo "  $DB_PASS"

sudo -u postgres psql <<EOF
CREATE ROLE crubbucks WITH LOGIN PASSWORD '$DB_PASS';
CREATE DATABASE crubbucks OWNER crubbucks ENCODING 'UTF8';
EOF
```

The role can connect from `localhost` only because that's all
Postgres listens on; no further `pg_hba.conf` edits are needed.

Verify the app user can connect:

```bash
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U crubbucks -d crubbucks -c '\conninfo'
# Expect: You are connected to database "crubbucks" as user "crubbucks" on host "127.0.0.1" ...
```

### 1.3 Install Node 24 via nvm (as the `crubbucks` user)

PM2 ties to whichever Node installation it sees first. Installing via nvm
under the same user keeps everything coherent.

The repo pins **Node 24** (`.nvmrc` + `engines`), which ships **npm 11**. This
matters: npm 10 (bundled with Node 22) mishandles esbuild's multi-version
platform `optionalDependencies` and rejects the lockfile under `npm ci`; npm 11
handles it. The deploy workflow runs `nvm install` (reading `.nvmrc`) before
`npm ci`, so the VPS must have Node 24 available.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# Reload the shell so nvm is on PATH
exec bash -l

nvm install 24
nvm alias default 24
node --version    # → v24.x
npm  --version    # → 11.x

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

| Variable                   | Value                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | `postgres://crubbucks:DB_PASS@127.0.0.1:5432/crubbucks` using the password from Phase 1.2. Loopback, so no `sslmode=require` needed (and no TLS overhead). |
| `RESEND_API_KEY`           | From your Resend dashboard                                                                                                                                 |
| `EMAIL_FROM`               | `"Crub Bucks <no-reply@yourdomain.com>"` (sender on a verified domain)                                                                                     |
| `PUBLIC_APP_URL`           | `https://yourdomain.com` (no trailing slash)                                                                                                               |
| `PUBLIC_HCAPTCHA_SITE_KEY` | Sitekey from your hCaptcha site (Phase 0.6). Exposed to the browser.                                                                                       |
| `HCAPTCHA_SECRET`          | Secret from your hCaptcha site (Phase 0.6). Server-only — never put in `PUBLIC_*`.                                                                         |
| `PUBLIC_VAPID_KEY`         | Web-push public key (`npx web-push generate-vapid-keys`). Exposed to the browser. Optional — push is simply disabled if unset.                             |
| `VAPID_PRIVATE_KEY`        | Web-push private key from the same keypair. Server-only. Don't rotate once devices subscribe.                                                              |
| `VAPID_SUBJECT`            | `mailto:you@yourdomain.com` — VAPID contact.                                                                                                               |
| `ORIGIN`                   | `https://yourdomain.com` — same as `PUBLIC_APP_URL`. **Required for CSRF.**                                                                                |
| `PORT`                     | `3000` (matches `ecosystem.config.cjs` + Nginx config)                                                                                                     |
| `HOST`                     | `127.0.0.1` (only Nginx talks to Node; don't expose to 0.0.0.0)                                                                                            |

Lock the file down:

```bash
chmod 600 .env
```

> **Gotcha (carried over from ironledger):** After enabling HTTPS in
> Phase 5, the `ORIGIN` value must match the public HTTPS URL exactly.
> SvelteKit compares the request's `Origin` header to this env var on
> POST form submissions; a mismatch returns `Cross-site POST form
submissions are forbidden` and every login silently fails.

---

## Phase 4 — Run migrations

```bash
cd ~/app
npm run db:migrate
```

You should see the migration files (`0000_init.sql` onward) apply one at a
time, ending with `Migrations complete.`

If migrations error with `password authentication failed`, the
password in `DATABASE_URL` doesn't match the one set in Phase 1.2 —
re-generate via:

```bash
sudo -u postgres psql -c "ALTER ROLE crubbucks WITH PASSWORD 'NEW_PASS';"
```

and update `.env`. If it errors with `connection refused`,
`sudo systemctl status postgresql` will tell you if the service is
down.

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
3. From the VPS, connect to the local Postgres:
   ```bash
   psql "$DATABASE_URL"
   # or, as the postgres superuser (bypasses the password):
   sudo -u postgres psql -d crubbucks
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

## Phase 8 — Verify Postgres is locked down

Postgres should only ever be reachable from inside the VPS. Confirm
the three layers that keep it that way:

### Layer 1 — Postgres bind address

```bash
sudo ss -lntp | grep 5432
# Expect:  LISTEN  0  244  127.0.0.1:5432  ...
# If you see  0.0.0.0:5432 or *:5432 — STOP.
```

`0.0.0.0` means Postgres is listening on every interface. Fix in
`/etc/postgresql/16/main/postgresql.conf`:

```
listen_addresses = 'localhost'
```

Then `sudo systemctl restart postgresql`.

### Layer 2 — ufw firewall

Phase 1.1 already set this, but verify:

```bash
sudo ufw status verbose
# Expect: 22/tcp, 80/tcp, 443/tcp allowed. NO entry for 5432.
```

If 5432 is allowed, remove it:

```bash
sudo ufw delete allow 5432/tcp
```

### Layer 3 — pg_hba.conf

By default Ubuntu's pg_hba.conf allows password (`scram-sha-256`)
auth on `host` lines for `127.0.0.1/32` and `::1/128` only. View it:

```bash
sudo cat /etc/postgresql/16/main/pg_hba.conf | grep -v '^#' | grep -v '^$'
```

A typical safe configuration:

```
local   all   postgres                peer
local   all   all                     peer
host    all   all   127.0.0.1/32      scram-sha-256
host    all   all   ::1/128           scram-sha-256
```

If you see a `host ... 0.0.0.0/0 ...` line, remove it. That would
allow connection from anywhere assuming the firewall and bind
address let traffic through.

### Belt-and-braces test

From your **laptop**, try to connect to the VPS's public IP on 5432:

```bash
nc -vz VPS_PUBLIC_IP 5432
# Expect: nc: connect to VPS_PUBLIC_IP port 5432 (tcp) failed: Connection refused
# (or "timed out" if ufw drops silently)
```

If that succeeds, Postgres is exposed to the Internet and you should
re-check all three layers immediately.

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
5. Probe `https://<your domain>/health` for up to 60 seconds. A
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

### 9.3 Capture the host key fingerprint _(recommended)_

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

| Secret                  | Value                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `IONOS_HOST`            | VPS IP address or DNS name                                                                                                     |
| `IONOS_DEPLOY_KEY`      | Contents of `~/.ssh/deploy_key` — the **private** key, including the `-----BEGIN OPENSSH PRIVATE KEY-----` / `-----END…` lines |
| `IONOS_DOMAIN`          | `yourdomain.com` — what the health probe hits                                                                                  |
| `IONOS_SSH_FINGERPRINT` | `SHA256:…` from 9.3 (optional but recommended)                                                                                 |

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
of the code does _not_ automatically restore the DB shape — you'd need
a follow-up "fix-up" migration. For app-only bugs (UI, ledger logic,
etc.) this never comes up.

### 9.7 Manual re-deploy

If you need to redeploy without a new commit (e.g. after editing
something on the box by hand and wanting CI to put it back in a known
state), open the Actions tab → Deploy workflow → "Run workflow" on the
`main` branch.

---

## Phase 10 — Backups

With Postgres on the same box as the app, **backups are your job**.
The risk model has two tiers:

1. **Data corruption inside the DB** (bad migration, fat-fingered
   `DELETE`) — covered by an on-box rotated dump.
2. **Whole-VPS loss** (hardware failure, accidental termination,
   ransomware) — covered by an **off-box** copy of those dumps.

Phase 10 sets up both.

### 10.1 On-box dumps (daily, rotated)

Create the backup directory:

```bash
sudo mkdir -p /var/backups/crubbucks
sudo chown crubbucks:crubbucks /var/backups/crubbucks
sudo chmod 700 /var/backups/crubbucks
```

Create `/home/crubbucks/bin/backup-db.sh`:

```bash
mkdir -p ~/bin
cat > ~/bin/backup-db.sh <<'EOF'
#!/usr/bin/env bash
# Daily pg_dump with 14-day local retention.
# DATABASE_URL is sourced from ~/app/.env so the password isn't in this script.
set -euo pipefail

OUT_DIR=/var/backups/crubbucks
DATE=$(date +%Y%m%d-%H%M%S)
OUT="$OUT_DIR/crubbucks-$DATE.sql.gz"

# Pull DATABASE_URL out of the app's .env without exporting other vars.
DATABASE_URL=$(grep -E '^DATABASE_URL=' ~/app/.env | cut -d= -f2- | tr -d '"')

# Custom format (-Fc) is smaller and restorable selectively. Gzip is
# belt-and-braces; pg_dump custom is already compressed but gzip wraps
# nicely for find/rsync downstream.
pg_dump "$DATABASE_URL" -Fc | gzip > "$OUT"

# Verify the file is non-empty and at least minimally sane.
if [ ! -s "$OUT" ]; then
    echo "Backup produced an empty file: $OUT" >&2
    exit 1
fi

# Rotate: keep the last 14 dumps.
find "$OUT_DIR" -name 'crubbucks-*.sql.gz' -type f -mtime +14 -delete

echo "[backup] $OUT  ($(du -h "$OUT" | cut -f1))"
EOF
chmod +x ~/bin/backup-db.sh
```

Wire it into cron (as the `crubbucks` user) to run nightly at 3 AM
local time:

```bash
( crontab -l 2>/dev/null; echo "0 3 * * * /home/crubbucks/bin/backup-db.sh >> /var/log/crubbucks-backup.log 2>&1" ) | crontab -
sudo touch /var/log/crubbucks-backup.log
sudo chown crubbucks:crubbucks /var/log/crubbucks-backup.log
```

Test it once manually:

```bash
~/bin/backup-db.sh
ls -lh /var/backups/crubbucks/
```

### 10.2 Off-box copy (weekly, to cloud storage)

Pick any S3-compatible store: **IONOS Object Storage**, **Backblaze B2**
(cheap), or **AWS S3**. The pattern is the same — install `rclone`
once, configure a remote, push.

```bash
# As crubbucks
curl -s https://rclone.org/install.sh | sudo bash
rclone config
# Walks you through adding a remote. Pick "S3 compatible" for IONOS
# Object Storage / Backblaze. Name the remote "backups".
```

Then a weekly cron sync:

```bash
( crontab -l; echo "0 4 * * 0 rclone sync /var/backups/crubbucks backups:crubbucks-backups/ >> /var/log/crubbucks-backup.log 2>&1" ) | crontab -
```

The remote bucket should have **lifecycle rules** that delete objects
older than ~90 days, otherwise you'll grow forever.

### 10.3 Restoring

To restore the most recent dump:

```bash
# Stop the app so no writes race the restore.
pm2 stop crub-bucks

# Drop + recreate the database. CAUTION — destroys the current data.
sudo -u postgres psql <<EOF
DROP DATABASE crubbucks;
CREATE DATABASE crubbucks OWNER crubbucks ENCODING 'UTF8';
EOF

# Restore the latest dump. `-Fc` dumps need pg_restore, not psql.
LATEST=$(ls -t /var/backups/crubbucks/crubbucks-*.sql.gz | head -1)
gunzip -c "$LATEST" | pg_restore -d "$DATABASE_URL" --no-owner --no-acl

pm2 start crub-bucks
```

**Test the restore quarterly.** Untested backups aren't backups.
Easiest way: spin up a small throwaway VPS, apt-install postgres,
download a dump from the off-box copy, restore, point a local copy
of the app at it and confirm `/health` returns 200.

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

### `pg_dump: error: connection to server ... failed`

The backup cron runs as the `crubbucks` user and reads `DATABASE_URL`
from `~/app/.env`. If the password there got out of sync with the
role's actual password (e.g. you ran an `ALTER ROLE ... PASSWORD`
without updating `.env`), the cron will fail silently — only the log
will tell you. Tail `/var/log/crubbucks-backup.log` after the first
3 AM run to confirm it's working, then check it once a week.

### Postgres bound to `0.0.0.0` after an apt upgrade

A future Postgres major-version upgrade _can_ reset
`listen_addresses` to the package default. Phase 8 covers re-binding
to localhost; bake it into your post-apt routine to re-run
`sudo ss -lntp | grep 5432` after every `apt upgrade postgresql-*`.

### Nginx 403s for every static asset; Cala images don't render

Symptom: app renders text fine, every PNG/JPG/CSS bundle returns 403
or doesn't appear at all. Cause: `/home/crubbucks` is mode **750**
(adduser's default), which blocks `www-data` from traversing into the
home directory. Fix:

```bash
sudo chmod 755 /home/crubbucks
```

Files **inside** are already world-readable (default umask is 022), so
only the home dir's traverse bit needs opening. This is covered in
Phase 1.1; if you skipped it or restored the dir from backup, redo.
Confirm with:

```bash
sudo -u www-data test -r ~/app/build/client/cala-money.png && echo OK || echo BLOCKED
```

### `Invalid ORIGIN: ''. ORIGIN must be a valid URL`

SvelteKit's `adapter-node` refuses to start when `ORIGIN` is set to an
**empty string**. Unset is OK (the CSRF check is skipped), valid URL
is OK, but `ORIGIN=""` crashes the boot. In `.env.example` we leave
the line commented out for exactly this reason. After Phase 5 (TLS),
uncomment and point at `https://yourdomain.com` — not `""`.

### `nginx: unknown directive "http2"` on Ubuntu 24.04

Ubuntu 24.04 ships Nginx 1.24, which uses the legacy `listen 443 ssl
http2;` syntax. The newer `http2 on;` directive (Nginx 1.25+) won't
parse. The shipped `infra/nginx/crubbucks.conf` uses the legacy form
deliberately — it works on both 1.24 and 1.25+.

### PM2's `env_file` silently doesn't load on PM2 7.x

`env_file: '/path/to/.env'` in `ecosystem.config.cjs` was unreliable in
PM2 7.0.x — Node would start without `process.env.DATABASE_URL`, etc.
We use Node 22's native `--env-file` instead, via PM2's `node_args`:

```js
node_args: '--env-file=/home/crubbucks/app/.env',
```

This is in the shipped config. Symptom if you reverted to `env_file`:
`/health` returns `{"ok":false,"error":"database unreachable"}` even
though psql with the same connection string works. Node literally
never saw the env var.

### `PUBLIC_HCAPTCHA_SITE_KEY` change has no effect after `pm2 reload`

SvelteKit's `PUBLIC_*` env vars are **inlined into the client bundle
at build time**, not read at runtime. Changing the value in `.env`
and reloading PM2 won't update the browser bundle. After any change
to a `PUBLIC_*` variable:

```bash
npm run build && pm2 reload crub-bucks
```

Server-side vars (`HCAPTCHA_SECRET`, `DATABASE_URL`, etc.) ARE
runtime-read via `--env-file`, so reload alone picks them up.

### `npm ci` fails with `Missing: ... from lock file`

Likely an npm version mismatch between whoever generated the lock file
locally and the VPS / CI. Node 22's bundled npm is 10.x; if the lock
file was generated with npm 11+, it can include esbuild's optional
platform binaries in a way npm 10 reads as "missing." Workaround on
the VPS:

```bash
npm install --no-audit --no-fund   # regenerates lock-file locally
```

The proper fix is regenerating `package-lock.json` with Node 22/npm 10
locally (via nvm) and committing — tracked in the project's task list.

### `Connection closed by authenticating user … [preauth]` with no other log line

Your client gave up mid-authentication, BEFORE sshd reached a verdict.
Common causes, in order:

- **You Ctrl-C'd at the passphrase prompt** — SSH doesn't echo
  characters when entering a passphrase, so it looks like nothing is
  happening. Type your passphrase and press Enter; don't interrupt.
- **Your key file isn't named `id_ed25519` / `id_rsa`** — `ssh user@host`
  only auto-tries default key names. Add an alias to `~/.ssh/config`:
  ```
  Host myserver
    HostName 1.2.3.4
    User crubbucks
    IdentityFile ~/.ssh/my-custom-key
    IdentitiesOnly yes
  ```
- **Server-side perms on `.ssh/` are wrong** — sshd silently refuses
  keys when `/home/$user` is group-writable, `.ssh/` isn't `700`, or
  `authorized_keys` isn't owned by `$user`. Fix:
  ```bash
  sudo chown -R crubbucks:crubbucks /home/crubbucks/.ssh
  sudo chmod 700 /home/crubbucks/.ssh
  sudo chmod 600 /home/crubbucks/.ssh/authorized_keys
  ```

For a definitive answer, tail the server log while reconnecting:
`sudo journalctl -u ssh -f` — sshd prints `Authentication refused: …`
or `Failed publickey for …` with the exact reason.

### `dig: command not found` on macOS

macOS Sonoma+ (15+) ships without `dig`. Use `host` instead — it's still
installed by default:

```bash
host -t CNAME resend._domainkey.send.yourdomain.com
host -t TXT  send.yourdomain.com
host -t MX   send.yourdomain.com
```

Or install full bind via Homebrew: `brew install bind`.

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

| Item                                                                | Approx. monthly  |
| ------------------------------------------------------------------- | ---------------- |
| Ionos VPS Linux M (2 vCPU / 4 GB / 80 GB) — runs app + Postgres     | ~€9–13           |
| Domain                                                              | ~€1              |
| Off-box backup storage (Backblaze B2 / IONOS Object Storage, ~5 GB) | ~€1              |
| Resend (free tier covers 3 000 emails/mo)                           | €0               |
| hCaptcha (free tier covers 1 M verifications/mo)                    | €0               |
| **Total**                                                           | **~€11–15 / mo** |

Numbers are illustrative — check current pricing for your region.
Co-locating Postgres on the VPS saves the ~€10–20/mo of a managed
cluster; the trade is the ops work documented in Phase 8 + Phase 10
(maybe 10 minutes/quarter once set up).
