# Crub Bucks

A closed-loop play currency for settling bets, chores, and IOUs among friends.
Crub Bucks have no real-world value. The entire system sums to **exactly zero**
by construction — for every CB someone is up, someone else is down. Wallets
are allowed to go negative; the bank is bottomless.

Stack: **SvelteKit + TypeScript + Drizzle ORM + Postgres** (Node adapter), with
**Tailwind v4 + shadcn-svelte** for the UI.

---

## What's in the box

### Data model
- **Global wallets**: one wallet per user across the whole system, plus a single
  system-wide Bank wallet. The zero-sum invariant is global.
- **Friends**: there are no named groups. Users send friend requests by email;
  the addressee approves or denies (`friendships`: one row per pair, status
  `pending` | `accepted`). Either party can unfriend. If two people request
  each other, the second request auto-accepts the first.
- **Email invites**: if you "friend" an email that isn't a user yet, it's
  recorded in `friend_invites` and we email them to join. When they register
  with that email, the invite materializes into a pending friend request
  (the handshake still applies — they approve on first login).
- **Public feed**: a shared, Venmo-style activity feed (`/app/feed`) visible to
  all logged-in users — bets started, bets resolved (with winners/losers and
  amounts; supports multiple winners), and direct payments. Derived from
  existing data, no separate events table.
- **Welcome grant**: new users receive 100 CB from the Bank on first login
  (`users.welcome_granted_at` guards it to once each); the Bank goes −100 to
  keep the books at zero.
- **Bets** (standalone): a bet is the only grouping. You create one, add
  friends (you're always a participant), and declare each person's payout
  (if win) and loss (if lose) — not necessarily 1:1. Resolved by marking each
  participant won/lost. The ledger enforces
  `sum(winners.payout) == sum(losers.loss)` at resolution and rejects
  unbalanced settlements.
- **Immutable double-entry ledger**: every economic event is a transfer of
  two equal-and-opposite rows in one DB transaction. Balances are *derived*,
  never stored — they cannot drift.

### Auth (modelled on the Iron Ledger project)
- Cookie sessions, scrypt password hashing, sliding 30-day expiry.
- Email verification on registration (Resend, with console fallback in dev).
- Password recovery via one-time hashed tokens.
- Account lockout after 5 consecutive failed logins.
- hCaptcha on register / login / forgot-password (skipped in dev when keys
  aren't set).
- Immutable `security_events` audit log of every notable action.

### Admin panel (`/admin`, gated by `users.role='admin'`)
- User list with suspend / unsuspend / promote / demote.
- Security-events viewer with filter by event type.
- System controls: maintenance mode (gates non-admin traffic), registration
  lock (refuses new signups with a configurable message), broadcast banner
  shown on every page.

### Pages
- `/`             — landing
- `/about`        — about page
- `/register`, `/verify-email/[token]`, `/login`, `/forgot-password`,
  `/reset-password/[token]`, `/logout`
- `/app`          — bets (balance, your bets, recent activity)
- `/app/feed`     — public activity feed (bets + payments)
- `/app/friends`  — friend requests (send/approve/deny), friends list, pay a friend
- `/app/bet/new`  — create a bet (pick from friends)
- `/app/bet/[bid]` — bet detail + resolve
- `/admin`, `/admin/users`, `/admin/security-events`, `/admin/system`
- `/maintenance` — landing shown to non-admins when maintenance mode is on

---

## Getting started

```bash
# 1. install deps
npm install

# 2. start a local Postgres
docker compose up -d

# 3. configure env
cp .env.example .env        # DATABASE_URL already points at the docker db

# 4. create + run migrations
npm run db:generate
npm run db:migrate

# 5. (optional) seed demo users, friendships, bets, and a payment
npm run db:seed
# Users: carl@ / dana@ / theo@ / mira@ / nina@example.com — password "password123"
# Carl, Dana, Theo, Mira are friends; Nina (new) has a pending request to Carl.
# Seeds 1 resolved bet, 1 open bet, and 1 payment so the feed has content.

# 6. run it
npm run dev
```

### Tests

```bash
# Pure unit tests (no database) — password policy, amount formatting,
# email templates, and the bet-settlement matcher.
npm test

# Include the DB-backed workflow tests (welcome grant, payments, friend
# handshake + 99-cap, bet create/resolve, email-invite materialization).
# Point them at a SEPARATE database — they TRUNCATE between tests.
createdb crubbucks_test   # once
DATABASE_URL='postgres://crub:crub@localhost:5432/crubbucks_test' npm run db:migrate
TEST_DATABASE_URL='postgres://crub:crub@localhost:5432/crubbucks_test' npm test
```

Without `TEST_DATABASE_URL` the DB suite is skipped, so `npm test` is always safe to run.

### Promoting an admin

There's no admin signup form — first admin is provisioned by SQL after
registration (or seeding):

```sql
UPDATE users SET role='admin' WHERE email='you@example.com';
```

Subsequent admins can be promoted from the `/admin/users` page.

---

## Production deploy

Built with `@sveltejs/adapter-node`. Set `DATABASE_URL` to your host's
Postgres, plus the env vars in `.env.example` (`RESEND_API_KEY`,
`EMAIL_FROM`, `PUBLIC_APP_URL`, `PUBLIC_HCAPTCHA_SITE_KEY`,
`HCAPTCHA_SECRET`). Then:

```bash
npm run build
npm run db:migrate   # against the production DB, once
node build
```

`RESEND_API_KEY` is needed for email verification and password recovery
to actually deliver messages. Without it, those emails will only print
to the server log.

---

## Project layout

```
src/
  app.d.ts                      Locals types
  hooks.server.ts               session + maintenance gate
  app.html
  routes/
    +layout.{server.ts,svelte}  broadcast banner, fonts
    layout.css                  Tailwind v4 + shadcn theme tokens
    +page.{server.ts,svelte}    landing
    about/                      about page
    register/, login/, logout/  auth
    forgot-password/, reset-password/[token]/
    verify-email/[token]/
    maintenance/                shown when maintenance_mode=true
    app/                        authenticated app
      +layout.*                 topbar (admin link if applicable)
      +page.*                   bets (home)
      group/[id]/               group page + bet routes
    admin/                      admin panel
  lib/
    components/
      Captcha.svelte
      ui/                       shadcn-svelte components
    server/
      auth/                     session, password, tokens, audit, system-config
      captcha.ts                hCaptcha verifier
      email/                    Resend + console transports + templates
      db/                       schema, migrate, seed, index
      ledger.ts                 transfer/balance/bet helpers
    utils.ts                    cn() helper
drizzle/                        generated migrations
components.json                 shadcn-svelte config
```
