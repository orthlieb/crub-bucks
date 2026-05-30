CREATE TYPE "public"."bet_mode" AS ENUM('even_split', 'winner_loser', 'tiered', 'custom');--> statement-breakpoint
ALTER TYPE "public"."bet_outcome" ADD VALUE 'none';--> statement-breakpoint
ALTER TABLE "bet_participants" ALTER COLUMN "payout_if_win" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_participants" ALTER COLUMN "loss_if_lose" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_participants" ADD COLUMN "settled_delta" bigint;--> statement-breakpoint
ALTER TABLE "bet_participants" ADD COLUMN "loss_rank" integer;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "mode" "bet_mode" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "pool" bigint;