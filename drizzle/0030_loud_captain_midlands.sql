ALTER TABLE "ledger_entries" ADD COLUMN "sport_market_id" uuid;--> statement-breakpoint
ALTER TABLE "sport_markets" ADD COLUMN "home_logo" text;--> statement-breakpoint
ALTER TABLE "sport_markets" ADD COLUMN "away_logo" text;--> statement-breakpoint
ALTER TABLE "sport_markets" ADD COLUMN "league_logo" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sport_market_id_sport_markets_id_fk" FOREIGN KEY ("sport_market_id") REFERENCES "public"."sport_markets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_sport_market_idx" ON "ledger_entries" USING btree ("sport_market_id");