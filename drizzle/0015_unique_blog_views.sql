ALTER TABLE "blog_views" ADD COLUMN IF NOT EXISTS "viewer_device_id" varchar(255);--> statement-breakpoint
DELETE FROM blog_views WHERE id NOT IN (SELECT DISTINCT ON (blog_id, viewer_user_id) id FROM blog_views WHERE viewer_user_id IS NOT NULL ORDER BY blog_id, viewer_user_id, created_at ASC) AND viewer_user_id IS NOT NULL;--> statement-breakpoint
DELETE FROM blog_views WHERE id NOT IN (SELECT DISTINCT ON (blog_id, viewer_device_id) id FROM blog_views WHERE viewer_user_id IS NULL AND viewer_device_id IS NOT NULL ORDER BY blog_id, viewer_device_id, created_at ASC) AND viewer_user_id IS NULL AND viewer_device_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_views_user_unique_idx" ON "blog_views" ("blog_id", "viewer_user_id") WHERE viewer_user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_views_guest_unique_idx" ON "blog_views" ("blog_id", "viewer_device_id") WHERE viewer_user_id IS NULL AND viewer_device_id IS NOT NULL;
