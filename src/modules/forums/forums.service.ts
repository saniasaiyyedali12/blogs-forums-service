import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  decodeCursor,
  sliceCursorPage,
} from '../../common/helpers/cursor-pagination.helper';
import type { AppUserIdentity } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { MediaService } from '../media/media.service';
import { CreateForumCommentDto } from './dto/create-forum-comment.dto';
import { CreateForumDto } from './dto/create-forum.dto';
import { ListForumCommentsQueryDto } from './dto/list-forum-comments.query.dto';
import { ListMyForumsQueryDto } from './dto/list-my-forums.query.dto';
import { ListForumsQueryDto } from './dto/list-forums.query.dto';
import { UpdateForumCommentDto } from './dto/update-forum-comment.dto';
import { UpdateForumDto } from './dto/update-forum.dto';
import { ForumCommentsRepository } from './forum-comments.repository';
import { ForumsRepository } from './forums.repository';

@Injectable()
export class ForumsService {
  constructor(
    @Inject(ForumsRepository)
    private readonly forumsRepository: ForumsRepository,
    @Inject(ForumCommentsRepository)
    private readonly commentsRepository: ForumCommentsRepository,
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(MediaService)
    private readonly mediaService: MediaService,
  ) {}

  async createForum(dto: CreateForumDto, identity: AppUserIdentity) {
    const user = await this.usersService.require(identity, true);

    let mediaUrl: string | undefined = undefined;
    if (dto.mediaId) {
      try {
        const mediaRecord = await this.mediaService.findOne(dto.mediaId);
        mediaUrl = mediaRecord.url ?? undefined;
      } catch {
        throw new BadRequestException('Invalid mediaId provided');
      }
    }

    const forum = await this.forumsRepository.create({
      userId: user.id,
      title: dto.title.trim(),
      content: dto.content,
      category: dto.category.trim(),
      subCategory: dto.subCategory,
      mediaId: dto.mediaId,
      mediaUrl,
      isAnonymous: dto.isAnonymous ?? false,
    });

    return this.formatForum(forum);
  }

  async listForums(query: ListForumsQueryDto) {
    return this.pageForums(query);
  }

  async listMyForums(identity: AppUserIdentity, query: ListMyForumsQueryDto) {
    const requestedUserId = query.userId ?? query.user_id;
    if (!requestedUserId) {
      throw new BadRequestException('user_id is required');
    }

    const user = await this.usersService.require(identity);
    if (user.appUserId !== requestedUserId) {
      throw new ForbiddenException(
        'user_id must match the authenticated application user',
      );
    }

    return this.pageForums({
      ...query,
      userId: user.id,
    });
  }

  async getForum(id: string) {
    const forum = await this.forumsRepository.findActiveById(id);
    if (!forum) {
      throw new NotFoundException('Forum not found');
    }
    return this.formatForum(forum);
  }

  async updateForum(
    id: string,
    dto: UpdateForumDto,
    identity: AppUserIdentity,
  ) {
    const hasUpdate = [
      dto.title,
      dto.content,
      dto.category,
      dto.subCategory,
      dto.mediaId,
      dto.isAnonymous,
    ].some((value) => value !== undefined);

    if (!hasUpdate) {
      throw new BadRequestException('No fields to update');
    }

    await this.requireOwnedForum(
      id,
      identity,
      'You are not allowed to modify this forum',
    );

    let mediaUrl: string | undefined = undefined;
    if (dto.mediaId) {
      try {
        const mediaRecord = await this.mediaService.findOne(dto.mediaId);
        mediaUrl = mediaRecord.url ?? undefined;
      } catch {
        throw new BadRequestException('Invalid mediaId provided');
      }
    }

    const record = await this.forumsRepository.update(id, {
      title: dto.title?.trim(),
      content: dto.content,
      category: dto.category?.trim(),
      subCategory: dto.subCategory,
      mediaId: dto.mediaId,
      mediaUrl,
      isAnonymous: dto.isAnonymous,
    });

    if (!record) {
      throw new NotFoundException('Forum not found');
    }
    return this.formatForum(record);
  }

