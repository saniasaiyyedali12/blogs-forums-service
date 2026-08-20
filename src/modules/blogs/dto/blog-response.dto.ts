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

  @ApiProperty()
  title: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  content: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  thumbnailMediaId: string | null;

  @ApiPropertyOptional({ nullable: true })
  thumbnailUrl: string | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  tags: string[] | null;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED'] })
  status: BlogStatus;

  @ApiPropertyOptional({ nullable: true })
  readingTime: number | null;

  @ApiProperty()
  likeCount: number;

  @ApiPropertyOptional()
  isLikedByCurrentUser?: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  static fromEntity(
    row: BlogRow,
    extras?: {
      thumbnailUrl?: string | null;
      isLikedByCurrentUser?: boolean;
    },
  ): BlogResponseDto {
    const dto: BlogResponseDto = {
      id: row.id,
      userId: row.userId,
      title: row.title,
      slug: row.slug,
      content: row.content,
      thumbnailMediaId: row.thumbnailMediaId,
      thumbnailUrl: extras?.thumbnailUrl ?? row.thumbnailUrl ?? null,
      tags: row.tags,
      status: row.status as BlogStatus,
      readingTime: row.readingTime,
      likeCount: row.likeCount,
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
