import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { FeedbackExportQueryDto } from './dto/feedback-export-query.dto.js';
import { SaveFeedbackDto } from './dto/save-feedback.dto.js';
import { FeedbackService, type FeedbackResponseView, type FeedbackState } from './feedback.service.js';

@ApiTags('Feedback')
@ApiBearerAuth('Bearer')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('me')
  @Roles('teacher', 'student')
  @ApiOperation({ summary: "The caller's survey response, graded count and whether to show the pop-up" })
  me(@CurrentUser() user: User): Promise<FeedbackState> {
    return this.feedback.state(user);
  }

  @Put('me')
  @Roles('teacher', 'student')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: "Create or replace the caller's survey response" })
  @ApiResponse({ status: 400, description: 'instrument_version_mismatch or invalid_answers with item codes' })
  save(@CurrentUser() user: User, @Body() dto: SaveFeedbackDto): Promise<FeedbackResponseView> {
    return this.feedback.save(user, dto.instrumentVersion, dto.answers);
  }

  @Post('me/prompt-dismissal')
  @Roles('teacher')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide the survey pop-up until the next 10 graded submissions' })
  dismissPrompt(@CurrentUser() user: User): Promise<{ prompt: false }> {
    return this.feedback.dismissPrompt(user);
  }

  /** `@Res` without passthrough: the body is written here, not by Nest. */
  @Get('export')
  @Roles('admin')
  @ApiOperation({ summary: 'Download the survey as SPSS-ready CSV or SPSS syntax (Admin only)' })
  async export(
    @CurrentUser() user: User,
    @Query() query: FeedbackExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.feedback.exportFile(user.id, query.format ?? 'csv');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.body);
  }
}
