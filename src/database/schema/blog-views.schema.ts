import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    blogIdIdx: index('blog_views_blog_id_idx').on(table.blogId),
    viewerUserIdIdx: index('blog_views_viewer_user_id_idx').on(
      table.viewerUserId,
    ),
  }),
);
