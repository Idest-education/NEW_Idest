import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExportQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'jsonl'], example: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'jsonl'])
  format?: 'csv' | 'jsonl';

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Include the student-authored essay text. Off by default: the CatBoost training set is the only reason to move it.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_essays?: boolean;
}
