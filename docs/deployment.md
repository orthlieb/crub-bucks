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
- [ ] **Resend account** with your sending domain verified (DKIM/SPF
      records on the registrar). `onboarding@resend.dev` only delivers
      to your own account address — useless for real users.
- [ ] **hCaptcha** site key + secret (free tier is fine)
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
| `PUBLIC_HCAPTCHA_SITE_KEY` | From your hCaptcha site config |
| `HCAPTCHA_SECRET` | From your hCaptcha site config |
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

## Phase 9 — GitHub Actions for push-to-deploy *(optional)*

Once the first manual deploy works, automate it.

### 9.1 Add a deploy SSH key

On the VPS, as `crubbucks`:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key   # copy this private key to GitHub Secrets
```

### 9.2 Add GitHub Secrets

In your repo → Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `IONOS_HOST` | VPS IP address |
| `IONOS_DEPLOY_KEY` | Contents of `~/.ssh/deploy_key` (private) |
| `IONOS_DOMAIN` | `yourdomain.com` |

### 9.3 Workflow file

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npm run build

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host:     ${{ secrets.IONOS_HOST }}
          username: crubbucks
          key:      ${{ secrets.IONOS_DEPLOY_KEY }}
          timeout:  180s
          script: |
            set -euo pipefail
            source ~/.nvm/nvm.sh
            cd ~/app
            git fetch origin main
            git reset --hard origin/main
            npm ci
            npm run db:migrate
            npm run build
            pm2 reload ecosystem.config.cjs --update-env

      - name: Health check
        run: |
          for i in $(seq 1 12); do
            CODE=$(curl -sf -o /dev/null -w "%{http_code}" "https://${{ secrets.IONOS_DOMAIN }}/health" || echo 000)
            if [ "$CODE" = "200" ]; then echo "✅ healthy"; exit 0; fi
            echo "Attempt $i: HTTP $CODE — waiting 5s"
            sleep 5
          done
          echo "❌ health check failed"
          exit 1
```

Push to `main` → CI runs check/test/build, SSHs in, migrates, reloads,
and probes `/health`. Failed probes fail the workflow so you'll know.

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
