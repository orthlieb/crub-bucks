# Badges & Rewards — Design

> Status: **partially implemented.** The framework + the first 3 badges
> (First Steps, Winner, All-In) are built behind a new **Awards** tab:
> migration `0019_badges`, the code registry, the forward-only evaluator,
> the `resolveBet` hook, earner + friend notifications, the `badge_earned`
> feed item, the Awards badge wall, and `scripts/backfill-badges.ts`.
> **Remaining:** Big Pot (paused) + badges 5–11 (unreviewed), Q6 gaming
> guards, and polish (award toast, header flourish, sound cue). Open questions
> are at the end; resolved ones are struck through.

A framework for awarding **badges** to players for one-time accomplishments.
Each badge has **bronze / silver / gold** tiers representing escalating levels
of the same achievement. Earning a badge notifies the earner *and* their
friends.

---

## 1. Goals & principles

- **One-time accomplishments.** You can never earn the same badge tier twice.
  Each `(user, badge, tier)` is awarded at most once, ever.
- **Tiered.** Every badge has three thresholds — bronze (entry), silver (solid),
  gold (impressive). The same achievement, three altitudes.
- **Progressive.** You climb a badge over time: bronze → silver → gold. Your
  *displayed* badge is the highest tier you've reached.
- **Social.** When you earn a badge, you get a celebratory notification and each
  of your friends gets an informational one. Achievements are meant to be seen.
- **Derived, not gamed.** Badges are computed from real ledger/bet history, so
  they can be **recomputed from source** if criteria change or data drifts
  (mirrors the existing `recomputeStats()` pattern).
- **Play-money spirit.** Badges are cosmetic bragging rights. They never affect
  balances, bet mechanics, or permissions.

---

## 2. Core concepts

| Term | Meaning |
| --- | --- |
| **Badge** | A category of achievement, identified by a stable `key` (e.g. `high_roller`). Defined in code. |
| **Tier** | `bronze` \| `silver` \| `gold`. Ordered. Each tier has its own threshold. |
| **Metric** | The number a badge measures (e.g. lifetime CB wagered, bets won, friends). |
| **Award** | A row recording that a user crossed a tier threshold, with a timestamp. Immutable. |
| **Holding** | The set of a user's awards. Their *current* tier for a badge = the highest tier they've been awarded. |

### One-time semantics (decided: climb, keep only highest)

- A user holds **at most one row per badge** — `UNIQUE (user_id, badge_key)`.
  The row stores the **current highest tier**, upgraded in place as you climb.
- You can't earn the same *tier* twice: an award only ever moves **forward**
  (bronze → silver → gold). Re-evaluating never re-fires a tier you already hold.
- Each forward step (first-time bronze, the silver upgrade, the gold upgrade) is
  a distinct one-time event and triggers one notification + friend fan-out.
- No per-tier history is kept — only the current tier and the date it was
  reached. (If we ever want an "earned bronze on…" timeline, we'd switch to a
  per-tier award log; out of scope for the chosen model.)
- If a single event vaults past multiple thresholds at once (first bet is a
  500 ₡ pot → silver directly), the row lands on the **highest** qualified tier
  and sends **one** notification, for that tier.

---

## 3. Badge catalog (proposed)

Thresholds are starting points to tune against real data. All metrics are
**lifetime** and **monotonic** (they only go up), which is what keeps badges
one-time and recomputable. Metrics that could otherwise decrease (e.g. current
balance, friend count) use a *high-water mark* so a badge already earned is
never revoked.

| Badge | `key` | Metric | 🥉 Bronze | 🥈 Silver | 🥇 Gold |
| --- | --- | --- | --- | --- | --- |
| **First Steps** | `first_steps` | Bets joined (any outcome) | 5 | 25 | 100 |
| **Winner, winner, chicken dinner!** | `winner` | Bets won | 5 | 25 | 50 |
| **All-In** | `all_in` | Lifetime ₡ wagered ("zero impulse control") | 100 | 1,000 | 10,000 |
| **Big Pot** | `big_pot` | Largest single bet pot you were in | 50 | 250 | 1,000 |
| **On a Heater** | `heater` | Longest win streak | 3 | 5 | 10 |
| **The House** | `the_house` | Bets you resolved (settled) | 5 | 25 | 100 |
| **Philanthropist** | `philanthropist` | Lifetime ₡ paid to friends (peer payments) | 100 | 1,000 | 10,000 |
| **Social Butterfly** | `social` | Accepted friends (high-water mark) | 3 | 10 | 25 |
| **Recruiter** | `recruiter` | Invited friends who joined | 1 | 5 | 15 |
| **Comeback Kid** | `comeback` | Climbed from ≤ −50 ₡ back to ≥ +100 ₡ | — | — | once 🥇 |
| **Veteran** | `veteran` | Account age in days | 30 | 180 | 365 |

