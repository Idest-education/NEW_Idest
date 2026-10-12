import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { User } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { imageFileFilter } from '../cloudinary/image-upload.js';
import { BatchesService, MAX_BATCH_FILES } from './batches.service.js';
import { CreateBatchDto } from './dto/create-batch.dto.js';

const MAX_CHART_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

@ApiTags('Bulk grading')
@ApiBearerAuth('Bearer')
@Controller('batches')
@Roles('teacher', 'admin')
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Post()
  @ApiOperation({ summary: 'Start a bulk grading batch with its task prompt and optional Task 1 chart' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('taskImage', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CHART_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  create(@CurrentUser() user: User, @Body() dto: CreateBatchDto, @UploadedFile() taskImage?: Express.Multer.File) {
    return this.batches.create(user, dto, taskImage);
  }

  @Get()
  @ApiOperation({ summary: "The teacher's batches with progress counts" })
  list(@CurrentUser() user: User) {
    return this.batches.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One batch with its files and essays' })
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.batches.detail(user, id);
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Download the scores as .xlsx' })
  async export(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    const { fileName, buffer } = await this.batches.export(user, id);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="scores.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Post(':id/files')
  @ApiOperation({ summary: 'Upload essays: images, PDF, Word (.doc/.docx) or Excel (.xls/.xlsx/.csv)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', MAX_BATCH_FILES, { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } }),
  )
  addFiles(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.batches.addFiles(user, id, files);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Re-send unread files and unscored essays in this batch' })
  retry(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.batches.retry(user, id);
  }
}
