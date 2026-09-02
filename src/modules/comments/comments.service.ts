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
import { BlogsRepository } from '../blogs/blogs.repository';
import type { AppUserIdentity } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { CommentsRepository } from './comments.repository';
import { CommentFilterDto } from './dto/comment-filter.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(CommentsRepository)
    private readonly commentsRepository: CommentsRepository,
    @Inject(BlogsRepository)
    private readonly blogsRepository: BlogsRepository,
    @Inject(UsersService)
    private readonly usersService: UsersService,
  ) {}

  async create(
    blogId: string,
    dto: CreateCommentDto,
    identity: AppUserIdentity,
  ) {
    await this.requireActiveBlog(blogId);
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
      if (parent.blogId !== blogId) {
        throw new BadRequestException(
          'Parent comment does not belong to this blog',
        );
      }
      parentCommentId = parent.parentCommentId ?? parent.id;
      isReply = true;
    }

    return this.commentsRepository.create({
      blogId,
      userId: user.id,
      content: dto.content,
      parentCommentId,
      isReply,
    });
  }

  async findByBlogId(blogId: string, filters: CommentFilterDto) {
    await this.requireActiveBlog(blogId);

    const limit = filters.limit ?? 10;
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const rows = await this.commentsRepository.listActiveByBlogId({
      blogId,
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

  async update(
    commentId: string,
    dto: UpdateCommentDto,
    identity: AppUserIdentity,
  ) {
    const existing = await this.commentsRepository.findActiveById(commentId);
    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    const user = await this.usersService.resolve(identity);
    if (!user || existing.userId !== user.id) {
      throw new ForbiddenException(
        'You are not authorized to update this comment',
      );
    }

    return this.commentsRepository.updateContent(commentId, dto.content);
  }

  async remove(commentId: string, identity: AppUserIdentity) {
    const existing =
      await this.commentsRepository.findActiveWithBlogOwner(commentId);
    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    const user = await this.usersService.resolve(identity);
    const isCommentAuthor = !!user && existing.comment.userId === user.id;
    const isBlogOwner = !!user && existing.blogUserId === user.id;

    if (!isCommentAuthor && !isBlogOwner) {
      throw new ForbiddenException(
        'You are not authorized to delete this comment',
      );
    }

    await this.commentsRepository.softDelete(commentId);
    return {
      id: commentId,
      isActive: false,
    };
  }

  private async requireActiveBlog(blogId: string) {
    const blog = await this.blogsRepository.findActiveById(blogId);
    if (!blog) {
      throw new NotFoundException('Blog not found');
    }
    return blog;
  }
}
