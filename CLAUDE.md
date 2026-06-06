# Repo notes for Claude

Crub Bucks is a friends-and-family play-money betting app: a SvelteKit (Svelte 5)
app on a Postgres + Drizzle backend, deployed as a single Node process under PM2
behind Nginx. There is no real money — balances are a closed, zero-sum ledger of
"CB" (Crub Bucks).

## Commands

```bash
npm run dev          # vite dev server
npm run build        # production build (adapter-node)
npm run check        # svelte-kit sync + svelte-check (typecheck)
npm test             # full vitest run (unit + db projects)
npm run db:generate  # drizzle-kit generate (after editing schema.ts)
npm run db:migrate   # apply migrations (src/lib/server/db/migrate.ts)
npm run db:seed      # seed demo users/bets/friendships for local dev
npm run db:studio    # drizzle studio
```

Local Postgres comes from `docker-compose.yml` (postgres:16-alpine). Node version
is pinned in `.nvmrc` (Node 24, which ships npm 11 — required for `npm ci` to
accept esbuild's multi-platform optionalDependencies).

## The ledger is the source of truth — these invariants are load-bearing

Money logic lives in two layers. **Keep them separate.**

- `src/lib/ledger-math.ts` — pure, DB-free settlement math. Unit-tested in
  `ledger-math.test.ts`. No imports from `$lib/server`. This is where bet-mode
  payout calculations live (even_split, winner_loser, tiered, pot, custom, odds).
- `src/lib/server/ledger.ts` — the DB layer: transfers, welcome grants, friend
  handshakes, bet resolution. Calls into `ledger-math.ts` for the numbers.

Invariants that must never be broken:

1. **Zero-sum.** The sum of every wallet balance (all users + the Bank wallet)
   is always 0. Every transfer writes a matched `+delta` / `-delta` pair inside
   one DB transaction. There is no "create money" path except the Bank going
   negative to fund a grant.
2. **No stored balances.** A balance is the SUM of that wallet's `ledger_entries`.
   Never add a cached `balance` column — derive it.
3. **Integers only.** All amounts are whole CB. No fractional values anywhere.
4. **No escrow.** Bets do not hold money while open; CB moves only at resolution
   (or not at all, on cancel).

When you touch payout logic, add/extend a case in `ledger-math.test.ts` first —
the math is meant to be reasoned about in isolation.

## Auth conventions

- **Password hashing is Argon2id** (`src/lib/server/auth/password.ts`). `verifyPassword`
  is async and transparently accepts BOTH new `$argon2id$…` hashes and legacy
  `scrypt$<salt>$<hash>` values, so old accounts keep working. The login action
  **rehashes to Argon2id on successful login** when it sees a legacy hash — do not
  remove that rehash-on-login step; it's how the fleet migrates off scrypt.
- **Password policy** (`src/lib/auth/password-policy.ts` + `password.ts`): min 12
  chars, ≥5 distinct chars, not in the local common-password denylist, and not
  found in a HaveIBeenPwned breach (k-anonymity, see `auth/hibp.ts`). HIBP is
  **fail-open** — if the API is unreachable, registration still proceeds.
- **Sessions** are DB-backed; the token is SHA-256 hashed before storage. Cookie
  uses a sliding 30-day expiry (renewed in the second half of the window) and
  honours the "remember me" choice (persistent vs session cookie).
- **Email enumeration is deliberately prevented.** Registration always responds
  as if it succeeded even for an already-registered email; login returns a single
  generic failure for both unknown-email and wrong-password (and spends a dummy
  verify on unknown emails to equalise timing). Preserve these patterns when
  editing the auth routes.
- Every meaningful auth action is written to the `security_events` audit log via
  `logSecurityEvent`. Add an event for any new auth-affecting action.

## Server-only code

Anything under `src/lib/server/` is server-only (SvelteKit enforces this). Secrets,
the DB client, email transports, and auth internals live there. Client-safe
constants that the server also needs (e.g. password-policy numbers) live OUTSIDE
`server/` so form copy can import them — see `src/lib/auth/password-policy.ts`.

The DB client (`src/lib/server/db/index.ts`) is a lazy Proxy: it does not connect
until first property access, so `DATABASE_URL` is not required at build/prerender
time. Don't eagerly instantiate it at module top level elsewhere.

## Testing

Two Vitest projects, configured in `vite.config.ts`:

- **`unit`** — `*.{test,spec}.ts` (excluding `*.svelte.*` and `*.db.*`). Pure,
  parallel, must never touch the DB or network.
- **`db`** — `*.db.{test,spec}.ts`. Run sequentially in a single fork because they
  share one test database and truncate it between tests.

DB-test safety: `src/test/db.ts`'s `resetDb()` only runs against a database whose
name ends in `_test`, re-checking `current_database()` on every call. Point
`DATABASE_URL` at a `*_test` DB (easiest via a gitignored `.env.test`) to run them
locally. CI spins up a `crubbucks_test` Postgres sidecar.

Any DB-backed suite should `beforeEach(resetDb)` so every test starts from an
empty DB and is independently idempotent.

End-to-end browser tests use Playwright (`npm run test:e2e`, config in
`playwright.config.ts`, specs in `e2e/`). They run against a real dev server +
`*_test` database.

Coverage thresholds are enforced (`vite.config.ts` → `test.coverage.thresholds`).
Run `npm run test:coverage` locally before pushing logic changes.

## Code style

- TypeScript strict mode; no implicit `any`.
- ESLint + Prettier are configured (`eslint.config.js`, `.prettierrc`). Run
  `npm run lint` and `npm run format` before committing. Prettier uses tabs and
  the `prettier-plugin-svelte` plugin; match the existing formatting.
- UI is shadcn-svelte (`components.json`, `src/lib/components/ui/`) on Tailwind v4.
  Design tokens are OKLch CSS variables in `src/routes/layout.css`. Use the `cn()`
  helper (`src/lib/utils.ts`) for conditional classes.

## Deployment

Single Ionos VPS: Nginx (TLS, rate limiting, security headers) → PM2-supervised
Node (`ecosystem.config.cjs`, fork mode) → local Postgres 16 (loopback only).
Push to `main` triggers `.github/workflows/deploy.yml`, which runs the full
typecheck + test + build gate before SSHing in to pull, migrate, rebuild, and
`pm2 reload`. A `/health` probe (pings the DB) gates deploy success. Full runbook
is in `docs/deployment.md`. The app exposes `/maintenance` behind a
`maintenance_mode` system-config gate (admins bypass).
