import { IsEnum, IsNotEmpty, IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskType } from '@prisma/client';

export class CreateAssignmentDto {
  @ApiProperty({ example: 'IELTS Task 2 University & Workplace Essay', description: 'Title of the assignment' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    example: 'Some people think that universities should provide graduates with knowledge and skills needed in the workplace. To what extent do you agree or disagree?',
    description: 'IELTS writing task prompt text',
  })
  @IsString()
  @IsNotEmpty()
  taskPrompt!: string;

  @ApiProperty({ enum: TaskType, example: TaskType.task_2, description: 'Task 1 or Task 2' })
  @IsEnum(TaskType)
  taskType!: TaskType;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z', description: 'Optional submission deadline' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
