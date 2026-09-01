import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { RedisService } from '../redis/redis.service';
import type { AppUserIdentity } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { BlogsRepository } from './blogs.repository';
import { BlogsService } from './blogs.service';
import { BlogStatus } from './enums/blog.enum';

const identity: AppUserIdentity = {
  appType: 'INFOCALLING',
  appUserId: 'app-user-1',
  universeUserId: 1001,
  appUserRole: 'author',
};

describe('BlogsService', () => {
  const userId = 'user-1';

  const blogsRepository = {
    findBySlug: jest.fn(),
    create: jest.fn(),
    listActive: jest.fn(),
    findActiveWithThumbnail: jest.fn(),
    findLikeByBlogAndUser: jest.fn(),
    findActiveById: jest.fn(),
    findBySlugExcludingId: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getStatusCounts: jest.fn(),
    createView: jest.fn(),
  };

  const usersService = {
    require: jest.fn(),
    resolve: jest.fn(),
  };

  const redis = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    del: jest.fn(),
    delByPattern: jest.fn(),
  };

  const mediaService = {
    resolveStorageUrl: jest.fn(),
    findOne: jest.fn(),
  };

  let service: BlogsService;

  const timestamps = {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    blogsRepository.findBySlug.mockResolvedValue(undefined);
    blogsRepository.findBySlugExcludingId.mockResolvedValue(undefined);
    blogsRepository.create.mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve({
        ...data,
        id: 'blog-1',
        thumbnailMediaId: (data.thumbnailMediaId as string | null) ?? null,
        thumbnailUrl: (data.thumbnailUrl as string | null) ?? null,
        tags: (data.tags as string[] | null) ?? null,
        links: (data.links as string[] | null) ?? null,
        likeCount: 0,
        isActive: true,
        ...timestamps,
      }),
    );
    blogsRepository.update.mockImplementation(
      (id: string, data: Record<string, unknown>) =>
        Promise.resolve({
          id,
          userId,
          title: (data.title as string | null) ?? 'Hello',
          slug: (data.slug as string | null) ?? 'hello',
          content: (data.content as string | null) ?? 'body',
          thumbnailMediaId: null,
          thumbnailUrl: null,
          tags: null,
          links: (data.links as string[] | null) ?? null,
          status: data.status ?? 'DRAFT',
          readingTime: null,
          likeCount: 0,
          isActive: true,
          ...timestamps,
        }),
    );
    usersService.require.mockResolvedValue({ id: userId });
    usersService.resolve.mockResolvedValue({ id: userId });
    redis.delByPattern.mockResolvedValue(undefined);

    service = new BlogsService(
      blogsRepository as unknown as BlogsRepository,
      usersService as unknown as UsersService,
      redis as unknown as RedisService,
      mediaService as unknown as MediaService,
    );
  });

  it('defaults omitted status to DRAFT', async () => {
    const result = await service.create(identity, {});
    expect(blogsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DRAFT' }),
    );
    expect(result.status).toBe('DRAFT');
  });

  it('creates an explicit incomplete DRAFT', async () => {
    const result = await service.create(identity, { status: BlogStatus.DRAFT });
    expect(result.status).toBe('DRAFT');
    expect(blogsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: null,
        slug: null,
        content: null,
        status: 'DRAFT',
      }),
    );
  });

  it('creates a DRAFT with only title', async () => {
    await service.create(identity, { title: 'My Draft', status: BlogStatus.DRAFT });
    expect(blogsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'My Draft',
        slug: null,
        content: null,
        status: 'DRAFT',
      }),
    );
  });

  it('creates a complete PENDING_REVIEW blog', async () => {
    const result = await service.create(identity, {
      title: 'Hello',
      slug: 'hello',
      content: 'Complete body',
      status: BlogStatus.PENDING_REVIEW,
      links: ['https://example.com'],
    });

    expect(blogsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING_REVIEW',
        links: ['https://example.com'],
      }),
    );
    expect(result.status).toBe('PENDING_REVIEW');
  });

  it('updates an incomplete draft with partial data', async () => {
    blogsRepository.findActiveById.mockResolvedValue({
      id: 'blog-1',
      userId,
      title: null,
      slug: null,
      content: null,
      status: 'DRAFT',
    });

    await service.update('blog-1', identity, { title: 'Only title' });

    expect(blogsRepository.update).toHaveBeenCalledWith(
      'blog-1',
      expect.objectContaining({
        title: 'Only title',
        status: undefined,
      }),
    );
  });

  it('patches a complete draft to PENDING_REVIEW', async () => {
    blogsRepository.findActiveById.mockResolvedValue({
      id: 'blog-1',
      userId,
      title: 'Hello',
      slug: 'hello',
      content: 'Complete body',
      status: 'DRAFT',
    });

    await service.update('blog-1', identity, {
      title: 'Hello',
      slug: 'hello',
      content: 'Complete body',
      status: BlogStatus.PENDING_REVIEW,
    });

    expect(blogsRepository.update).toHaveBeenCalledWith(
      'blog-1',
      expect.objectContaining({ status: 'PENDING_REVIEW' }),
    );
  });

  it('still allows updating an existing PUBLISHED blog', async () => {
    blogsRepository.findActiveById.mockResolvedValue({
      id: 'blog-1',
      userId,
      title: 'Hello',
      slug: 'hello',
      content: 'Complete body',
      status: 'PUBLISHED',
    });

    await service.update('blog-1', identity, { title: 'Updated title' });

    expect(blogsRepository.update).toHaveBeenCalledWith(
      'blog-1',
      expect.objectContaining({
        title: 'Updated title',
        status: undefined,
      }),
    );
  });

  it('rejects updates when the caller does not own the blog', async () => {
    blogsRepository.findActiveById.mockResolvedValue({
      id: 'blog-1',
      userId: 'someone-else',
      title: 'Hello',
      slug: 'hello',
      content: 'body',
      status: 'DRAFT',
    });

    await expect(
      service.update('blog-1', identity, { title: 'Nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(blogsRepository.update).not.toHaveBeenCalled();
  });

  it('rejects my-blogs listing when user_id does not match the mapped user', async () => {
    await expect(
      service.listMine(identity, { userId: 'someone-else' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listMine(identity, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns my-blogs listing with counts', async () => {
    usersService.require.mockResolvedValue({ id: userId, appUserId: 'app-user-1' });
    redis.getJson.mockResolvedValue(null);
    blogsRepository.listActive.mockResolvedValue([]);
    const mockCounts = {
      DRAFT: 1,
      PENDING_REVIEW: 2,
      APPROVED: 2,
      REJECTED: 0,
      PUBLISHED: 0,
      TOTAL: 5,
    };
    blogsRepository.getStatusCounts.mockResolvedValue(mockCounts);

    const result = await service.listMine(identity, { userId: 'app-user-1' });
    expect(result.counts).toEqual(mockCounts);
    expect(blogsRepository.getStatusCounts).toHaveBeenCalledWith(userId);
  });
});
