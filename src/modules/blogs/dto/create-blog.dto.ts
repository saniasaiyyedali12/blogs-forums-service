import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { BlogStatus } from '../enums/blog.enum';

export const BLOG_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export { BlogStatus };

export class CreateBlogDto {
  @ApiProperty({ example: 'Getting started with blogs' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'getting-started-with-blogs' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, numbers, and hyphens',
  })
  slug: string;

  @ApiProperty({ example: 'This is the blog content.' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Media ID for the blog thumbnail',
  })
  @IsOptional()
  @IsUUID()
  thumbnailMediaId?: string;

  @ApiPropertyOptional({ type: [String], example: ['nestjs', 'postgres'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    enum: BLOG_STATUSES,
    example: 'DRAFT',
    description:
      'Optional. Defaults to DRAFT. Determined by the backend when omitted.',
  })
  @IsOptional()
  @IsIn(BLOG_STATUSES)
  status?: BlogStatus;
}
