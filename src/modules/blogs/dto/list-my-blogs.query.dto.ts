import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { BlogStatus } from '../enums/blog.enum';
import { ListBlogsQueryDto } from './list-blogs.query.dto';

export class ListMyBlogsQueryDto extends ListBlogsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Internal user id whose blogs should be returned',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ enum: BlogStatus })
  @IsOptional()
  @IsIn([
    BlogStatus.DRAFT,
    BlogStatus.PENDING_REVIEW,
    BlogStatus.APPROVED,
    BlogStatus.REJECTED,
    BlogStatus.PUBLISHED,
  ])
  declare status?: BlogStatus;
}
