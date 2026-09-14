import { Controller, Post, Get, Delete, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SubmissionsService } from './submissions.service.js';
import { CreateSubmissionDto } from './dto/create-submission.dto.js';
import { CreateRedoRequestDto } from './dto/create-redo-request.dto.js';
import { ListSubmissionsQueryDto } from './dto/list-submissions-query.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '@prisma/client';

@ApiTags('Submissions')
@ApiBearerAuth('Bearer')
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('assignments/:assignmentId/submissions')
  @Roles('student')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Submit an essay for an active assignment (Student only)' })
  @ApiResponse({ status: 201, description: 'Essay submitted, queued for AI scoring' })
  @ApiResponse({ status: 400, description: 'Assignment closed/inactive or essay length invalid' })
  async submitEssay(
    @CurrentUser() user: User,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: CreateSubmissionDto,
  ) {
    return this.submissionsService.submitEssay(user.id, assignmentId, dto);
  }

  @Get('submissions')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({
    summary:
      'List every submission the caller may see, across all assignments. ' +
      'Pass page & limit to paginate; omit both for the full unpaginated list.',
  })
  async getAllSubmissions(@CurrentUser() user: User, @Query() query: ListSubmissionsQueryDto) {
    return this.submissionsService.getAllSubmissions(user.id, user.role, query);
  }

  @Get('submissions/:id')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'Get submission attempt by ID' })
  @ApiResponse({ status: 200, description: 'Submission details returned' })
  async getSubmissionById(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.submissionsService.getSubmissionById(id, user.id, user.role);
  }

  @Get('assignments/:assignmentId/submissions')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'List all submissions for an assignment' })
  @ApiResponse({ status: 200, description: 'List of submissions returned' })
  async getSubmissionsByAssignment(
    @CurrentUser() user: User,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.submissionsService.getSubmissionsByAssignment(assignmentId, user.id, user.role);
  }

  @Post('submissions/:id/redo-requests')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Ask the student to redo this essay (Teacher only)' })
  @ApiResponse({ status: 409, description: 'A redo request is already open for this submission' })
  async createRedoRequest(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateRedoRequestDto,
  ) {
    return this.submissionsService.createRedoRequest(user.id, id, user.role, dto);
  }

  @Delete('submissions/:id/redo-requests/:requestId')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Cancel an open redo request (Teacher only)' })
  async cancelRedoRequest(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.submissionsService.cancelRedoRequest(user.id, id, requestId, user.role);
  }

  @Post('submissions/:id/retry-scoring')
  @Roles('teacher', 'admin')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Re-queue AI scoring for a failed submission (Teacher only)' })
  @ApiResponse({ status: 400, description: 'Submission is not in a failed state' })
  async retryScoring(@CurrentUser() user: User, @Param('id') id: string) {
    return this.submissionsService.retryScoring(user.id, id, user.role);
  }
}
