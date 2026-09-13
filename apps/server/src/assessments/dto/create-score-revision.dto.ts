import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateScoreRevisionDto {
  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000000',
    description:
      'ID of the base AI scoring result this revises. Omit when the teacher is grading before the AI has scored the essay, or because the AI is unavailable — the revision is then fully teacher-authored.',
  })
  @IsOptional()
  @IsUUID()
  baseResultId?: string;

  @ApiProperty({
    example: { task_response: 7.0, coherence_cohesion: 7.0, lexical_resource: 6.5, grammatical_range_accuracy: 6.5, overall: 7.0 },
    description: 'Teacher final revised scores',
  })
  @IsObject()
  finalScores!: Record<string, any>;

  @ApiProperty({
    example: { summary: 'Good overall position and logical structure.', strengths: ['Clear position'], improvements: ['Use precise vocabulary'] },
    description: 'Teacher final revised feedback',
  })
  @IsObject()
  finalFeedback!: Record<string, any>;

  @ApiPropertyOptional({
    example: { score_changes: [{ criterion: 'lexical_resource', from: 6.0, to: 6.5 }] },
    description: 'JSON object detailing changes made by the teacher (auto-calculated if omitted)',
  })
  @IsOptional()
  @IsObject()
  changes?: Record<string, any>;

  @ApiPropertyOptional({ example: 'Upgraded lexical score based on paragraph 2 vocabulary usage.', description: 'Optional explanation note from teacher' })
  @IsOptional()
  @IsString()
  revisionNote?: string;
}
