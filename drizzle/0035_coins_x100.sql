-- Introduce 1/100-CB internal precision ("Crub Coins"). Every stored money value
-- is whole CB today; multiply by 100 so the ledger integer is now coins. Balances
-- are derived from ledger_entries, so scaling the entries (and the stored bet /
-- wager terms + stats) rescales everyone consistently and keeps the books at zero.
UPDATE "ledger_entries" SET "delta" = "delta" * 100;--> statement-breakpoint
UPDATE "bets" SET "pool" = "pool" * 100;--> statement-breakpoint
UPDATE "bets" SET "stake" = "stake" * 100;--> statement-breakpoint
UPDATE "bet_participants" SET "payout_if_win" = "payout_if_win" * 100;--> statement-breakpoint
UPDATE "bet_participants" SET "loss_if_lose" = "loss_if_lose" * 100;--> statement-breakpoint
UPDATE "bet_participants" SET "settled_delta" = "settled_delta" * 100;--> statement-breakpoint
UPDATE "bet_participants" SET "bought_in" = "bought_in" * 100;--> statement-breakpoint
UPDATE "sport_wagers" SET "stake" = "stake" * 100;--> statement-breakpoint
UPDATE "sport_wagers" SET "settled_delta" = "settled_delta" * 100;--> statement-breakpoint
UPDATE "app_stats" SET "bucks_wagered" = "bucks_wagered" * 100, "bank_total" = "bank_total" * 100;
