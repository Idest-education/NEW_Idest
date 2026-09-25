import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({ example: 'Không nộp được bài', description: 'Short ticket title' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({
    example: 'Bấm Nộp bài nhưng trang không phản hồi, đã thử tải lại trang.',
    description: 'Full description of the problem',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}
