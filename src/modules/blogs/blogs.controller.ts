import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiOptionalUserIdentityHeaders,
  ApiUserIdentityHeaders,
  OptionalUserIdentity,
  UserIdentity,
} from '../../common/decorators/user-identity.decorator';
import { ServiceAuthGuard } from '../../common/guards/service-auth.guard';
import { apiSuccess } from '../../common/helpers/api-response.helper';
import type { AppUserIdentity } from '../users/users.service';
import { BlogsService } from './blogs.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { ListBlogsQueryDto } from './dto/list-blogs.query.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';

@ApiTags('Blogs')
@ApiSecurity('service-auth')
@ApiUnauthorizedResponse({ description: 'Invalid or missing service token' })
@Controller('api/v1/blogs')
@UseGuards(ServiceAuthGuard)
export class BlogsController {
  constructor(private readonly blogsService: BlogsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiUserIdentityHeaders()
  @ApiOperation({
    summary: 'Create a blog',
    description:
      'Omit status or send DRAFT to save an incomplete draft (title, slug, and content may be omitted). Send status PENDING_REVIEW to submit for approval; title, slug, and content are then required by DTO validation.',
  })
  @ApiBadRequestResponse({
    description:
      'Approval validation failed, or the request body failed type/format checks',
  })
  @ApiConflictResponse({ description: 'Duplicate slug' })
  async create(
    @UserIdentity() identity: AppUserIdentity,
    @Body() dto: CreateBlogDto,
  ) {
    return apiSuccess(
      201,
      'Blog created successfully',
      await this.blogsService.create(identity, dto),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List active blogs' })
  async list(@Query() query: ListBlogsQueryDto) {
    return apiSuccess(
      200,
      'Blogs retrieved successfully',
      await this.blogsService.list(query),
    );
  }

  @Get(':id')
  @ApiOptionalUserIdentityHeaders()
  @ApiOperation({ summary: 'Get an active blog by id' })
  @ApiNotFoundResponse({ description: 'Blog not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @OptionalUserIdentity() identity?: AppUserIdentity,
  ) {
    return apiSuccess(
      200,
      'Blog retrieved successfully',
      await this.blogsService.getById(id, identity),
    );
  }

  @Patch(':id')
  @ApiUserIdentityHeaders()
  @ApiOperation({
    summary: 'Update an owned blog',
    description:
      'Partial updates are allowed while status is DRAFT. Setting status to PENDING_REVIEW requires title, slug, and content in the request body (DTO validation).',
  })
  @ApiNotFoundResponse({ description: 'Blog not found' })
  @ApiForbiddenResponse({ description: 'Not the blog owner' })
  @ApiBadRequestResponse({
    description: 'Approval validation failed, empty update, or invalid fields',
  })
  @ApiConflictResponse({ description: 'Duplicate slug' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @UserIdentity() identity: AppUserIdentity,
    @Body() dto: UpdateBlogDto,
  ) {
    return apiSuccess(
      200,
      'Blog updated successfully',
      await this.blogsService.update(id, identity, dto),
    );
  }

  @Delete(':id')
  @ApiUserIdentityHeaders()
  @ApiOperation({ summary: 'Soft delete an owned blog' })
  @ApiNotFoundResponse({ description: 'Blog not found' })
  @ApiForbiddenResponse({ description: 'Not the blog owner' })
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserIdentity() identity: AppUserIdentity,
  ) {
    return apiSuccess(
      200,
      'Blog deleted successfully',
      await this.blogsService.softDelete(id, identity),
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiUserIdentityHeaders()
  @ApiOperation({ summary: 'Publish an owned blog' })
  @ApiNotFoundResponse({ description: 'Blog not found' })
  @ApiForbiddenResponse({ description: 'Not the blog owner' })
  @ApiBadRequestResponse({ description: 'Only approved blogs can be published' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @UserIdentity() identity: AppUserIdentity,
  ) {
    return apiSuccess(
      200,
      'Blog published successfully',
      await this.blogsService.publish(id, identity),
    );
  }

  @Get(':id/views')
  @ApiUserIdentityHeaders()
  @ApiOperation({ summary: 'Get view events for a blog' })
  @ApiNotFoundResponse({ description: 'Blog not found' })
  @ApiForbiddenResponse({ description: 'Not the blog owner' })
  async getViews(
    @Param('id', ParseUUIDPipe) id: string,
    @UserIdentity() identity: AppUserIdentity,
  ) {
    return apiSuccess(
      200,
      'Blog views retrieved successfully',
      await this.blogsService.getViews(id, identity),
    );
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOptionalUserIdentityHeaders()
  @ApiOperation({ summary: 'Record a unique view for a blog' })
  @ApiNotFoundResponse({ description: 'Blog not found' })
  @ApiBadRequestResponse({ description: 'x-device-id header missing or invalid' })
  async recordView(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-device-id') deviceId?: string,
    @OptionalUserIdentity() identity?: AppUserIdentity,
  ) {
    const result = await this.blogsService.recordViewByViewer(id, deviceId, identity);
    return apiSuccess(200, 'View processed successfully', result);
  }
}
