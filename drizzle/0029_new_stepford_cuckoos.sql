CREATE TYPE "public"."sport_market_status" AS ENUM('open', 'closed', 'resolved', 'void');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"sport" text NOT NULL,
	"league" text NOT NULL,
	"home_name" text NOT NULL,
	"home_abbr" text NOT NULL,
	"away_name" text NOT NULL,
	"away_abbr" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"status" "sport_market_status" DEFAULT 'open' NOT NULL,
	"winning_side" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_wagers" (
	"market_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" text NOT NULL,
	"stake" bigint NOT NULL,
	"settled_delta" bigint,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_wagers_market_id_user_id_pk" PRIMARY KEY("market_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sport_markets" ADD CONSTRAINT "sport_markets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sport_markets" ADD CONSTRAINT "sport_markets_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sport_wagers" ADD CONSTRAINT "sport_wagers_market_id_sport_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."sport_markets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sport_wagers" ADD CONSTRAINT "sport_wagers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sport_markets_event_idx" ON "sport_markets" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_markets_status_idx" ON "sport_markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_wagers_user_idx" ON "sport_wagers" USING btree ("user_id");