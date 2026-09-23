import { IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ScoringHealthQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Inclusive start of the window' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Inclusive end of the window' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
