import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  buildCursorCondition,
  type CursorPayload,
} from '../../common/helpers/cursor-pagination.helper';
import { DatabaseService } from '../../database/database.service';
import { forumComments } from '../../database/schema/forums.schema';
import { users } from '../../database/schema/users.schema';

export type ForumCommentReply = {
  parentCommentId: string;
  content: string;
  createdAt: Date;
  userId: string;
};

export type ForumCommentFormatted = {
  id: string;
  forumId: string;
  userId: string;
  content: string;
  parentCommentId: string | null;
  isReply: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  replies: ForumCommentReply[];
};

@Injectable()
export class ForumCommentsRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  async create(data: {
    forumId: string;
    userId: string;
    content: string;
    parentCommentId?: string | null;
    isReply: boolean;
  }): Promise<ForumCommentFormatted | undefined> {
    const [record] = await this.database.db
      .insert(forumComments)
      .values({
        forumId: data.forumId,
        userId: data.userId,
        content: data.content,
        parentCommentId: data.parentCommentId,
        isReply: data.isReply,
        isActive: true,
      })
      .returning();
    if (!record) return undefined;
    return this.findActiveById(record.id);
  }

  async findActiveById(id: string): Promise<ForumCommentFormatted | undefined> {
    const [record] = await this.database.db
      .select({
        id: forumComments.id,
        forumId: forumComments.forumId,
        userId: forumComments.userId,
        appUserId: users.appUserId,
        content: forumComments.content,
        parentCommentId: forumComments.parentCommentId,
        isReply: forumComments.isReply,
        isActive: forumComments.isActive,
        createdAt: forumComments.createdAt,
        updatedAt: forumComments.updatedAt,
      })
      .from(forumComments)
      .leftJoin(users, eq(forumComments.userId, users.id))
      .where(and(eq(forumComments.id, id), eq(forumComments.isActive, true)))
      .limit(1);

    if (!record) return undefined;

    let replies: ForumCommentReply[] = [];
    if (!record.isReply) {
      const rawReplies = await this.database.db
        .select({
          parentCommentId: forumComments.parentCommentId,
          content: forumComments.content,
          createdAt: forumComments.createdAt,
          appUserId: users.appUserId,
          userId: forumComments.userId,
        })
        .from(forumComments)
        .leftJoin(users, eq(forumComments.userId, users.id))
        .where(
          and(
            eq(forumComments.parentCommentId, record.id),
            eq(forumComments.isActive, true),
          ),
        )
        .orderBy(forumComments.createdAt, forumComments.id);

      replies = rawReplies.map((r) => ({
        parentCommentId: r.parentCommentId ?? record.id,
        content: r.content,
        createdAt: r.createdAt,
        userId: r.appUserId ?? r.userId,
      }));
    }

    const { appUserId, ...rest } = record;

    return {
      ...rest,
      userId: appUserId ?? record.userId,
      replies,
    };
  }

  async listActiveByForumId(params: {
    forumId: string;
    limit: number;
    cursor?: CursorPayload;
  }): Promise<ForumCommentFormatted[]> {
    const conditions: SQL[] = [
      eq(forumComments.forumId, params.forumId),
      eq(forumComments.isActive, true),
      eq(forumComments.isReply, false),
    ];

    if (params.cursor) {
      const cursorFilter = buildCursorCondition(
        forumComments.createdAt,
        forumComments.id,
        params.cursor,
      );
      if (cursorFilter) {
        conditions.push(cursorFilter);
      }
    }

    const rootComments = await this.database.db
      .select({
        id: forumComments.id,
        forumId: forumComments.forumId,
        userId: forumComments.userId,
        appUserId: users.appUserId,
        content: forumComments.content,
        parentCommentId: forumComments.parentCommentId,
        isReply: forumComments.isReply,
        isActive: forumComments.isActive,
        createdAt: forumComments.createdAt,
        updatedAt: forumComments.updatedAt,
      })
      .from(forumComments)
      .leftJoin(users, eq(forumComments.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(forumComments.createdAt), desc(forumComments.id))
      .limit(params.limit + 1);

    if (rootComments.length === 0) {
      return [];
    }

    const rootIds = rootComments.map((c) => c.id);

    const rawReplies = await this.database.db
      .select({
        parentCommentId: forumComments.parentCommentId,
        content: forumComments.content,
        createdAt: forumComments.createdAt,
        appUserId: users.appUserId,
        userId: forumComments.userId,
      })
      .from(forumComments)
      .leftJoin(users, eq(forumComments.userId, users.id))
      .where(
        and(
          inArray(forumComments.parentCommentId, rootIds),
          eq(forumComments.isActive, true),
        ),
      )
      .orderBy(forumComments.createdAt, forumComments.id);

    const repliesMap = new Map<string, ForumCommentReply[]>();
    for (const reply of rawReplies) {
      if (!reply.parentCommentId) continue;
      const list = repliesMap.get(reply.parentCommentId) ?? [];
      list.push({
        parentCommentId: reply.parentCommentId,
        content: reply.content,
        createdAt: reply.createdAt,
        userId: reply.appUserId ?? reply.userId,
      });
      repliesMap.set(reply.parentCommentId, list);
    }

    return rootComments.map((root) => {
      const { appUserId, ...rest } = root;
      return {
        ...rest,
        userId: appUserId ?? root.userId,
        replies: repliesMap.get(root.id) ?? [],
      };
    });
  }

  async updateContent(
    id: string,
    content: string,
  ): Promise<ForumCommentFormatted | undefined> {
    await this.database.db
      .update(forumComments)
      .set({
        content,
        updatedAt: new Date(),
      })
      .where(eq(forumComments.id, id));
    return this.findActiveById(id);
  }

  async softDelete(id: string): Promise<{ id: string }[]> {
    const result = await this.database.db.execute(sql`
      WITH RECURSIVE comment_tree AS (
        SELECT id FROM forum_comments WHERE id = ${id}::uuid
        UNION ALL
        SELECT c.id
        FROM forum_comments c
        INNER JOIN comment_tree t ON c.parent_comment_id = t.id
      )
      UPDATE forum_comments
      SET is_active = false,
          updated_at = now()
      WHERE id IN (SELECT id FROM comment_tree)
        AND is_active = true
      RETURNING id
    `);

    return (result as unknown as { rows?: { id: string }[] }).rows ?? [];
  }

  async findActiveByParentId(
    parentCommentId: string,
  ): Promise<ForumCommentFormatted[]> {
    const rawReplies = await this.database.db
      .select({
        id: forumComments.id,
        forumId: forumComments.forumId,
        userId: forumComments.userId,
        appUserId: users.appUserId,
        content: forumComments.content,
        parentCommentId: forumComments.parentCommentId,
        isReply: forumComments.isReply,
        isActive: forumComments.isActive,
        createdAt: forumComments.createdAt,
        updatedAt: forumComments.updatedAt,
      })
      .from(forumComments)
      .leftJoin(users, eq(forumComments.userId, users.id))
      .where(
        and(
          eq(forumComments.parentCommentId, parentCommentId),
          eq(forumComments.isActive, true),
        ),
      )
      .orderBy(forumComments.createdAt, forumComments.id);

    return rawReplies.map((r) => {
      const { appUserId, ...rest } = r;
      return {
        ...rest,
        userId: appUserId ?? r.userId,
        replies: [],
      };
    });
  }
}
