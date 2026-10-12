import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskType } from '@prisma/client';

export class CreateBatchDto {
  @ApiProperty({ example: 'Class 10A — week 3' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: TaskType })
  @IsEnum(TaskType)
  taskType!: TaskType;

  @ApiProperty({ description: 'The question every essay answers, unless the file names its own' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4_000)
  taskPrompt!: string;
}
