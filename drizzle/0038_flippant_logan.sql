CREATE TABLE IF NOT EXISTS "task_audience" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_audience_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_audience" ADD CONSTRAINT "task_audience_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_audience" ADD CONSTRAINT "task_audience_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_audience_task_idx" ON "task_audience" USING btree ("task_id");