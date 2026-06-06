# Crub Bucks — How Bets Work

Everything Crub Bucks knows about a bet: its lifecycle, the five modes, how
money is split at resolution, and how ties are settled. This is the
authoritative description of the betting engine as it ships today.

Companion code:

| Path | Purpose |
|------|---------|
| `src/lib/ledger-math.ts` | Pure settlement math (no DB) — split/allocate/plan |
| `src/lib/server/ledger.ts` | `createBet` / `acceptBet` / `resolveBet` / `rebuy` / `cancelBet` |
| `src/routes/app/bet/new/+page.svelte` | Create-a-bet UI |
| `src/routes/app/bet/[bid]/+page.svelte` | Bet detail + resolve UI (incl. the **Tied?** dialog) |

---

## Core principles

1. **The ledger is zero-sum.** Every economic event is a transfer of a
   *positive* amount from one wallet to another, written as two ledger rows
   whose deltas sum to zero. The sum of all balances in the system is always
   zero. Bets never mint or burn Crub Bucks — they only move them between
   players.

2. **Nothing is escrowed.** Stakes are **not** taken when a bet is created or
   accepted. No money moves until the bet is **resolved**. Even pot-mode
   "buy-ins" are just recorded numbers (`boughtIn`) until resolution — a
   re-buy grows the recorded pot but transfers nothing at the time.

3. **A resolution is a set of signed deltas that sum to zero.** Whatever the
   mode, resolving a bet produces one `delta` per participant. Winners have a
   positive delta, losers negative, bystanders zero, and they always sum to
   `0`. Those deltas are turned into loser→winner transfers by the settlement
   engine.

4. **Whole Crub Bucks only.** All amounts are integers. Splits that don't
   divide evenly are handled by the largest-remainder method so the parts
   still sum to the exact pot (no rounding leak).

---

## Lifecycle

```
            create                  all accept
   (none) ─────────▶  pending  ──────────────▶  open  ──────────▶  resolved
                         │                        │     resolve
                         │ any decline            │ cancel
                         ▼                        ▼
                     cancelled  ◀───────────── cancelled
```

| Status | Meaning |
|--------|---------|
| `pending` | Created. The creator is auto-accepted; every other participant has been invited and must accept. |
| `open` | Everyone accepted — the bet is live. Can now be resolved (or cancelled). Pot mode allows re-buys here. |
| `resolved` | Settled. Transfers executed, each participant's outcome and net recorded. Terminal. |
| `cancelled` | Called off (by a decline while pending, or a cancel while pending/open). No money moved. Terminal. |

**Acceptance handshake.** A bet only goes live once **all** participants
accept. A single **decline** calls the whole thing off (status → `cancelled`).
This is why nothing needs to be escrowed: until everyone has agreed, there's
nothing to unwind.

**Who can do what**
- Any participant can **accept** / **decline** while `pending`, and **cancel**
  while `pending` or `open`.
- Any participant can **resolve** an `open` bet (it's a friendly app — there's
  no designated "house").
- A bet can't be resolved or cancelled twice; the status gates enforce this.

**Eligibility.** At creation, every other participant must be an **accepted
friend of the creator**. Co-participants don't all need to be friends with
each other — only with the creator who assembled the bet.

---

## The five modes

Four modes are poolable around a single **pot** (the amount the winner takes);
`custom` is a legacy per-person model. All of them resolve to zero-sum deltas.

> **Note:** `custom` can no longer be *created* in the UI (it was confusing);
> existing custom bets still resolve and display. It's documented here for
> completeness.

### 1. Even split — `even_split`

One winner takes the whole pot; everyone else splits the loss **equally**.

- **Create with:** a positive `pool`.
- **Resolve with:** `winnerId`.
- **Math:** winner `+pool`; each of the `L` losers pays `pool / L`
  (largest-remainder, so the shares sum to exactly `pool`).

**Example** — pool 30, three players, A wins:

| Player | Delta |
|--------|------:|
| A (winner) | +30 |
| B | −15 |
| C | −15 |

### 2. Winner / Loser — `winner_loser`

One winner, one designated loser who pays the whole pot. Anyone else rides
along at zero.

- **Create with:** a positive `pool`.
- **Resolve with:** `winnerId` + `loserId`. (Head-to-head — exactly two
  players — auto-fills the loser once you pick the winner.)
- **Math:** winner `+pool`, loser `−pool`, everyone else `0`.

**Example** — pool 20, three players, A wins, B loses:

| Player | Delta |
|--------|------:|
| A (winner) | +20 |
| B (loser) | −20 |
| C (bystander) | 0 |

### 3. Tiered — `tiered`

One winner; losers pay by **rank**. Last place pays the most.

- **Create with:** a positive `pool`.
- **Resolve with:** `winnerId` + `loserOrder` (ordered least-pays → most-pays).
- **Math:** winner `+pool`. With `L` losers, the rank weights are `1, 2, … L`
  and the denominator is `L(L+1)/2`. So:
  - 2 losers → `1/3, 2/3` of the pot
  - 3 losers → `1/6, 2/6, 3/6` of the pot

**Example** — pool 30, A wins, B ranked first-loser, C ranked last:

| Player | Share | Delta |
|--------|------:|------:|
| A (winner) | — | +30 |
| B | 1/3 | −10 |
| C | 2/3 | −20 |

### 4. Pot — `pot`

Everyone buys in equally; re-buys allowed while open; at resolution you enter
each player's **winnings** (their share of the pot).

