import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { TagRevisionsDto } from './dto/tag-revisions.dto.js';
import { RevisionReasonsService } from './revision-reasons.service.js';

@ApiTags('Revision Reasons')
@ApiBearerAuth('Bearer')
@Controller()
export class RevisionReasonsController {
  constructor(private readonly revisionReasonsService: RevisionReasonsService) {}

  @Get('assignments/:assignmentId/revisions/untagged')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: "List this teacher's revisions on an assignment that carry no reason yet" })
  @ApiResponse({ status: 200, description: 'Untagged revisions with their score changes' })
  async listUntagged(@CurrentUser() user: User, @Param('assignmentId') assignmentId: string) {
    return this.revisionReasonsService.listUntagged(user.id, assignmentId);
  }

  @Post('revision-reasons/batch')
  @HttpCode(HttpStatus.CREATED)
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Apply one reason set to several revisions at once' })
  @ApiResponse({ status: 201, description: 'Tags appended under a shared batch id' })
  async tagBatch(@CurrentUser() user: User, @Body() dto: TagRevisionsDto) {
    return this.revisionReasonsService.tagBatch(user.id, dto);
  }
}
