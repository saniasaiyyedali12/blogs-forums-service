import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BlogsRepository } from '../blogs/blogs.repository';
import { CommentsRepository } from '../comments/comments.repository';
import { ForumCommentsRepository } from '../forums/forum-comments.repository';
import { ForumsRepository } from '../forums/forums.repository';
import { UsersService, type AppUserIdentity } from '../users/users.service';
import { ReportReason, ReportTargetType } from './enums/report.enum';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

const identity: AppUserIdentity = {
  appType: 'INFOCALLING',
  appUserId: 'app-user-1',
  universeUserId: 1001,
  appUserRole: 'author',
};

const dto = { reason: ReportReason.SPAM };

describe('ReportsService', () => {
  const blogId = 'blog-1';
  const commentId = 'comment-1';
  const forumId = 'forum-1';
  const forumCommentId = 'forum-comment-1';
  const userId = 'user-1';
  const report = { id: 'report-1', reason: ReportReason.SPAM };

  const reportsRepository = {
    create: jest.fn(),
  };
  const blogsRepository = {
    findActiveById: jest.fn(),
  };
  const commentsRepository = {
    findActiveById: jest.fn(),
  };
  const forumsRepository = {
    findActiveById: jest.fn(),
  };
  const forumCommentsRepository = {
    findActiveById: jest.fn(),
  };
  const usersService = {
    require: jest.fn(),
  };

  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.require.mockResolvedValue({ id: userId });
    reportsRepository.create.mockResolvedValue(report);
    service = new ReportsService(
      reportsRepository as unknown as ReportsRepository,
      blogsRepository as unknown as BlogsRepository,
      commentsRepository as unknown as CommentsRepository,
      forumsRepository as unknown as ForumsRepository,
      forumCommentsRepository as unknown as ForumCommentsRepository,
      usersService as unknown as UsersService,
    );
  });

  it('reports a blog', async () => {
    blogsRepository.findActiveById.mockResolvedValue({ id: blogId });
    await expect(service.reportBlog(blogId, dto, identity)).resolves.toEqual(
      report,
    );
    expect(reportsRepository.create).toHaveBeenCalledWith({
      reporterUserId: userId,
      targetType: ReportTargetType.BLOG,
      targetId: blogId,
      reason: ReportReason.SPAM,
      description: undefined,
    });
  });

  it('reports a blog comment', async () => {
    blogsRepository.findActiveById.mockResolvedValue({ id: blogId });
    commentsRepository.findActiveById.mockResolvedValue({
      id: commentId,
      blogId,
    });
    await expect(
      service.reportBlogComment(blogId, commentId, dto, identity),
    ).resolves.toEqual(report);
    expect(reportsRepository.create).toHaveBeenCalledWith({
      reporterUserId: userId,
      targetType: ReportTargetType.BLOG_COMMENT,
      targetId: commentId,
      reason: ReportReason.SPAM,
      description: undefined,
    });
  });

  it('reports a forum', async () => {
    forumsRepository.findActiveById.mockResolvedValue({ id: forumId });
    await expect(service.reportForum(forumId, dto, identity)).resolves.toEqual(
      report,
    );
    expect(reportsRepository.create).toHaveBeenCalledWith({
      reporterUserId: userId,
      targetType: ReportTargetType.FORUM,
      targetId: forumId,
      reason: ReportReason.SPAM,
      description: undefined,
    });
  });

  it('reports a forum comment', async () => {
    forumsRepository.findActiveById.mockResolvedValue({ id: forumId });
    forumCommentsRepository.findActiveById.mockResolvedValue({
      id: forumCommentId,
      forumId,
    });
    await expect(
      service.reportForumComment(forumId, forumCommentId, dto, identity),
    ).resolves.toEqual(report);
    expect(reportsRepository.create).toHaveBeenCalledWith({
      reporterUserId: userId,
      targetType: ReportTargetType.FORUM_COMMENT,
      targetId: forumCommentId,
      reason: ReportReason.SPAM,
      description: undefined,
    });
  });

  it('returns 404 when the blog does not exist', async () => {
    blogsRepository.findActiveById.mockResolvedValue(undefined);
    await expect(
      service.reportBlog(blogId, dto, identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 when the blog comment does not exist', async () => {
    blogsRepository.findActiveById.mockResolvedValue({ id: blogId });
    commentsRepository.findActiveById.mockResolvedValue(undefined);
    await expect(
      service.reportBlogComment(blogId, commentId, dto, identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 when the forum does not exist', async () => {
    forumsRepository.findActiveById.mockResolvedValue(undefined);
    await expect(
      service.reportForum(forumId, dto, identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 when the forum comment does not exist', async () => {
    forumsRepository.findActiveById.mockResolvedValue({ id: forumId });
    forumCommentsRepository.findActiveById.mockResolvedValue(undefined);
    await expect(
      service.reportForumComment(forumId, forumCommentId, dto, identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a duplicate report with conflict', async () => {
    blogsRepository.findActiveById.mockResolvedValue({ id: blogId });
    reportsRepository.create.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    await expect(
      service.reportBlog(blogId, dto, identity),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 for an inactive blog', async () => {
    blogsRepository.findActiveById.mockResolvedValue(undefined);
    await expect(
      service.reportBlogComment(blogId, commentId, dto, identity),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(commentsRepository.findActiveById).not.toHaveBeenCalled();
  });

  it('returns 404 for an inactive forum', async () => {
    forumsRepository.findActiveById.mockResolvedValue(undefined);
    await expect(
      service.reportForumComment(forumId, forumCommentId, dto, identity),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(forumCommentsRepository.findActiveById).not.toHaveBeenCalled();
  });

  it('returns 404 for an inactive blog comment', async () => {
    blogsRepository.findActiveById.mockResolvedValue({ id: blogId });
    commentsRepository.findActiveById.mockResolvedValue(undefined);
    await expect(
      service.reportBlogComment(blogId, commentId, dto, identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a forum comment that belongs to another forum', async () => {
    forumsRepository.findActiveById.mockResolvedValue({ id: forumId });
    forumCommentsRepository.findActiveById.mockResolvedValue({
      id: forumCommentId,
      forumId: 'other-forum',
    });
    await expect(
      service.reportForumComment(forumId, forumCommentId, dto, identity),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blog comment that belongs to another blog', async () => {
    blogsRepository.findActiveById.mockResolvedValue({ id: blogId });
    commentsRepository.findActiveById.mockResolvedValue({
      id: commentId,
      blogId: 'other-blog',
    });
    await expect(
      service.reportBlogComment(blogId, commentId, dto, identity),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
