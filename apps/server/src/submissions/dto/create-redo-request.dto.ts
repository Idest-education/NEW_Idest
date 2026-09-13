import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRedoRequestDto {
  @ApiProperty({ example: 'Bài chưa đúng dạng Task 2, em viết lại theo đề nhé.' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
