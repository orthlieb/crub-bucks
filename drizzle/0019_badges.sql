CREATE TYPE "public"."badge_tier" AS ENUM('bronze', 'silver', 'gold');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_key" text NOT NULL,
	"tier" "badge_tier" NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metric_value" bigint
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_badges_user_badge_idx" ON "user_badges" USING btree ("user_id","badge_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_badges_user_idx" ON "user_badges" USING btree ("user_id");