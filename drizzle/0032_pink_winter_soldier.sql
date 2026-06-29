-- Add the per-user QR/share token. Done in steps so existing rows get a unique
-- value before the NOT NULL + UNIQUE constraints are enforced. New rows are
-- filled by the app (schema $defaultFn → base64url); the backfill here just needs
-- per-row uniqueness, so a dash-stripped uuid (gen_random_uuid is already used by
-- the table's id default) is sufficient.
ALTER TABLE "users" ADD COLUMN "qr_token" text;--> statement-breakpoint
UPDATE "users" SET "qr_token" = replace(gen_random_uuid()::text, '-', '') WHERE "qr_token" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "qr_token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_qr_token_unique" UNIQUE("qr_token");
