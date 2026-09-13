import { IsBoolean, IsEmail, IsEnum, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClassStatus } from '@prisma/client';

export class CreateClassDto {
  @ApiProperty({ example: 'IELTS Writing — Lớp tối T3/T5' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ example: 'Lớp luyện Task 2, trình độ mục tiêu band 6.5' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateClassDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ClassStatus })
  @IsOptional()
  @IsEnum(ClassStatus)
  status?: ClassStatus;
}

export class AddMemberDto {
  @ApiProperty({ example: 'hocvien@example.com', description: 'Email of an existing student account' })
  @IsEmail()
  email!: string;
}

export class CreateInviteLinkDto {
  @ApiPropertyOptional({ example: 'Khóa tháng 9' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  label?: string;

  @ApiPropertyOptional({ example: 30, description: 'Maximum number of students who may join with this link' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class UpdateAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  taskPrompt?: string;

  @ApiPropertyOptional({ description: 'Class this assignment belongs to, or null to detach it' })
  @IsOptional()
  @IsString()
  classId?: string | null;

  @ApiPropertyOptional({ description: 'Pin this assignment to the top of the student page' })
  @IsOptional()
  @IsBoolean()
  highlighted?: boolean;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z', description: 'Deadline, or null to clear it' })
  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;
}

