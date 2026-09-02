import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  buildCursorCondition,
  type CursorPayload,
} from '../../common/helpers/cursor-pagination.helper';
import { DatabaseService } from '../../database/database.service';
import { forums } from '../../database/schema/forums.schema';
import { users } from 'src/database/schema/users.schema';

@Injectable()
export class ForumsRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) { }

  async create(data: {
    userId: string;
    title: string;
    content: string;
    category: string;
    subCategory?: string[];
    mediaId?: string;
    mediaUrl?: string;
    isAnonymous?: boolean;
  }) {
    const [record] = await this.database.db
      .insert(forums)
      .values(data)
      .returning();
    return record;
  }

  async findActiveById(id: string) {
    return this.database.db.query.forums.findFirst({
      where: and(eq(forums.id, id), eq(forums.isActive, true)),
    });
  }

  async listActive(params: {
    limit: number;
    cursor?: CursorPayload;
    userId?: string;
    category?: string;
    subCategory?: string;
    search?: string;
  }) {
    const conditions: SQL[] = [eq(forums.isActive, true)];

    if (params.userId) {
      conditions.push(eq(forums.userId, params.userId));
    }
    if (params.category) {
      conditions.push(eq(forums.category, params.category));
    }
    if (params.subCategory) {
      conditions.push(
        sql`${forums.subCategory} @> ARRAY[${params.subCategory}]::text[]`,
      );
    }
    if (params.search) {
      const term = `%${params.search.replace(/[%_]/g, '\\$&')}%`;
      const searchFilter = or(
        ilike(forums.title, term),
        ilike(forums.content, term),
      );
      if (searchFilter) {
        conditions.push(searchFilter);
      }
    }
    if (params.cursor) {
      const cursorFilter = buildCursorCondition(
        forums.createdAt,
        forums.id,
        params.cursor,
      );
      if (cursorFilter) {
        conditions.push(cursorFilter);
      }
    }

    return this.database.db
      .select({
        id: forums.id,
        title: forums.title,
        content: forums.content,
        category: forums.category,
        subCategory: forums.subCategory,
        mediaId: forums.mediaId,
        mediaUrl: forums.mediaUrl,
        isAnonymous: forums.isAnonymous,
        createdAt: forums.createdAt,
        updatedAt: forums.updatedAt,
        userId: users.appUserId,

      })
      .from(forums)
      .where(and(...conditions))
      .leftJoin(users, eq(forums.userId, users.id))
      .orderBy(desc(forums.createdAt), desc(forums.id))
      .limit(params.limit + 1);
  }

  async update(
    id: string,
    data: {
      title?: string;
      content?: string;
      category?: string;
      subCategory?: string[];
      mediaId?: string;
      mediaUrl?: string;
      isAnonymous?: boolean;
    },
  ) {
    const [record] = await this.database.db
      .update(forums)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(forums.id, id), eq(forums.isActive, true)))
      .returning();
    return record;
  }

  async softDelete(id: string) {
    const [record] = await this.database.db
      .update(forums)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(and(eq(forums.id, id), eq(forums.isActive, true)))
      .returning();

    if (record) {
      await this.database.db.execute(sql`
        UPDATE forum_comments
        SET is_active = false,
            updated_at = now()
        WHERE forum_id = ${id}::uuid
          AND is_active = true
      `);
    }

    return record;
  }
}
