# Push Notifications — Plan

> Status: **proposal / draft for discussion.** Nothing here is built yet.
> Open decisions are collected near the end.

Deliver **real** notifications — to desktop, Android, and iPhone — that arrive
even when the app/tab is closed. Reuse the existing in-app `notifications` table
as the durable record; push is a best-effort *transport* layered on top.

---

## 1. Approach: standards-based Web Push

One implementation covers **all three** platforms — no native apps:

- **Web Push API + Service Worker + VAPID** auth. A single server-side
  [`web-push`](https://www.npmjs.com/package/web-push) call reaches every
  browser's push service (Google for Chrome/Android, Mozilla for Firefox, Apple
  for Safari) — the standard abstracts them.
- **Desktop** (Chrome / Edge / Firefox / Safari 16+) and **Android**
  (Chrome / Firefox): full support, installed or not.
- **iPhone / iPad** — the one constraint: Safari only permits web push when the
  site is **installed to the Home Screen as a PWA** (iOS/iPadOS **16.4+**), and
  only after a user-gesture permission grant. No App Store app required.

---

## 2. Where we are today

| Piece | State |
| --- | --- |
| PWA manifest | ✅ `static/site.webmanifest` (`display: standalone`, `start_url: /app`, `scope: /`) |
| Icons | ✅ `icon-192/512`, maskable, `apple-touch-icon` |
| HTTPS | ✅ (required for push) |
| Server | ✅ `@sveltejs/adapter-node` — long-running, so push can be sent inline (no serverless cold-start) |
| Durable notifications | ✅ `notifications` table + `createNotification()` — already the central chokepoint (called from `ledger.ts`, `badges.ts`, admin broadcasts) |
| **Service worker** | ❌ **missing** — the main prerequisite to add |
| Subscription storage | ❌ to add |
| Send pipeline | ❌ to add |

The single biggest leverage point: **`createNotification()` is already the one
place every targeted notification flows through.** Hook push in there and every
event (bet settled, payment, friend request, badge earned) gets push "for free."

---

## 3. Architecture

```
event (bet settled / payment / friend req / badge)
        │
        ▼
createNotification({ userId, title, body, link })   ← durable row (today)
        │  (new) fan out
        ▼
sendWebPush(userId, payload)
        │  for each of the user's push_subscriptions
        ▼
web-push  ──VAPID-signed, encrypted──▶  browser push service  ──▶  device
                                                                     │
                                                          Service Worker 'push'
                                                                     │
                                                          self.registration.showNotification(...)
                                                                     │
                                                       user taps → 'notificationclick' → open app at link
```

---

## 4. Components

