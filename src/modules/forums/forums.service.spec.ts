import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AppUserIdentity } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { ForumCommentsRepository } from './forum-comments.repository';
import { ForumsRepository } from './forums.repository';
import { ForumsService } from './forums.service';
import { MediaService } from '../media/media.service';

const identity: AppUserIdentity = {
  appType: 'INFOCALLING',
  appUserId: 'app-user-1',
  universeUserId: 1001,
  appUserRole: 'author',
};

describe('ForumsService', () => {
  const userId = 'user-1';
  const forumId = 'forum-1';
  const commentId = 'comment-1';

  const forumsRepository = {
    findActiveById: jest.fn(),
    findBySlug: jest.fn(),
    create: jest.fn(),
    listActive: jest.fn(),
    findBySlugExcludingId: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const commentsRepository = {
    create: jest.fn(),
    findActiveById: jest.fn(),
    listActiveByForumId: jest.fn(),
    updateContent: jest.fn(),
    softDelete: jest.fn(),
  };

  const usersService = {
    require: jest.fn(),
    resolve: jest.fn(),
  };

  const mediaService = {
    findOne: jest.fn(),
  };

  let service: ForumsService;

  beforeEach(() => {
    jest.clearAllMocks();
    forumsRepository.findActiveById.mockResolvedValue({
      id: forumId,
      userId,
      isActive: true,
      likeCount: 0,
    });
    forumsRepository.findBySlug.mockResolvedValue(undefined);
    forumsRepository.create.mockImplementation((data: unknown) =>
      Promise.resolve({ id: forumId, ...(data as object), likeCount: 0 }),
    );
    commentsRepository.create.mockImplementation((data: unknown) =>
      Promise.resolve({ id: commentId, ...(data as object) }),
    );
    commentsRepository.listActiveByForumId.mockResolvedValue([]);
    usersService.require.mockResolvedValue({ id: userId });
    usersService.resolve.mockResolvedValue({ id: userId });

    service = new ForumsService(
      forumsRepository as unknown as ForumsRepository,
      commentsRepository as unknown as ForumCommentsRepository,
      usersService as unknown as UsersService,
      mediaService as unknown as MediaService,
    );
  });

  it('creates a forum', async () => {
    const forum = await service.createForum(
      {
        title: 'General Discussion',
        content: 'Forum description content',
        category: 'Tech',
      },
      identity,
    );
    expect(forumsRepository.create).toHaveBeenCalledWith({
      userId,
      title: 'General Discussion',
      content: 'Forum description content',
      category: 'Tech',
      subCategory: undefined,
      mediaId: undefined,
      mediaUrl: undefined,
      isAnonymous: false,
    });
    expect(forum.id).toBe(forumId);
  });

  it('creates a comment in a forum', async () => {
    const comment = await service.createComment(
      forumId,
      { content: 'First comment' },
      identity,
    );
    expect(commentsRepository.create).toHaveBeenCalledWith({
      forumId,
      userId,
      content: 'First comment',
      parentCommentId: null,
      isReply: false,
    });
    expect(comment?.id).toBe(commentId);
  });

  it('creates a reply using parentCommentId', async () => {
    commentsRepository.findActiveById.mockResolvedValue({
      id: 'parent-1',
      forumId,
      isActive: true,
    });

    await service.createComment(
      forumId,
      { content: 'Reply', parentCommentId: 'parent-1' },
      identity,
    );

    expect(commentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCommentId: 'parent-1',
        isReply: true,
      }),
    );
  });

  it('lists comments in a forum', async () => {
    commentsRepository.listActiveByForumId.mockResolvedValue([
      { id: commentId, content: 'First comment' },
    ]);
    const result = await service.listComments(forumId, {});
    expect(result.items).toHaveLength(1);
    expect(commentsRepository.listActiveByForumId).toHaveBeenCalled();
  });

  it('updates a comment', async () => {
    commentsRepository.findActiveById.mockResolvedValue({
      id: commentId,
      userId,
      forumId,
    });
    commentsRepository.updateContent.mockResolvedValue({
      id: commentId,
      content: 'Edited',
    });

    await service.updateComment(commentId, { content: 'Edited' }, identity);
    expect(commentsRepository.updateContent).toHaveBeenCalledWith(
      commentId,
      'Edited',
    );
  });

  it('soft-deletes a comment', async () => {
    commentsRepository.findActiveById.mockResolvedValue({
      id: commentId,
      userId,
      forumId,
    });
    commentsRepository.softDelete.mockResolvedValue([{ id: commentId }]);

    const result = await service.deleteComment(commentId, identity);
    expect(commentsRepository.softDelete).toHaveBeenCalledWith(commentId);
    expect(result).toEqual({ id: commentId, isActive: false });
  });
});
