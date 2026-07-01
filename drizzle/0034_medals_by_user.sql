DROP TABLE IF EXISTS "leaderboard_medals";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leaderboard_medals" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leaderboard_medals" ADD CONSTRAINT "leaderboard_medals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
