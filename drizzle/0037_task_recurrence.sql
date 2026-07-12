-- Replace the flat display-only `cadence` with a proper iCalendar recurrence:
-- `rrule` (full DTSTART+RRULE string) plus `next_due_at` (the current
-- occurrence's target date). Any pre-existing recurring task loses its old
-- cadence label; the app treats a recurring task with a null rrule as simply
-- reopening on approval (no advance).
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "cadence";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "next_due_at" timestamp with time zone;
