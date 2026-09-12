import { IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScorerType, ScoringStatus } from '@prisma/client';

export class PersistScoringResultDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000000', description: 'Submission ID' })
  @IsUUID()
  submissionId!: string;

  @ApiPropertyOptional({ example: '00000000-0000-0000-0000-000000000000', description: 'Teacher User ID if created by teacher' })
  @IsOptional()
  @IsUUID()
  scorerId?: string;

  @ApiPropertyOptional({ example: '00000000-0000-0000-0000-000000000000', description: 'AI Model Version ID if created by AI' })
  @IsOptional()
  @IsUUID()
  modelVersionId?: string;

  @ApiProperty({ enum: ScorerType, example: ScorerType.ai, description: 'Scorer type (ai or teacher)' })
  @IsEnum(ScorerType)
  scorerType!: ScorerType;

  @ApiProperty({ enum: ScoringStatus, example: ScoringStatus.completed, description: 'Scoring status (completed or failed)' })
  @IsEnum(ScoringStatus)
  status!: ScoringStatus;

  @ApiProperty({
    example: { task_response: 6.5, coherence_cohesion: 7.0, lexical_resource: 6.5, grammatical_range_accuracy: 6.0, overall: 6.5 },
    description: 'Scores object containing IELTS criterion scores',
  })
  @IsObject()
  scores!: Record<string, any>;

  @ApiProperty({
    example: { summary: 'Good attempt with clear arguments.', strengths: ['Logical structure'], improvements: ['Vocabulary enhancement'] },
    description: 'Detailed feedback object',
  })
  @IsObject()
  feedback!: Record<string, any>;

  @ApiPropertyOptional({ description: 'Raw output response from AI model' })
  @IsOptional()
  @IsObject()
  rawOutput?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Processing metadata (tokens, latency, model)' })
  @IsOptional()
  @IsObject()
  processingMetadata?: Record<string, any>;
}
