import {
  BadRequestException,
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { AssignmentsService } from './assignments.service.js';
import { CreateAssignmentDto } from './dto/create-assignment.dto.js';
import { UpdateAssignmentStatusDto } from './dto/update-assignment-status.dto.js';
import { ListAssignmentsQueryDto } from './dto/list-assignments-query.dto.js';
import { UpdateAssignmentDto } from '../classes/dto/class.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '@prisma/client';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

@ApiTags('Assignments')
@ApiBearerAuth('Bearer')
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post()
  @Roles('teacher')
  @ApiOperation({ summary: 'Create a new writing assignment (Teacher only)' })
  @ApiResponse({ status: 201, description: 'Assignment successfully created with draft status' })
  async createAssignment(
    @CurrentUser() user: User,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignmentsService.createAssignment(user.id, dto);
  }

  @Patch(':id')
  @Roles('teacher')
  @ApiOperation({ summary: 'Edit title, prompt, class, highlight or deadline (Teacher only)' })
  async updateAssignment(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.assignmentsService.updateAssignment(user.id, id, dto);
  }

  @Patch(':id/status')
  @Roles('teacher')
  @ApiOperation({ summary: 'Update assignment status (e.g. draft -> active -> closed) (Teacher only)' })
  @ApiResponse({ status: 200, description: 'Assignment status updated successfully' })
  async updateStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentStatusDto,
  ) {
    return this.assignmentsService.updateStatus(user.id, id, dto);
  }

  @Delete(':id')
  @Roles('teacher')
  @ApiOperation({ summary: 'Delete an assignment (Teacher only). Existing submissions are preserved.' })
  async deleteAssignment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.assignmentsService.deleteAssignment(user.id, id);
  }

  @Post(':id/image')
  @Roles('teacher')
  @ApiOperation({ summary: 'Upload/replace the Task 1 chart/graph/diagram image (Teacher only)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: (_req: Request, file, callback) => {
        if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
          callback(new BadRequestException({ error: 'unsupported_image_type' }), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.assignmentsService.uploadTaskImage(user.id, id, file);
  }

  @Delete(':id/image')
  @Roles('teacher')
  @ApiOperation({ summary: 'Remove the Task 1 chart/graph/diagram image (Teacher only)' })
  async deleteImage(@CurrentUser() user: User, @Param('id') id: string) {
    return this.assignmentsService.deleteTaskImage(user.id, id);
  }

  @Get()
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({
    summary:
      'List assignments (Teachers see their own created assignments, Students see active assignments). ' +
      'Pass page & limit to paginate; omit both for the full unpaginated list.',
  })
  @ApiResponse({ status: 200, description: 'List of assignments, or a paginated page of them, returned' })
  async getAssignments(@CurrentUser() user: User, @Query() query: ListAssignmentsQueryDto) {
    return this.assignmentsService.getAssignments(user.id, user.role, query);
  }

  @Get(':id')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'Get assignment details by ID' })
  @ApiResponse({ status: 200, description: 'Assignment details returned' })
  async getAssignment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.assignmentsService.getAssignmentDetail(id, user.id, user.role);
  }
}
