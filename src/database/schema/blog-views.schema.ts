import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { blogs } from './blogs.schema';
import { users } from './users.schema';

export const blogViews = pgTable(
  'blog_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    blogId: uuid('blog_id')
      .notNull()
      .references(() => blogs.id, { onDelete: 'cascade' }),
    viewerUserId: uuid('viewer_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    viewerDeviceId: varchar('viewer_device_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    blogIdIdx: index('blog_views_blog_id_idx').on(table.blogId),
    viewerUserIdIdx: index('blog_views_viewer_user_id_idx').on(
      table.viewerUserId,
    ),
    uniqueUserViewIdx: uniqueIndex('blog_views_user_unique_idx')
      .on(table.blogId, table.viewerUserId)
      .where(sql`viewer_user_id IS NOT NULL`),
    uniqueGuestViewIdx: uniqueIndex('blog_views_guest_unique_idx')
      .on(table.blogId, table.viewerDeviceId)
      .where(sql`viewer_user_id IS NULL AND viewer_device_id IS NOT NULL`),
  }),
);