  async deleteForum(id: string, identity: AppUserIdentity) {
    await this.requireOwnedForum(
      id,
      identity,
      'You are not allowed to delete this forum',
    );
    const record = await this.forumsRepository.softDelete(id);
    if (!record) {
      throw new NotFoundException('Forum not found');
    }
    return { id: record.id, isActive: record.isActive };
  }

  async createComment(
    forumId: string,
    dto: CreateForumCommentDto,
    identity: AppUserIdentity,
  ) {
    await this.getForum(forumId);
    const user = await this.usersService.require(identity, true);

    let parentCommentId: string | null = null;
    let isReply = false;

    if (dto.parentCommentId) {
      const parent = await this.commentsRepository.findActiveById(
        dto.parentCommentId,
      );
      if (!parent) {
        throw new NotFoundException('Parent comment not found');
      }
      if (parent.forumId !== forumId) {
        throw new BadRequestException(
          'Parent comment does not belong to this forum',
        );
      }
      parentCommentId = parent.parentCommentId ?? parent.id;
      isReply = true;
    }

    return this.commentsRepository.create({
      forumId,
      userId: user.id,
      content: dto.content,
      parentCommentId,
      isReply,
    });
  }

  async listComments(forumId: string, query: ListForumCommentsQueryDto) {
    await this.getForum(forumId);
    const limit = query.limit ?? 10;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.commentsRepository.listActiveByForumId({
      forumId,
      limit,
      cursor,
    });
    const page = sliceCursorPage(rows, limit);
    return {
      items: page.items,
      pagination: {
        limit,
        nextCursor: page.nextCursor,
        hasNextPage: page.hasNextPage,
      },
    };
  }

  async updateComment(
    id: string,
    dto: UpdateForumCommentDto,
    identity: AppUserIdentity,
  ) {
    const existing = await this.commentsRepository.findActiveById(id);
    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    const user = await this.usersService.resolve(identity);
    if (!user || existing.userId !== user.id) {
      throw new ForbiddenException(
        'You are not authorized to update this comment',
      );
    }

    return this.commentsRepository.updateContent(id, dto.content);
  }

  async deleteComment(id: string, identity: AppUserIdentity) {
    const existing = await this.commentsRepository.findActiveById(id);
    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    const user = await this.usersService.resolve(identity);
    const forum = await this.forumsRepository.findActiveById(existing.forumId);
    const isCommentAuthor = !!user && existing.userId === user.id;
    const isForumOwner = !!user && forum?.userId === user.id;

    if (!isCommentAuthor && !isForumOwner) {
      throw new ForbiddenException(
        'You are not authorized to delete this comment',
      );
    }

    await this.commentsRepository.softDelete(id);
    return { id, isActive: false };
  }

  private async pageForums(params: {
    limit?: number;
    cursor?: string;
    search?: string;
    category?: string;
    subCategory?: string;
    userId?: string;
  }) {
    const limit = params.limit ?? 20;
    const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
    const rows = await this.forumsRepository.listActive({
      limit,
      cursor,
      userId: params.userId,
      category: params.category,
      subCategory: params.subCategory,
      search: params.search?.trim() || undefined,
    });
    const page = sliceCursorPage(rows, limit);
    const items = page.items.map((item) => this.formatForum(item));
    return { items, nextCursor: page.nextCursor };
  }

  private async requireOwnedForum(
    id: string,
    identity: AppUserIdentity,
    forbiddenMessage: string,
  ) {
    const forum = await this.forumsRepository.findActiveById(id);
    if (!forum) {
      throw new NotFoundException('Forum not found');
    }

    const user = await this.usersService.resolve(identity);
    if (!user || forum.userId !== user.id) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return forum;
  }

  private formatForum(forum: any) {
    if (!forum) return forum;
    const res = { ...forum };
    if (res.isAnonymous) {
      res.userId = '00000000-0000-0000-0000-000000000000';
    }
    return res;
  }
}