Notes:
- **Comeback Kid** is a single-tier (gold) one-shot. Badges may define 1–3
  tiers; the registry's `thresholds` map is a partial, so a one-shot just
  specifies one tier (designer's choice of color).
- **On a Heater** measures the *longest* streak ever, so losing a streak never
  removes the badge.
- **Social Butterfly** uses a high-water mark: unfriending someone later doesn't
  strip a badge you legitimately earned.
- Metrics map cleanly to existing data: `bet_participants.outcome`,
  `bet_participants.settled_delta`, `bets.pool`, `bets.resolved_by`,
  `ledger_entries` (peer payments), `friendships`, `friend_invites.claimed_at`,
  `users.created_at`.

---

## 4. Tier visuals

`BadgeTile.svelte` renders a badge one of two ways (picked automatically,
falling back to the emoji while art is unfinished):

- **Single tintable silhouette (preferred — one image per badge).**
  `static/awards/<slug>.svg` (slug = key with `_`→`-`). The UI CSS-masks the
  silhouette and fills it with the **tier color** when earned, or a muted gray
  when locked — so one asset covers bronze, silver, gold, *and* the ghost. No
  separate ghost image is ever needed. Trade-off: a flat single color (no
  metallic gradient), so a silhouette/alpha shape works best. SVG is crispest;
  a transparent grayscale PNG also works as the mask.
- **Per-tier art (alternative).** `static/awards/<slug>-<tier>.png` — one PNG per
  tier (e.g. `first-steps-bronze.png`). Richer illustrated art, but three files
  per badge. Locked still needs no ghost asset — CSS desaturates + dims it.

- **Tier colors** (silhouette fill + rings/labels): bronze `#cd7f32`, silver
  `#9ca3af`, gold `#f5b301`.
- **Ghost = CSS, not an asset.** Locked badges are auto-greyed (muted fill or
  grayscale + reduced opacity) with the next threshold as a progress hint
  ("12 / 25 wins → Silver"). You never author a separate ghost image.
- **Text contexts** (notification copy, feed labels) use a tier emoji (🥉🥈🥇).

---

## 5. Data model

Two new tables + a code-side registry. Badge *definitions* live in code (static,
versioned, easy to tune); only *awards* are persisted.

### 5.1 Migration `0019_badges.sql` (proposed)

```sql
CREATE TYPE badge_tier AS ENUM ('bronze', 'silver', 'gold');

-- One row per (user, badge); the tier is upgraded in place as the user climbs.
CREATE TABLE user_badges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key    text NOT NULL,                -- matches a code registry key
  tier         badge_tier NOT NULL,          -- current highest tier reached
  earned_at    timestamptz NOT NULL DEFAULT now(), -- when the current tier was reached
  -- snapshot of the metric value at the current tier, for display/debugging
  metric_value bigint,
  UNIQUE (user_id, badge_key)                -- one badge per user; upgraded in place
);
CREATE INDEX user_badges_user_idx ON user_badges (user_id);

-- High-water marks for metrics that can otherwise decrease (friends, balance).
-- Lets us keep evaluation cheap and keep earned badges from ever being revoked.
CREATE TABLE user_badge_progress (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_key  text NOT NULL,                 -- e.g. 'max_friends', 'max_balance'
  value       bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, metric_key)
);
```

The `UNIQUE (user_id, badge_key)` constraint plus a **forward-only upsert** is
the heart of "you can't earn the same badge twice":

```sql
INSERT INTO user_badges (user_id, badge_key, tier, metric_value)
VALUES ($1, $2, $tier, $value)
ON CONFLICT (user_id, badge_key) DO UPDATE
  SET tier = EXCLUDED.tier, earned_at = now(), metric_value = EXCLUDED.metric_value
  WHERE EXCLUDED.tier > user_badges.tier      -- only ever move forward
RETURNING *;                                  -- a returned row = newly earned/upgraded → notify
```

`badge_tier` enum values are declared bronze < silver < gold, so `>` compares by
tier rank. `RETURNING` yields a row only when something actually changed, so we
notify exactly on real upgrades and never twice for the same tier.

### 5.2 Code registry (`src/lib/server/badges/catalog.ts`)

```ts
export type BadgeTier = 'bronze' | 'silver' | 'gold';

export interface BadgeDef {
  key: string;                   // snake_case, e.g. 'first_steps'
  title: string;                 // "High Roller"
  description: string;           // shown on the badge
  emoji?: string;                // tier-agnostic emoji for text (notifications/feed)
  // Tier art is resolved by convention, no field needed:
  //   /awards/${key.replaceAll('_','-')}-${tier}.png
  /** Which lifetime metric this reads. */
  metric: MetricKey;
  /** Ascending thresholds; omit a tier for single/double-level badges. */
  thresholds: Partial<Record<BadgeTier, number>>;
}

export const BADGES: BadgeDef[] = [ /* the catalog from §3 */ ];
```

Keeping definitions in code means tuning a threshold is a code change (review +
deploy), and a `recomputeBadges()` job can re-derive every award from scratch.

---

## 6. Awarding pipeline

### 6.1 When evaluation runs

Badges are evaluated **right after the events that can change a metric**, inside
or just after the same transaction (mirroring how `bumpStats()` is called in the
ledger today):

| Event | Badges potentially affected |
| --- | --- |
| Bet resolved (`resolveBet`) | First Steps, Winner, High Roller, Big Pot, On a Heater, The House |
| Peer payment (`transferBetweenUsers`) | Philanthropist |
| Friend request accepted (`acceptFriendRequest`) | Social Butterfly |
| Invite claimed on signup (`materializeInvite*`) | Recruiter (for the inviter) |
| Balance change (any transfer) | Comeback Kid |
| Login / daily tick | Veteran (age-based; can also be a nightly cron) |

A single entry point keeps it tidy:

```ts
// Evaluate one user against a subset of badges, award new tiers, return them.
await evaluateBadges(userId, { only: ['winner', 'high_roller', 'big_pot'] });
```

`evaluateBadges`:
1. Computes the current value of each relevant metric from source tables
   (and bumps `user_badge_progress` high-water marks where needed).
2. For each badge, finds the highest tier whose threshold is met.
3. Upserts the badge to the highest qualified tier via the forward-only
   `ON CONFLICT … DO UPDATE … WHERE EXCLUDED.tier > tier` statement above,
   capturing (via `RETURNING`) whether it was newly earned or upgraded.
4. Hands newly inserted awards to the notification fan-out (§7).

Evaluation is **idempotent**: running it twice awards nothing new. That makes a
backfill/recompute safe to run anytime.

### 6.2 Failure isolation

Badge evaluation is a *best-effort side effect* — like the existing
`createNotification(...).catch(() => {})` calls. A failure to award a badge must
never roll back a bet resolution or a payment. Run it after the core transaction
commits, wrapped in try/catch with a warning log.

---

## 7. Notifications & friend fan-out

Reuses the existing `notifications` table and `createNotification()` — no new
notification infrastructure.

For each newly awarded badge tier:

- **To the earner** — one `success` notification:
  > 🥇 You earned **Gold High Roller** — 10,000 ₡ wagered. Nice.

  `link: /app/u/<earnerId>` (their profile/badge wall).

- **To each accepted friend** — one `info` notification:
  > 🥇 **Alice** earned the **Gold High Roller** badge.

  `link: /app/u/<earnerId>`.

Fan-out uses `getFriends(earnerId)`. With the 99-friend cap, that's at most 99 +
1 rows per award — acceptable as a batch insert. Considerations:

- **Batch insert** all friend rows in one statement rather than a loop.
- **Sound cue (optional):** the layout already plays cues on polled signals;
  a badge could trigger a celebratory sound for the earner (reuse `play('yes')`
  or a new `badge` sound).
- **Feed (decided — include):** badge awards surface as a `badge_earned` feed
  item alongside bets and payments. The feed is *derived* (no events table), so
  this adds one source query over `user_badges` (recent rows, audience-filtered
  to viewer + friends, ordered by `earned_at`) producing items like
  "Alice earned 🥇 Gold High Roller." Renders through the existing
  `FeedItemRow`: badge icon in the state column, tier as the label, no amount.
  The earner is the item's single "person" (with a tier-colored avatar ring,
  reusing that mechanic).
