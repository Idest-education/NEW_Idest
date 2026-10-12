import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser, OptionalUser } from '../auth/decorators/current-user.decorator.js';
import { imageFileFilter } from '../cloudinary/image-upload.js';
import { PageQueryDto } from './dto/page-query.dto.js';
import { GradingService, type Caller } from './grading.service.js';
import { GradeEssayDto } from './dto/grade-essay.dto.js';
import { clientHash } from './client-hash.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTO_PAGES = 5;

@ApiTags('Grading')
@Controller('grade')
export class GradingController {
  constructor(
    private readonly grading: GradingService,
    private readonly config: ConfigService,
  ) {}

  private caller(req: Request, user: User | null): Caller {
    const secret = this.config.get<string>('CLIENT_HASH_SECRET') ?? this.config.getOrThrow<string>('CLERK_SECRET_KEY');
    return { user, clientHash: clientHash(req, secret) };
  }

  @Post()
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Grade one essay. No account needed; optional Task 1 chart image.' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('taskImage', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  grade(
    @Req() req: Request,
    @OptionalUser() user: User | null,
    @Body() dto: GradeEssayDto,
    @UploadedFile() taskImage?: Express.Multer.File,
  ) {
    return this.grading.grade(this.caller(req, user), dto, taskImage);
  }

  @Post('transcribe')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Transcribe photos of a handwritten essay (pages in order)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('images', MAX_PHOTO_PAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  transcribe(
    @Req() req: Request,
    @OptionalUser() user: User | null,
    @UploadedFiles() images: Express.Multer.File[] = [],
  ) {
    return this.grading.transcribe(this.caller(req, user), images);
  }

  @Get('transcribe/:id')
  @Public()
  @ApiOperation({ summary: 'Status and text of a photo transcription' })
  transcription(@Param('id', ParseUUIDPipe) id: string) {
    return this.grading.transcription(id);
  }

  @Get('mine')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: "The signed-in teacher's single-essay gradings" })
  mine(@CurrentUser() user: User, @Query() query: PageQueryDto) {
    return this.grading.mine(user.id, query.page, query.limit);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Status and result of a public grading' })
  result(@Param('id', ParseUUIDPipe) id: string, @OptionalUser() user: User | null) {
    return this.grading.result(id, user);
  }

  @Post(':id/retry')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Re-queue a public grading whose scoring failed' })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.grading.retry(id);
  }
}
