CREATE TABLE "blog_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"viewer_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_views" ADD CONSTRAINT "blog_views_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_views" ADD CONSTRAINT "blog_views_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blog_views_blog_id_idx" ON "blog_views" USING btree ("blog_id");--> statement-breakpoint
CREATE INDEX "blog_views_viewer_user_id_idx" ON "blog_views" USING btree ("viewer_user_id");