- **De-dupe / digest (optional):** if someone vaults several badges from one
  action, consider a single combined notification rather than N.

---

## 8. UI surfaces

- **Awards tab + badge wall** — a new top-level nav tab **Awards**
  (`/app/awards`, 4th tab after Bets/Feed/Friends, icon `static/awards.png`):
  a grid of all badges, earned ones lit in their tier color with the earned
  date, unearned ones greyed with a progress hint. This is the current user's
  own badge wall. (Nav lives in `navlinks` in `app/+layout.svelte`; adding a
  4th tab tightens the mobile tab strip — they're `flex-1`, so they fit, just
  narrower. The existing swipe-between-tabs gesture extends automatically.)
- **Header / avatar flourish:** show the user's top 1–3 badges next to their
  name; optionally a tier ring on the avatar.
- **Award toast:** a celebratory in-app toast/dialog when you earn one
  (distinct from the quieter notification bell).
- **Friend's badges:** surfaced on the friends list / friend detail panel.
- **Feed item (optional):** "Alice earned 🥇 Gold High Roller."

---

## 9. Rules & edge cases

- **Never revoked.** Once awarded, a tier is permanent — even if the underlying
  metric later drops (unfriending, going negative). High-water marks enforce
  this for non-monotonic metrics.
- **Self-dealing guard.** Metrics built on social actions should resist gaming:
  e.g. Recruiter counts only invites that result in a *distinct* real signup;
  Philanthropist counts peer payments but we may want to exclude immediate
  round-trips (A→B→A) — see open questions.
