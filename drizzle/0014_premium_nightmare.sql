
ALTER TYPE "public"."blog_status" ADD VALUE 'APPROVED' BEFORE 'PUBLISHED';--> statement-breakpoint
ALTER TYPE "public"."blog_status" ADD VALUE 'REJECTED' BEFORE 'PUBLISHED';