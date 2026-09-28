import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class FeedbackExportQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'sps'], example: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'sps'])
  format?: 'csv' | 'sps';
}
