import { Controller, Post, Patch, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AssignmentsService } from './assignments.service.js';
import { CreateAssignmentDto } from './dto/create-assignment.dto.js';
import { UpdateAssignmentStatusDto } from './dto/update-assignment-status.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '@prisma/client';

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

  @Get()
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'List assignments (Teachers see their own created assignments, Students see active assignments)' })
  @ApiResponse({ status: 200, description: 'List of assignments returned' })
  async getAssignments(@CurrentUser() user: User) {
    return this.assignmentsService.getAssignments(user.id, user.role);
  }

  @Get(':id')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'Get assignment details by ID' })
  @ApiResponse({ status: 200, description: 'Assignment details returned' })
  async getAssignment(@Param('id') id: string) {
    return this.assignmentsService.getAssignment(id);
  }
}
