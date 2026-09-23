import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { once } from 'node:events';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ScoringHealthQueryDto } from './dto/scoring-health-query.dto.js';
import { ExportQueryDto } from './dto/export-query.dto.js';
import {
  AnalyticsService,
  type AnalyticsOverview,
  type ScoringHealthRow,
} from './analytics.service.js';

@ApiTags('Analytics')
@ApiBearerAuth('Bearer')
@Controller('analytics')
@Roles('admin')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Headline counts, override rate, deltas and latencies (Admin only)' })
  @ApiResponse({ status: 200, description: 'Aggregates read from v_assessment_outcomes and v_scoring_health' })
  async overview(): Promise<AnalyticsOverview> {
    return this.analytics.getOverview();
  }

  @Get('scoring-health')
  @ApiOperation({ summary: 'Scoring attempts, failures and latency per day and model (Admin only)' })
  @ApiResponse({ status: 200, description: 'Time series read from v_scoring_health' })
  async scoringHealth(@Query() query: ScoringHealthQueryDto): Promise<ScoringHealthRow[]> {
    return this.analytics.getScoringHealth({ from: query.from, to: query.to });
  }

  /**
   * Streams v_assessment_outcomes. `@Res` without passthrough turns off Nest's
   * own response handling, so the body is written page by page instead of
   * buffered.
   */
  @Get('export')
  @ApiOperation({ summary: 'Stream the pseudonymous benchmark dataset (Admin only)' })
  @ApiResponse({ status: 200, description: 'CSV or JSONL stream of v_assessment_outcomes' })
  async export(
    @CurrentUser() user: User,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const options = {
      format: query.format ?? ('csv' as const),
      from: query.from,
      to: query.to,
      includeEssays: query.include_essays === true,
    };

    const exportId = await this.analytics.beginExport(user.id, options);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      options.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="assessment-outcomes-${stamp}.${options.format}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Export-Id', exportId);

    for await (const chunk of this.analytics.streamExport(options)) {
      if (!res.write(chunk)) {
        await once(res, 'drain');
      }
    }
    res.end();
  }
}
