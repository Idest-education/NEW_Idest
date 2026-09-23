import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ScoringHealthQueryDto } from './dto/scoring-health-query.dto.js';
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
}
