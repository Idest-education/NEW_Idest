import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AssignmentStatus } from '@prisma/client';

export class UpdateAssignmentStatusDto {
  @ApiProperty({ enum: AssignmentStatus, example: AssignmentStatus.active, description: 'Target assignment status (draft, active, closed, archived)' })
  @IsEnum(AssignmentStatus)
  status!: AssignmentStatus;
}
