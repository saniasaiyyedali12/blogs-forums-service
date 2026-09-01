import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { media } from './media.schema';
import { users } from './users.schema';
import { BlogStatus } from '../../modules/blogs/enums/blog.enum';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const blogStatusEnum = pgEnum('blog_status', BlogStatus);

export const blogs = pgTable(
  'blogs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: varchar('title', { length: 255 }),
    slug: varchar('slug', { length: 255 }),
    content: text('content'),
    thumbnailMediaId: uuid('thumbnail_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
    thumbnailUrl: varchar('thumbnail_url', { length: 2048 }),
    tags: text('tags').array(),
    links: text('links').array(),
    mediaUrls: text('media_urls').array(),
    status: blogStatusEnum('status').notNull().default(BlogStatus.DRAFT),
    readingTime: integer('reading_time'),
    likeCount: integer('like_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    searchVector: tsvector('search_vector'),
  },
  (table) => ({
    slugUid: uniqueIndex('blogs_slug_uidx').on(table.slug),
    userIdIdx: index('blogs_user_id_idx').on(table.userId),
    statusIdx: index('blogs_status_idx').on(table.status),
    createdAtIdx: index('blogs_created_at_idx').on(table.createdAt),
    searchVectorGinIdx: index('blogs_search_vector_gin_idx').using(
      'gin',
      table.searchVector,
    ),
  }),
);
