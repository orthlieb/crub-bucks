-- Custom SQL migration file, put your code below! --
-- Fast substring search on the admin Users page (ILIKE '%q%' over name/email).
-- Trigram GIN indexes keep it off a sequential scan as the table grows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_trgm_idx" ON "users" USING gin (lower("email") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_display_name_trgm_idx" ON "users" USING gin (lower("display_name") gin_trgm_ops);