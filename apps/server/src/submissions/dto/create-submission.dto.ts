import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MAX_ESSAY_LENGTH = 20_000;

export class CreateSubmissionDto {
  @ApiProperty({
    example: 'Some people believe that university education should focus on preparing students for future employment. In my opinion, I strongly agree with this view because technical skills and job readiness are essential for economic development and personal career success. First of all, students spend significant time and money on higher education to secure good employment opportunities.',
    description: 'Submitted essay content text',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ESSAY_LENGTH)
  essayText!: string;

  @ApiPropertyOptional({ example: 'idem_key_abc123', description: 'Optional unique key for idempotency handling' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
