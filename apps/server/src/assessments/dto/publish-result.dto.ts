import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PublishResultDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000000', description: 'ID of the teacher revision to publish' })
  @IsUUID()
  revisionId!: string;
}
