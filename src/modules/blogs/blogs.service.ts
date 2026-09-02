import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  decodeCursor,
  sliceCursorPage,
} from '../../common/helpers/cursor-pagination.helper';
import { isUniqueViolation } from '../../common/helpers/postgres.helper';
import { calculateReadingTime } from '../../common/helpers/reading-time.helper';
import { MediaService } from '../media/media.service';
import { RedisService } from '../redis/redis.service';
import type { AppUserIdentity } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { BlogsRepository, type BlogWithThumbnail } from './blogs.repository';
import { BlogResponseDto } from './dto/blog-response.dto';
import { normalizeOptionalText } from './blog-fields.helper';
import { CreateBlogDto } from './dto/create-blog.dto';
import { ListBlogsQueryDto } from './dto/list-blogs.query.dto';
import { ListMyBlogsQueryDto } from './dto/list-my-blogs.query.dto';
import { BlogStatus } from './enums/blog.enum';
import { UpdateBlogDto } from './dto/update-blog.dto';

const BLOG_CACHE_TTL_SECONDS = 300;
const BLOG_LIST_CACHE_TTL_SECONDS = 60;

@Injectable()
export class BlogsService {
  constructor(
    @Inject(BlogsRepository)
    private readonly blogsRepository: BlogsRepository,
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(RedisService)
    private readonly redis: RedisService,
    @Inject(MediaService)
    private readonly mediaService: MediaService,
  ) { }

