CREATE TABLE IF NOT EXISTS "app_stats" (
	"id" integer PRIMARY KEY NOT NULL,
	"bets_open" bigint DEFAULT 0 NOT NULL,
	"bets_resolved" bigint DEFAULT 0 NOT NULL,
	"bucks_wagered" bigint DEFAULT 0 NOT NULL,
	"bank_total" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Seed the singleton (id = 1) from existing data so the counters start correct.
INSERT INTO "app_stats" ("id", "bets_open", "bets_resolved", "bucks_wagered", "bank_total")
VALUES (
	1,
	(SELECT count(*) FROM "bets" WHERE "status" = 'open'),
	(SELECT count(*) FROM "bets" WHERE "status" = 'resolved'),
	(SELECT coalesce(sum("delta"), 0) FROM "ledger_entries" WHERE "bet_id" IS NOT NULL AND "delta" > 0),
	(SELECT coalesce(sum("le"."delta"), 0) FROM "ledger_entries" "le" JOIN "wallets" "w" ON "w"."id" = "le"."wallet_id" WHERE "w"."kind" = 'bank')
)
ON CONFLICT ("id") DO NOTHING;