- **Account deletion.** `ON DELETE CASCADE` drops a departed user's awards; their
  friends' historical notifications already standalone (text), so nothing breaks.
- **Backfill.** On first ship, run `recomputeBadges()` across all users so
  existing players immediately hold the badges their history earned —
  **silently** (no retroactive notification storm). Notifications only fire for
  awards earned *after* the feature is live.
- **Threshold changes.** Lowering a threshold may award new badges on the next
  evaluation (fine). Raising one never revokes already-granted awards.
- **Broadcasts vs targeted.** Badge notifications are always *targeted*
  (`user_id` set), never broadcasts.

---

## 10. Open questions (need your call)

1. **Tier vs. badge uniqueness.** "Can't earn the same badge twice" — confirmed
   reading is *can't earn the same `(badge, tier)` twice*, but you progress
   bronze→silver→gold over time. Correct? Or should a badge be a single
   one-shot award where the tier is just its difficulty at the moment earned?
2. ~~**Multi-tier jump notifications.**~~ **Resolved by Q1:** keep-only-highest
   means a multi-tier jump lands on the highest tier and sends one notification.
3. ~~**Single-level badges.**~~ **Resolved:** badges may define 1–3 tiers
   (`thresholds` is a partial map). Comeback Kid is a single gold one-shot.
4. ~~**Feed integration.**~~ **Resolved:** yes — badge awards also appear in the
   activity feed as a derived `badge_earned` item (over `user_badges`).
5. **Catalog (in review).** Walking the catalog badge-by-badge; each is being
   approved / modified / rejected. Verdicts recorded in §3 as we go.
6. **Gaming guards.** How strict on self-dealing (payment round-trips, mutual
   invite farming)? Strict = more queries; lenient = simpler.
7. ~~**Profile route.**~~ **Resolved:** a new top-level **Awards** tab
   (`/app/awards`, icon `static/awards.png`) hosts the current user's badge
   wall. (Viewing a *friend's* badges — e.g. from the friends list — is still
   open; can be added later.)

---

## 11. Suggested phasing

1. **Schema + registry** — migration `0019`, `catalog.ts`, `evaluateBadges()`,
   `recomputeBadges()`. No UI. Unit + DB tests for award idempotency and the
   one-time constraint.
2. **Hooks + notifications** — wire `evaluateBadges` into `resolveBet`,
   payments, friend accept, invite claim; friend fan-out. Backfill silently.
3. **UI** — the Awards tab + badge wall, the `badge_earned` feed item, award
   toast, header flourish.
4. **Polish (optional)** — sound cue, progress hints, seasonal badges,
   viewing a friend's badge wall.

---

## 12. Data-model recap

```
users ──1:N── user_badges            (user_id, badge_key) UNIQUE — tier upgraded in place
users ──1:N── user_badge_progress    (user_id, metric_key) → high-water value  [deferred]
notifications                        reused as-is for earner + friend fan-out
BADGES registry (code)               static definitions, thresholds, icons
```

---

## 13. Future work

- **Real push notifications (mobile/desktop) — TODO.** Today badge alerts are
  in-app only: the notification bell, the `badge_earned` feed item, and the
  "wow" sound *while the tab is open*. Add Web Push (service worker + VAPID) so
  awards (and other notifications) reach users when the app isn't focused;
  native wrappers later. Tracked separately from the badge framework.
- **Award sound (done).** `wow.mp3` plays once when *you* earn an award —
  driven by a `lastBadgeAt` signal in the layout poll (mirrors the
  cash/slide/yes/no cues), with a synth fanfare fallback if the file is missing.
- **Polish (open).** Award toast / header flourish; viewing a friend's badge
  wall; seasonal badges.
