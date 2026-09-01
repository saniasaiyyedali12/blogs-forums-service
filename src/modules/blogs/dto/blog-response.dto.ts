import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { InferSelectModel } from 'drizzle-orm';
import { blogs } from '../../../database/schema/blogs.schema';
import type { BlogStatus } from './create-blog.dto';

type BlogRow = InferSelectModel<typeof blogs>;

export class BlogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiPropertyOptional({ nullable: true })
  title: string | null;

  @ApiPropertyOptional({ nullable: true })
  slug: string | null;

  @ApiPropertyOptional({ nullable: true })
  content: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  thumbnailMediaId: string | null;

  @ApiPropertyOptional({ nullable: true })
  thumbnailUrl: string | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  tags: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description: 'Optional external links. Never required for approval.',
  })
  links: string[] | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  mediaUrls: string[] | null;

  @ApiProperty({ enum: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED'] })
  status: BlogStatus;

  @ApiPropertyOptional({ nullable: true })
  readingTime: number | null;

  @ApiProperty()
  likeCount: number;

  @ApiProperty()
  commentCount: number;

  @ApiProperty()
  analyticsCount: number;

  @ApiPropertyOptional()
  isLikedByCurrentUser?: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  static fromEntity(
    row: BlogRow & { commentCount?: number; viewsCount?: number },
    extras?: {
      thumbnailUrl?: string | null;
      isLikedByCurrentUser?: boolean;
      userId?: string;
    },
  ): BlogResponseDto {
    const dto: BlogResponseDto = {
      id: row.id,
      userId: extras?.userId ?? row.userId,
      title: row.title,
      slug: row.slug,
      content: row.content,
      thumbnailMediaId: row.thumbnailMediaId,
      thumbnailUrl: extras?.thumbnailUrl ?? row.thumbnailUrl ?? null,
      tags: row.tags,
      links: row.links,
      mediaUrls: row.mediaUrls,
      status: row.status as BlogStatus,
      readingTime: row.readingTime,
      likeCount: row.likeCount,
      commentCount: row.commentCount ?? 0,
      analyticsCount: row.viewsCount ?? 0,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };

    if (extras?.isLikedByCurrentUser !== undefined) {
      dto.isLikedByCurrentUser = extras.isLikedByCurrentUser;
    }

    return dto;
  }
}
