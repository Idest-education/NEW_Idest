import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { SupportService, type CreatedTicket, type SupportTicket } from './support.service.js';

export const MAX_TICKET_IMAGES = 3;
export const MAX_TICKET_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_TICKET_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

@ApiTags('Support')
@ApiBearerAuth('Bearer')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('tickets')
  @ApiOperation({ summary: "List the caller's support tickets (admins see every ticket)" })
  @ApiResponse({ status: 503, description: 'ClickUp could not be reached' })
  listTickets(@CurrentUser() user: User): Promise<SupportTicket[]> {
    return this.supportService.listTickets(user);
  }

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'File a support ticket as a ClickUp task, with up to 3 screenshots' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiResponse({ status: 201, description: 'Ticket filed in ClickUp' })
  @ApiResponse({ status: 503, description: 'ClickUp did not accept the ticket' })
  @UseInterceptors(
    FilesInterceptor('images', MAX_TICKET_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_TICKET_IMAGE_BYTES },
      fileFilter: (_req: Request, file, callback) => {
        if (!ALLOWED_TICKET_IMAGE_MIME_TYPES.has(file.mimetype)) {
          callback(new BadRequestException({ error: 'unsupported_image_type' }), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  createTicket(
    @CurrentUser() user: User,
    @Body() dto: CreateTicketDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<CreatedTicket> {
    return this.supportService.createTicket(user, dto, files ?? []);
  }
}
