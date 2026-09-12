import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UnpublishResultDto {
  @ApiPropertyOptional({
    example: 'Revising band score based on updated student essay submission',
    description: 'Optional reason for unpublishing the result',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
