ALTER TABLE "project_comments"
  ADD COLUMN IF NOT EXISTS "task_id" text
  REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_comments_task_idx"
  ON "project_comments" USING btree ("task_id");
