import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { SupportService } from './support.service.js';

@ApiTags('Support')
@ApiBearerAuth('Bearer')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'File a support ticket as a ClickUp task' })
  @ApiResponse({ status: 204, description: 'Ticket filed in ClickUp' })
  @ApiResponse({ status: 503, description: 'ClickUp did not accept the ticket' })
  async createTicket(@CurrentUser() user: User, @Body() dto: CreateTicketDto): Promise<void> {
    await this.supportService.createTicket(user, dto);
  }
}
