import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskType } from '@prisma/client';

export class GradeEssayDto {
  @ApiProperty({ enum: TaskType, example: TaskType.task_2 })
  @IsEnum(TaskType)
  taskType!: TaskType;

  @ApiProperty({ description: 'The IELTS question the essay answers' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4_000)
  taskPrompt!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  essayText!: string;

  @ApiPropertyOptional({ description: 'Unique per attempt, so a retried request does not grade twice' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'The photo transcription this text came from, if any' })
  @IsOptional()
  @IsUUID()
  transcriptionId?: string;
}
