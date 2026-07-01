CREATE TABLE IF NOT EXISTS "leaderboard_medals" (
	"rank" integer PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leaderboard_medals" ADD CONSTRAINT "leaderboard_medals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
