import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AssessmentPersistenceService } from './assessments.service.js';
import { PersistScoringResultDto } from './dto/persist-scoring-result.dto.js';
import { CreateScoreRevisionDto } from './dto/create-score-revision.dto.js';
import { PublishResultDto } from './dto/publish-result.dto.js';
import { UnpublishResultDto } from './dto/unpublish-result.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '@prisma/client';

@ApiTags('Assessments & Revisions')
@ApiBearerAuth('Bearer')
@Controller('submissions/:submissionId')
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentPersistenceService) {}

  @Post('scoring-results')
  @Roles('admin', 'teacher')
  @ApiOperation({ summary: 'Persist an AI or teacher scoring result (Append-only)' })
  @ApiResponse({ status: 201, description: 'Scoring result saved, submission status updated to scored' })
  async persistScoringResult(
    @Param('submissionId') submissionId: string,
    @Body() dto: PersistScoringResultDto,
  ) {
    dto.submissionId = submissionId;
    return this.assessmentsService.persistScoringResult(dto);
  }

  @Post('revisions')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Create a teacher score revision (Append-only, Teacher only)' })
  @ApiResponse({ status: 201, description: 'Score revision saved, status updated to under_review' })
  async createTeacherRevision(
    @CurrentUser() user: User,
    @Param('submissionId') submissionId: string,
    @Body() dto: CreateScoreRevisionDto,
  ) {
    return this.assessmentsService.createTeacherRevision(user.id, submissionId, dto);
  }

  @Post('publish')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Publish final reviewed result for student view (Teacher only)' })
  @ApiResponse({ status: 201, description: 'Published result snapshot created, status updated to published' })
  async publishResult(
    @CurrentUser() user: User,
    @Param('submissionId') submissionId: string,
    @Body() dto: PublishResultDto,
  ) {
    return this.assessmentsService.publishResult(user.id, submissionId, dto);
  }

  @Post('unpublish')
  @HttpCode(HttpStatus.OK)
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Unpublish result snapshot, reverting student visibility (Teacher only)' })
  @ApiResponse({ status: 200, description: 'Published result marked unpublished, status reverted to under_review' })
  async unpublishResult(
    @CurrentUser() user: User,
    @Param('submissionId') submissionId: string,
    @Body() dto: UnpublishResultDto,
  ) {
    return this.assessmentsService.unpublishResult(user.id, submissionId, dto);
  }

  @Get('history')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'Get chronological assessment version history' })
  @ApiResponse({ status: 200, description: 'Returns full history for teachers/admins or published result for students' })
  async getSubmissionHistory(
    @CurrentUser() user: User,
    @Param('submissionId') submissionId: string,
  ) {
    return this.assessmentsService.getAssessmentHistory(submissionId, user.id, user.role);
  }
}