  async create(identity: AppUserIdentity, dto: CreateBlogDto) {
    const user = await this.usersService.require(identity, true);
    const title = normalizeOptionalText(dto.title);
    const slug = normalizeOptionalText(dto.slug);
    const content = normalizeOptionalText(dto.content);

    if (slug) {
      const existingSlug = await this.blogsRepository.findBySlug(slug);
      if (existingSlug) {
        throw new ConflictException('Blog slug already exists');
      }
    }

    try {
      const thumbnailUrl = await this.resolveThumbnailUrl(dto.thumbnailMediaId);
      const record = await this.blogsRepository.create({
        userId: user.id,
        title,
        slug,
        content,
        thumbnailMediaId: dto.thumbnailMediaId,
        thumbnailUrl,
        tags: dto.tags,
        links: dto.links,
        mediaUrls: dto.mediaUrls,
        status: dto.status ?? BlogStatus.DRAFT,
        readingTime: this.readingTimeFor(content),
      });

      await this.invalidateListCaches();
      await this.invalidateCountsCache(user.id);
      return BlogResponseDto.fromEntity(record, {
        thumbnailUrl: record.thumbnailUrl,
        userId: user.appUserId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Blog slug already exists');
      }
      throw error;
    }
  }

  async list(query: ListBlogsQueryDto) {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const search = query.search?.trim() || undefined;
    const cacheKey = this.listCacheKey({
      limit,
      cursor: query.cursor ?? null,
      status: BlogStatus.PUBLISHED ?? null,
      userId: null,
      search: search ?? null,
    });

    const cached = await this.redis.getJson<{
      items: BlogResponseDto[];
      nextCursor: string | null;
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const rows = await this.blogsRepository.listActive({
      limit,
      cursor,
      status: [BlogStatus.PUBLISHED],
      search,
    });

    const page = sliceCursorPage(rows, limit);
    const result = {
      items: await Promise.all(page.items.map((row) => this.toResponse(row))),
      nextCursor: page.nextCursor,
    };

    await this.redis.setJson(cacheKey, result, BLOG_LIST_CACHE_TTL_SECONDS);
    return result;
  }

  async listMine(identity: AppUserIdentity, query: ListMyBlogsQueryDto) {
    const requestedUserId = query.userId;
    if (!requestedUserId) {
      throw new BadRequestException('user_id is required');
    }

    const user = await this.usersService.require(identity);
    if (user.appUserId !== requestedUserId) {
      throw new ForbiddenException(
        'user_id must match the authenticated application user',
      );
    }

    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const search = query.search?.trim() || undefined;
    const cacheKey = this.listCacheKey({
      limit,
      cursor: query.cursor ?? null,
      status: query.status ?? null,
      userId: user.id,
      search: search ?? null,
    });

    const cached = await this.redis.getJson<{
      items: BlogResponseDto[];
      nextCursor: string | null;
      counts: Record<BlogStatus, number> & { TOTAL: number };
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const [rows, counts] = await Promise.all([
      this.blogsRepository.listActive({
        limit,
        cursor,
        status: query.status ? [query.status] : [BlogStatus.DRAFT, BlogStatus.APPROVED, BlogStatus.PENDING_REVIEW, BlogStatus.REJECTED, BlogStatus.PUBLISHED],
        userId: user.id,
        search,
      }),
      this.getStatusCounts(user.id),
    ]);

    const page = sliceCursorPage(rows, limit);
    const result = {
      items: await Promise.all(page.items.map((row) => this.toResponse(row))),
      counts,
      nextCursor: page.nextCursor,
    };

    await this.redis.setJson(cacheKey, result, BLOG_LIST_CACHE_TTL_SECONDS);
    return result;
  }

  async getById(id: string, identity?: AppUserIdentity) {
    const cacheKey = `blog:${id}`;

    if (!identity) {
      const cached = await this.redis.getJson<BlogResponseDto>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const record = await this.blogsRepository.findActiveWithThumbnail(id);
    if (!record) {
      throw new NotFoundException('Blog not found');
    }

    let isLikedByCurrentUser: boolean | undefined;
    let viewerUserId: string | null = null;

    if (identity) {
      const user = await this.usersService.resolve(identity, true);
      if (user) {
        viewerUserId = user.id;
        const like = await this.blogsRepository.findLikeByBlogAndUser(
          id,
          user.id,
        );
        isLikedByCurrentUser = !!like;
      }
    }

    const result = await this.toResponse(record, isLikedByCurrentUser);

    if (!identity) {
      await this.redis.setJson(cacheKey, result, BLOG_CACHE_TTL_SECONDS);
    }

    return result;
  }

  async getViews(blogId: string, identity: AppUserIdentity) {
    await this.requireOwnedBlog(
      blogId,
      identity,
      'You can only view analytics for your own blogs.',
    );
    return this.blogsRepository.getViewEvents(blogId);
  }


  async update(id: string, identity: AppUserIdentity, dto: UpdateBlogDto) {
    const hasUpdate = [
      dto.title,
      dto.slug,
      dto.content,
      dto.thumbnailMediaId,
      dto.tags,
      dto.links,
      dto.mediaUrls,
      dto.status,
    ].some((value) => value !== undefined);

    if (!hasUpdate) {
      throw new BadRequestException('No fields to update');
    }

    const blog = await this.requireOwnedBlog(
      id,
      identity,
      'You are not allowed to modify this blog',
    );

    const title =
      dto.title !== undefined ? normalizeOptionalText(dto.title) : blog.title;
    const slug =
      dto.slug !== undefined ? normalizeOptionalText(dto.slug) : blog.slug;
    const content =
      dto.content !== undefined
        ? normalizeOptionalText(dto.content)
        : blog.content;

    if (slug && slug !== blog.slug) {
      const existingSlug = await this.blogsRepository.findBySlugExcludingId(
        slug,
        id,
      );
      if (existingSlug) {
        throw new ConflictException('Blog slug already exists');
      }
    }

    const thumbnailUrl =
      dto.thumbnailMediaId === undefined
        ? undefined
        : dto.thumbnailMediaId === null
          ? null
          : await this.resolveThumbnailUrl(dto.thumbnailMediaId);

    try {
      const record = await this.blogsRepository.update(id, {
        title: dto.title !== undefined ? title : undefined,
        slug: dto.slug !== undefined ? slug : undefined,
        content: dto.content !== undefined ? content : undefined,
        thumbnailMediaId: dto.thumbnailMediaId,
        thumbnailUrl,
        tags: dto.tags,
        links: dto.links,
        mediaUrls: dto.mediaUrls,
        status: dto.status,
        readingTime:
          dto.content !== undefined ? this.readingTimeFor(content) : undefined,
      });

      if (!record) {
        throw new NotFoundException('Blog not found');
      }

      await this.invalidateBlogCaches(id);
      await this.invalidateCountsCache(blog.userId);
      return BlogResponseDto.fromEntity(record, {
        thumbnailUrl: await this.resolveThumbnailUrl(record.thumbnailMediaId),
        userId: identity.appUserId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Blog slug already exists');
      }
      throw error;
    }
  }

  async softDelete(id: string, identity: AppUserIdentity) {
    const blog = await this.requireOwnedBlog(
      id,
      identity,
      'You are not allowed to delete this blog',
    );

    const record = await this.blogsRepository.softDelete(id);
    if (!record) {
      throw new NotFoundException('Blog not found');
    }

    await this.invalidateBlogCaches(id);
    await this.invalidateCountsCache(blog.userId);
    return {
      id: record.id,
      isActive: record.isActive,
    };
  }

  async publish(id: string, identity: AppUserIdentity) {
    const blog = await this.requireOwnedBlog(
      id,
      identity,
      'You are not allowed to publish this blog',
    );

    if (blog.status !== BlogStatus.APPROVED) {
      throw new BadRequestException('Only approved blogs can be published');
    }

    const record = await this.blogsRepository.update(id, {
      status: BlogStatus.PUBLISHED,
    });

    if (!record) {
      throw new NotFoundException('Blog not found');
    }

    await this.invalidateBlogCaches(id);
    await this.invalidateCountsCache(blog.userId);
    return BlogResponseDto.fromEntity(record, {
      thumbnailUrl: await this.resolveThumbnailUrl(record.thumbnailMediaId),
      userId: identity.appUserId,
    });
  }

  async clearBlogCache(blogId?: string) {
    if (blogId) {
      await this.invalidateBlogCaches(blogId);
      return;
    }
    await this.invalidateListCaches();
  }

  private async requireOwnedBlog(
    id: string,
    identity: AppUserIdentity,
    forbiddenMessage: string,
  ) {
    const blog = await this.blogsRepository.findActiveById(id);
    if (!blog) {
      throw new NotFoundException('Blog not found');
    }

    const user = await this.usersService.resolve(identity);
    if (!user || blog.userId !== user.id) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return blog;
  }

  private async toResponse(
    row: BlogWithThumbnail,
    isLikedByCurrentUser?: boolean,
  ) {
    const thumbnailUrl =
      row.thumbnailUrl ??
      (await this.mediaService.resolveStorageUrl(
        row.thumbnailBucketName,
        row.thumbnailObjectKey,
        row.thumbnailVisibility,
      )) ??
      null;

    return BlogResponseDto.fromEntity(row, {
      thumbnailUrl,
      isLikedByCurrentUser,
    });
  }

  private readingTimeFor(content: string | null): number | null {
    return content ? calculateReadingTime(content) : null;
  }

  private async resolveThumbnailUrl(mediaId?: string | null) {
    if (!mediaId) {
      return null;
    }
    try {
      const mediaRecord = await this.mediaService.findOne(mediaId);
      return mediaRecord.url ?? null;
    } catch {
      return null;
    }
  }

  private listCacheKey(query: {
    limit: number;
    cursor: string | null;
    status: string | null;
    userId: string | null;
    search: string | null;
  }) {
    const hash = createHash('sha256')
      .update(JSON.stringify(query))
      .digest('hex');
    return `blogs:list:${hash}`;
  }

  private async invalidateBlogCaches(blogId: string) {
    await this.redis.del(`blog:${blogId}`);
    await this.invalidateListCaches();
  }

  private async invalidateListCaches() {
    await this.redis.delByPattern('blogs:list:*');
  }

  async getStatusCounts(userId: string): Promise<Record<BlogStatus, number> & { TOTAL: number }> {
    const cacheKey = `blogs:counts:${userId}`;
    const cached = await this.redis.getJson<Record<BlogStatus, number> & { TOTAL: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    const counts = await this.blogsRepository.getStatusCounts(userId);
    await this.redis.setJson(cacheKey, counts, BLOG_CACHE_TTL_SECONDS);
    return counts;
  }

  private async invalidateCountsCache(userId: string) {
    await this.redis.del(`blogs:counts:${userId}`);
  }

  async recordViewByViewer(
    blogId: string,
    deviceId?: string,
    identity?: AppUserIdentity,
  ): Promise<{ recorded: boolean }> {
    const blog = await this.blogsRepository.findActiveById(blogId);
    if (!blog) {
      throw new NotFoundException('Blog not found');
    }

    const trimmedDeviceId = deviceId?.trim();
    if (trimmedDeviceId && trimmedDeviceId.length > 255) {
      throw new BadRequestException('x-device-id header must not exceed 255 characters');
    }

    const user = identity ? await this.usersService.resolve(identity) : null;

    if (!user && !trimmedDeviceId) {
      throw new BadRequestException('x-device-id header is required for guest users');
    }

    // Author exclusion
    if (user && user.id === blog.userId) {
      return { recorded: false };
    }

    const redisKey = user
      ? `blog:viewed:user:${blogId}:${user.id}`
      : `blog:viewed:device:${blogId}:${trimmedDeviceId}`;

    try {
      const cached = await this.redis.getJson<string>(redisKey);
      if (cached) {
        return { recorded: false };
      }
    } catch (redisError) {
      const logger = new Logger(BlogsService.name);
      logger.warn(`Redis check failed for key ${redisKey}: ${redisError}`);
    }

    if (user && trimmedDeviceId) {
      // Guest -> Logged-in Transition
      const { converted } = await this.blogsRepository.convertGuestViewToUserView({
        blogId,
        viewerUserId: user.id,
        viewerDeviceId: trimmedDeviceId,
      });

      if (converted) {
        try {
          await this.redis.setJson(redisKey, '1', 86400 * 30);
        } catch (redisError) {
          const logger = new Logger(BlogsService.name);
          logger.warn(`Redis set failed for key ${redisKey}: ${redisError}`);
        }
        return { recorded: false };
      }
    }

    const { inserted } = await this.blogsRepository.createView({
      blogId,
      viewerUserId: user ? user.id : null,
      viewerDeviceId: trimmedDeviceId ?? null,
    });

    try {
      await this.redis.setJson(redisKey, '1', 86400 * 30);
    } catch (redisError) {
      const logger = new Logger(BlogsService.name);
      logger.warn(`Redis set failed for key ${redisKey}: ${redisError}`);
    }

    if (inserted) {
      await this.invalidateBlogCaches(blogId).catch(() => {});
    }

    return { recorded: inserted };
  }
}
