import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SubmissionStatus } from '@prisma/client';

export class ListSubmissionsQueryDto {
  @ApiPropertyOptional({ description: '1-based page number. Omit for the full unpaginated list.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page (max 100). Omit for the full unpaginated list.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ enum: SubmissionStatus })
  @IsOptional()
  @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;

  @ApiPropertyOptional({
    description: "Only submissions to this class's assignments; 'none' for assignments given to no class",
  })
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional({ description: 'Search by student name/email or assignment title' })
  @IsOptional()
  @IsString()
  q?: string;
}
