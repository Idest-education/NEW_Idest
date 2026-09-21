import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RevisionReason } from '@prisma/client';

export class TagRevisionsDto {
  @ApiProperty({ type: [String], description: 'Revisions to tag; all must belong to the caller' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  revisionIds!: string[];

  @ApiProperty({ enum: RevisionReason, isArray: true, description: 'Why the AI score was changed' })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(RevisionReason, { each: true })
  reasonCodes!: RevisionReason[];

  @ApiPropertyOptional({ description: 'Free-text note applied to every revision in the batch' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