- **Create with:** a positive per-player `stake`. The starting pot is
  `stake × players`.
- **Re-buy:** while open, a player can add to their own `boughtIn`, growing the
  pot. (Records numbers only — no transfer yet.)
- **Resolve with:** `winnings[userId]` for every player; the winnings must
  total the pot **exactly**.
- **Math:** per player, `delta = winnings − boughtIn`. Since
  `Σ winnings = Σ boughtIn = pot`, the deltas sum to zero.

**Example** — three players buy in 100 each (pot 300); at resolution A is paid
the whole pot:

| Player | Bought in | Winnings | Delta |
|--------|----------:|---------:|------:|
| A | 100 | 300 | +200 |
| B | 100 | 0 | −100 |
| C | 100 | 0 | −100 |

### 5. Custom (legacy) — `custom`

Each participant has an explicit `payoutIfWin` and `lossIfLose`, set at
creation. At resolution each is marked won/lost; the winners' payouts must
equal the losers' losses or it won't balance.

- **Resolve with:** `outcomes[userId] = 'won' | 'lost'`.
- **Math:** winners `+payoutIfWin`, losers `−lossIfLose`; the two sides must be
  equal. (This is the only mode that can express **uneven** per-person amounts
  today — see the discussion at the end.)

---

## Ties — the manual tie-split

Real games end in dead heats. The pooled modes (even/winner-loser/tiered) each
assume a single winner, so a tie can't be expressed by picking a winner. The
**Tied?** button on the resolve screen (shown for every non-pot mode) opens a
dialog to settle by hand.

**How it works.** The resolver types each player's **net result** directly —
positive for a win, negative for a loss. The same money-conservation rules as a
normal resolution apply, enforced both client- and server-side:

1. **Balances to zero** — `Σ deltas = 0` (every Crub Buck won came from someone).
2. **Moves exactly the pot** — the positive deltas total the bet's `pool`. A
   tie can't invent or shrink what was wagered.
3. **A note is required** — the tie explanation is recorded as the resolution
   note.

It settles **immediately** and does **not** change the bet's stored mode or
stakes — there's no re-acceptance. Each player's recorded outcome is derived
from their delta: `> 0` → won, `< 0` → lost, `0` → none.

**Example** — even-split pool 30; A and B tie for first, C is the lone loser.
A and B split the 30 pot; C covers it:

| Player | Delta |
|--------|------:|
| A | +15 |
| B | +15 |
| C | −30 |

**All-tie wash.** If *everyone* tied and nobody should pay, that's not a
resolution — there's no money to move. **Cancel** the bet instead (in these
modes nothing was escrowed, so cancelling moves nothing). The tie-split
deliberately rejects a "distribute 0" settlement so a real partial tie can't be
fat-fingered into a no-op.

---

## The settlement engine

Once a mode (or the tie-split) produces the per-player deltas, two pure helpers
in `ledger-math.ts` finish the job:

**`allocate(total, weights)`** — splits an integer `total` into integer parts
proportional to `weights`, summing to exactly `total`, using the
**largest-remainder** method. This is how even splits (equal weights) and
tiered splits (weights `1…L`) stay penny-perfect.

**`planSettlement(winners, losers)`** — turns the deltas into actual transfers.
It greedily matches the largest remaining loss to the largest remaining payout,
emitting a compact set of **loser → winner** transfers. Given that the two
sides sum to the same total (guaranteed by zero-sum deltas), every winner ends
up paid and every loser charged.

Each transfer is then written through the ledger's single `transferInTx`
chokepoint as a two-row, zero-sum entry tagged with the bet id.

**Worked end-to-end** — tiered pool 30 (A +30, B −10, C −20):

```
deltas:   A +30 | B −10 | C −20
plan:     C → A  20      (largest loss meets largest payout)
          B → A  10      (remainder)
ledger:   A +30, C −20, B −10   (two rows per transfer, all summing to 0)
```

---

## Side effects of resolving

When a bet resolves, in the same transaction:

- Each participant row gets its `outcome`, `settledDelta`, and (tiered)
  `lossRank`.
- The bet is marked `resolved` with `resolvedAt`, `resolvedBy`, and the note.
- **Stats** update: `betsOpen −1`, `betsResolved +1`, and `bucksWagered +=`
  the total moved.
- **Badges** are re-evaluated for the participants (wins, streaks, biggest pot,
  etc. — see `docs/badges-and-rewards.md`).
- Non-resolver participants get a **"bet settled"** notification linking back to
  the bet.

---

## Quick reference

| Mode | Create input | Resolve input | Winner gets | Losers pay |
|------|--------------|---------------|-------------|------------|
| `even_split` | `pool` | `winnerId` | +pool | pool split equally |
| `winner_loser` | `pool` | `winnerId`, `loserId` | +pool | one loser pays pool; rest 0 |
| `tiered` | `pool` | `winnerId`, `loserOrder` | +pool | by rank: `1…L` over `L(L+1)/2` |
| `pot` | `stake` (+re-buys) | `winnings[]` (sum = pot) | winnings − boughtIn | winnings − boughtIn |
| `custom` *(legacy)* | `payoutIfWin`/`lossIfLose` | `outcomes[]` | +payoutIfWin | −lossIfLose |
| **tie-split** | *(any non-pot bet)* | `manual[]` (Σ=0, wins=pool) | the + you typed | the − you typed |
