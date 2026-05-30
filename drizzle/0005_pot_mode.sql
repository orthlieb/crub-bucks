ALTER TYPE "public"."bet_mode" ADD VALUE 'pot' BEFORE 'custom';--> statement-breakpoint
ALTER TABLE "bet_participants" ADD COLUMN "bought_in" bigint;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "stake" bigint;