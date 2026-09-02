import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  buildCursorCondition,
  type CursorPayload,
} from '../../common/helpers/cursor-pagination.helper';
import { DatabaseService } from '../../database/database.service';
import { blogs } from '../../database/schema/blogs.schema';
import { comments } from '../../database/schema/comments.schema';
import { users } from '../../database/schema/users.schema';

export type CommentReply = {
  parentCommentId: string;
  content: string;
  createdAt: Date;
  userId: string;
};

export type CommentFormatted = {
  id: string;
  blogId: string;
  userId: string;
  content: string;
  parentCommentId: string | null;
  isReply: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  replies: CommentReply[];
};

@Injectable()
export class CommentsRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  async create(data: {
    blogId: string;
    userId: string;
    content: string;
    parentCommentId?: string | null;
    isReply: boolean;
  }): Promise<CommentFormatted | undefined> {
    const [record] = await this.database.db
      .insert(comments)
      .values({
        blogId: data.blogId,
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

  async findActiveById(id: string): Promise<CommentFormatted | undefined> {
    const [record] = await this.database.db
      .select({
        id: comments.id,
        blogId: comments.blogId,
        userId: comments.userId,
        appUserId: users.appUserId,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        isReply: comments.isReply,
        isActive: comments.isActive,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(and(eq(comments.id, id), eq(comments.isActive, true)))
      .limit(1);

    if (!record) return undefined;

    let replies: CommentReply[] = [];
    if (!record.isReply) {
      const rawReplies = await this.database.db
        .select({
          parentCommentId: comments.parentCommentId,
          content: comments.content,
          createdAt: comments.createdAt,
          appUserId: users.appUserId,
          userId: comments.userId,
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .where(
          and(
            eq(comments.parentCommentId, record.id),
            eq(comments.isActive, true),
          ),
        )
        .orderBy(comments.createdAt, comments.id);

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

  async findActiveWithBlogOwner(commentId: string): Promise<
    | {
        comment: CommentFormatted;
        blogUserId: string;
      }
    | undefined
  > {
    const [record] = await this.database.db
      .select({
        comment: {
          id: comments.id,
          blogId: comments.blogId,
          userId: comments.userId,
          appUserId: users.appUserId,
          content: comments.content,
          parentCommentId: comments.parentCommentId,
          isReply: comments.isReply,
          isActive: comments.isActive,
          createdAt: comments.createdAt,
          updatedAt: comments.updatedAt,
        },
        blogUserId: blogs.userId,
      })
      .from(comments)
      .leftJoin(blogs, eq(comments.blogId, blogs.id))
      .leftJoin(users, eq(comments.userId, users.id))
      .where(and(eq(comments.id, commentId), eq(comments.isActive, true)))
      .limit(1);

    if (!record) return undefined;

    let replies: CommentReply[] = [];
    if (!record.comment.isReply) {
      const rawReplies = await this.database.db
        .select({
          parentCommentId: comments.parentCommentId,
          content: comments.content,
          createdAt: comments.createdAt,
          appUserId: users.appUserId,
          userId: comments.userId,
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .where(
          and(
            eq(comments.parentCommentId, record.comment.id),
            eq(comments.isActive, true),
          ),
        )
        .orderBy(comments.createdAt, comments.id);

      replies = rawReplies.map((r) => ({
        parentCommentId: r.parentCommentId ?? record.comment.id,
        content: r.content,
        createdAt: r.createdAt,
        userId: r.appUserId ?? r.userId,
      }));
    }

    const { appUserId, ...restComment } = record.comment;

    return {
      comment: {
        ...restComment,
        userId: appUserId ?? record.comment.userId,
        replies,
      },
      blogUserId: record.blogUserId ?? '',
    };
  }

  async listActiveByBlogId(params: {
    blogId: string;
    limit: number;
    cursor?: CursorPayload;
  }): Promise<CommentFormatted[]> {
    const conditions: SQL[] = [
      eq(comments.blogId, params.blogId),
      eq(comments.isActive, true),
      eq(comments.isReply, false),
    ];

    if (params.cursor) {
      const cursorFilter = buildCursorCondition(
        comments.createdAt,
        comments.id,
        params.cursor,
      );
      if (cursorFilter) {
        conditions.push(cursorFilter);
      }
    }

    const rootComments = await this.database.db
      .select({
        id: comments.id,
        blogId: comments.blogId,
        userId: comments.userId,
        appUserId: users.appUserId,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        isReply: comments.isReply,
        isActive: comments.isActive,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(params.limit + 1);

    if (rootComments.length === 0) {
      return [];
    }

    const rootIds = rootComments.map((c) => c.id);

    const rawReplies = await this.database.db
      .select({
        parentCommentId: comments.parentCommentId,
        content: comments.content,
        createdAt: comments.createdAt,
        appUserId: users.appUserId,
        userId: comments.userId,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(
        and(
          inArray(comments.parentCommentId, rootIds),
          eq(comments.isActive, true),
        ),
      )
      .orderBy(comments.createdAt, comments.id);

    const repliesMap = new Map<string, CommentReply[]>();
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
  ): Promise<CommentFormatted | undefined> {
    await this.database.db
      .update(comments)
      .set({
        content,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id));
    return this.findActiveById(id);
  }

  async softDelete(id: string): Promise<{ id: string }[]> {
    const result = await this.database.db.execute(sql`
      WITH RECURSIVE comment_tree AS (
        SELECT id FROM comments WHERE id = ${id}::uuid
        UNION ALL
        SELECT c.id
        FROM comments c
        INNER JOIN comment_tree t ON c.parent_comment_id = t.id
      )
      UPDATE comments
      SET is_active = false,
          updated_at = now()
      WHERE id IN (SELECT id FROM comment_tree)
        AND is_active = true
      RETURNING id
    `);

    const rows =
      (
        result as unknown as {
          rows?: { id: string }[];
        }
      ).rows ?? [];
    return rows;
  }

  async findActiveByParentId(
    parentCommentId: string,
  ): Promise<CommentFormatted[]> {
    const rawReplies = await this.database.db
      .select({
        id: comments.id,
        blogId: comments.blogId,
        userId: comments.userId,
        appUserId: users.appUserId,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        isReply: comments.isReply,
        isActive: comments.isActive,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(
        and(
          eq(comments.parentCommentId, parentCommentId),
          eq(comments.isActive, true),
        ),
      )
      .orderBy(comments.createdAt, comments.id);

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