### 4.1 Service worker (`src/service-worker.ts`)
SvelteKit auto-registers this. It handles:
- **`push`** → parse the JSON payload, `self.registration.showNotification(title, { body, icon, badge, data: { url }, tag })`.
- **`notificationclick`** → focus an existing app window or open `data.url`
  (the notification's `link`).
- Push-only to start — **no offline caching** (keeps the blast radius small).

### 4.2 VAPID keys
- Generate one keypair (`web-push generate-vapid-keys`).
- **Public** key ships to the client (used in `pushManager.subscribe`).
- **Private** key is a server secret via `$env/dynamic/private` (same pattern as
  `DATABASE_URL`). Plus a `mailto:` contact for the VAPID "subject".

### 4.3 Subscription store (new table)
```sql
CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,        -- the browser push endpoint
  p256dh      text NOT NULL,               -- client public key
  auth        text NOT NULL,               -- client auth secret
  user_agent  text,                        -- for "which device" UX
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
```
One user → many devices. `endpoint` is unique (re-subscribe upserts).

### 4.4 Client subscribe flow
- Permission requested from a **user gesture** (a toggle in `SettingsDialog`) —
  never auto-prompt on load (it's an anti-pattern and browsers penalize it).
- `await navigator.serviceWorker.ready` → `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public> })`.
- POST the resulting subscription (`endpoint`, `keys.p256dh`, `keys.auth`) to
  `POST /api/push/subscribe`. Unsubscribe → `POST /api/push/unsubscribe`.
- **iOS gate:** if `Notification` / `PushManager` is unavailable *and* the app
  isn't running standalone, show an "Add to Home Screen to enable
  notifications" hint instead of a dead toggle. Detect install via
  `matchMedia('(display-mode: standalone)')` / `navigator.standalone`.

### 4.5 Server send (`sendWebPush`)
- `sendWebPush(userId, payload)` loads the user's subscriptions and sends each
  via `web-push` (VAPID-signed, AES128GCM-encrypted body).
- Called from `createNotification()` when `userId` is set (targeted). Broadcasts
  (admin, `userId = null`) are out of scope for v1.
- **Prune dead subscriptions:** on `404`/`410` from the push service, delete the
  row. Best-effort + `.catch()` so a push failure never breaks the request.
- Best-effort delivery (push services don't guarantee) — the in-app row remains
  the source of truth.

### 4.6 Preferences
- A per-user opt-in (default off until they enable in Settings). Optionally
  per-category later (bets / payments / friends / badges).
- Honored inside `sendWebPush`; the in-app notification still always records.

### 4.7 Resilience & ops
- TTL + urgency headers per notification type.
- Graceful degradation: feature-detect Push API; unsupported → in-app only,
  hide the toggle.
- VAPID key rotation plan (re-subscribe on rotation).
- Light rate limiting / de-dupe; logging of send outcomes.
- Behind a feature flag for staged rollout.

---

## 5. Platform support matrix

| Platform | Browser | Works? | Notes |
| --- | --- | --- | --- |
| Desktop | Chrome / Edge | ✅ | installed or in-tab |
| Desktop | Firefox | ✅ | |
| Desktop | Safari (macOS 13+) | ✅ | |
| Android | Chrome / Firefox | ✅ | installed or in-tab |
| **iPhone / iPad** | Safari (iOS 16.4+) | ⚠️ | **only as an installed Home-Screen PWA** |
| Any | unsupported/older | ⛔ | falls back to in-app notifications only |

---

## 6. Decisions (all settled)

1. ~~**Payload privacy.**~~ **Decided: full detail.** The pushed payload reuses
   the in-app notification's title/body verbatim (amounts and all) — so
   `sendWebPush` just forwards what `createNotification` already produced.
2. ~~**Send path.**~~ **Decided: inline, fire-and-forget.** `createNotification`
   kicks off `sendWebPush` without awaiting it (wrapped in `.catch`); the
   request returns immediately. Can evolve to a queue later if volume warrants.
3. ~~**Permission timing/placement.**~~ **Decided: Settings toggle + a one-time
   soft nudge.** A Notifications toggle in Settings is the source of truth; plus
   a one-time dismissible in-app banner (soft pre-prompt) whose "Enable" fires
   the real OS prompt. Never auto-prompt on load.
4. ~~**iOS UX.**~~ **Decided: proactive install banner.** On iOS-not-installed,
   show a one-time "Install Crub Bucks (full app + notifications)" banner with
   Share → Add to Home Screen steps, and route the notifications soft-nudge to
   it. In-app-only remains the fallback for those who don't install.
5. ~~**Preference granularity.**~~ **Decided: global on/off.** One toggle pushes
   everything that creates an in-app notification, or nothing. Per-category can
   be added later without a data migration (the toggle gates `sendWebPush`).
6. ~~**Subscription lifecycle.**~~ **Decided: drop on logout, re-subscribe on
   login.** Multi-device (one user → many subscriptions). On logout, delete that
   device's subscription; on next login, silently re-subscribe if the OS
   permission is still granted (so it's seamless and shared-device-safe).
7. ~~**Service-worker scope.**~~ **Decided: push-only.** The service worker only
   handles `push` + `notificationclick` — no offline caching (separate project).

---

## 7. Phasing

1. **Plumbing (no sends yet).** Service worker, VAPID keys, `push_subscriptions`
   table + migration, the subscribe/unsubscribe endpoints, and the Settings
   toggle. Verify real subscriptions land in the DB across browsers.
2. **Sending.** `sendWebPush`, hook into `createNotification()`, dead-sub
   pruning. Run the test matrix (incl. an installed iOS PWA).
3. **Polish.** iOS install nudge, preference handling, graceful degradation,
   feature-flag rollout.
4. **Optional later.** Per-category preferences, richer payloads/actions, a
   queue/worker if volume ever warrants, broadcast pushes.

---

## 8. Component recap

```
src/service-worker.ts          push + notificationclick handlers          [new]
push_subscriptions table       per-device subscriptions                   [new]
/api/push/(un)subscribe        client subscription endpoints              [new]
$lib/server/push.ts            sendWebPush() via web-push + VAPID          [new]
createNotification()           fan out to sendWebPush (one hook)           [edit]
SettingsDialog                 permission toggle + iOS install hint        [edit]
web-push (npm), VAPID env      dependency + secrets                        [new]
notifications table            unchanged — stays the durable record
```
