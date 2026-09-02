import { CommentsRepository } from './comments.repository';

describe('CommentsRepository', () => {
  it('softDelete issues a recursive CTE that deletes a parent and its descendants', async () => {
    const execute = jest.fn().mockResolvedValue({
      rows: [{ id: 'parent-1' }, { id: 'child-1' }],
    });
    const repository = new CommentsRepository({
      db: { execute },
    } as never);

    const rows = await repository.softDelete('parent-1');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ id: 'parent-1' }, { id: 'child-1' }]);
    const firstCall = execute.mock.calls[0] as unknown[] | undefined;
    const serialized = JSON.stringify(firstCall?.[0]);
    expect(serialized).toContain('comment_tree');
    expect(serialized).toContain('parent_comment_id');
  });

  it('lists root comments with nested replies containing parentCommentId, content, createdAt, userId', async () => {
    const rootComment = {
      id: 'root-1',
      blogId: 'blog-1',
      userId: 'user-db-1',
      appUserId: 'app-user-1',
      content: 'root comment content',
      parentCommentId: null,
      isReply: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const replyComment = {
      parentCommentId: 'root-1',
      content: 'reply content',
      createdAt: new Date(),
      userId: 'user-db-2',
      appUserId: 'app-user-2',
    };

    let callCount = 0;
    const db = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          leftJoin: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockImplementation(() => ({
              orderBy: jest.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                  return {
                    limit: jest.fn().mockResolvedValue([rootComment]),
                  };
                }
                return Promise.resolve([replyComment]);
              }),
            })),
          })),
        })),
      })),
    };

    const repository = new CommentsRepository({ db } as never);
    const result = await repository.listActiveByBlogId({
      blogId: 'blog-1',
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('root-1');
    expect(result[0].userId).toBe('app-user-1');
    expect((result[0] as Record<string, unknown>).userName).toBeUndefined();
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0]).toEqual({
      parentCommentId: 'root-1',
      content: 'reply content',
      createdAt: expect.any(Date),
      userId: 'app-user-2',
    });
  });
});







