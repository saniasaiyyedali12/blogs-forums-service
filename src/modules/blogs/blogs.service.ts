import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
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
    const slug = dto.slug.trim();

    const existingSlug = await this.blogsRepository.findBySlug(slug);
    if (existingSlug) {
      throw new ConflictException('Blog slug already exists');
    }

    try {
      const thumbnailUrl = await this.resolveThumbnailUrl(dto.thumbnailMediaId);
      const record = await this.blogsRepository.create({
        userId: user.id,
        title: dto.title.trim(),
        slug,
        content: dto.content,
        thumbnailMediaId: dto.thumbnailMediaId,
        thumbnailUrl,
        tags: dto.tags,
        status: dto.status ?? BlogStatus.DRAFT,
        readingTime: calculateReadingTime(dto.content),
      });

      await this.invalidateListCaches();
      return BlogResponseDto.fromEntity(record, {
        thumbnailUrl: record.thumbnailUrl,
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
      status: query.status ?? null,
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
      status: query.status,
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
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const rows = await this.blogsRepository.listActive({
      limit,
      cursor,
      status: query.status,
      userId: user.id,
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
    if (identity) {
      const user = await this.usersService.resolve(identity);
      if (user) {
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

  async update(id: string, identity: AppUserIdentity, dto: UpdateBlogDto) {
    const hasUpdate = [
      dto.title,
      dto.slug,
      dto.content,
      dto.thumbnailMediaId,
      dto.tags,
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

    if (dto.slug && dto.slug !== blog.slug) {
      const existingSlug = await this.blogsRepository.findBySlugExcludingId(
        dto.slug,
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
        title: dto.title?.trim(),
        slug: dto.slug,
        content: dto.content,
        thumbnailMediaId: dto.thumbnailMediaId,
        thumbnailUrl,
        tags: dto.tags,
        status: dto.status,
        readingTime:
          dto.content !== undefined
            ? calculateReadingTime(dto.content)
            : undefined,
      });

      if (!record) {
        throw new NotFoundException('Blog not found');
      }

      await this.invalidateBlogCaches(id);
      return BlogResponseDto.fromEntity(record, {
        thumbnailUrl: await this.resolveThumbnailUrl(record.thumbnailMediaId),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Blog slug already exists');
      }
      throw error;
    }
  }

  async softDelete(id: string, identity: AppUserIdentity) {
    await this.requireOwnedBlog(
      id,
      identity,
      'You are not allowed to delete this blog',
    );

    const record = await this.blogsRepository.softDelete(id);
    if (!record) {
      throw new NotFoundException('Blog not found');
    }

    await this.invalidateBlogCaches(id);
    return {
      id: record.id,
      isActive: record.isActive,
    };
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
}
