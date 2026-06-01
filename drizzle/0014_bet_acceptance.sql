ALTER TYPE "public"."bet_status" ADD VALUE 'pending' BEFORE 'open';--> statement-breakpoint
ALTER TABLE "bet_participants" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
-- Grandfather existing bets: every participant of an already-created bet counts
-- as accepted (those bets predate the acceptance handshake and are already live
-- or finished). Stamp accepted_at from the bet's created_at.
UPDATE "bet_participants" SET "accepted_at" = "bets"."created_at"
FROM "bets" WHERE "bet_participants"."bet_id" = "bets"."id";