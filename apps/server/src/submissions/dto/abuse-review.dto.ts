import { IsIn, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AbuseReviewDto {
  @ApiProperty({ enum: ['confirm', 'reject'], example: 'reject' })
  @IsIn(['confirm', 'reject'])
  decision!: 'confirm' | 'reject';

  @ApiPropertyOptional({ enum: ['requeue', 'manual'], example: 'requeue' })
  @ValidateIf((dto: AbuseReviewDto) => dto.decision === 'reject')
  @IsIn(['requeue', 'manual'])
  action?: 'requeue' | 'manual';
}
