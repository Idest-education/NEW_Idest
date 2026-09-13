import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { ClassesService } from './classes.service.js';
import {
  AddMemberDto,
  CreateClassDto,
  CreateInviteLinkDto,
  UpdateClassDto,
} from './dto/class.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Classes')
@ApiBearerAuth('Bearer')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Post()
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Create a class (Teacher only)' })
  createClass(@CurrentUser() user: User, @Body() dto: CreateClassDto) {
    return this.classes.createClass(user.id, dto);
  }

  @Get()
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'List classes: the ones you teach, or the ones you are in' })
  listClasses(@CurrentUser() user: User) {
    return this.classes.listClasses(user.id, user.role);
  }

  @Get(':id')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'Class detail with roster and assignments' })
  getClass(@CurrentUser() user: User, @Param('id') id: string) {
    return this.classes.getClass(id, user.id, user.role);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Rename, re-describe or archive a class (Teacher only)' })
  updateClass(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateClassDto) {
    return this.classes.updateClass(id, user.id, user.role, dto);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Delete a class (Teacher only, refused while assignments are active)' })
  @ApiResponse({ status: 400, description: 'Class still has active assignments' })
  deleteClass(@CurrentUser() user: User, @Param('id') id: string) {
    return this.classes.deleteClass(id, user.id, user.role);
  }

  @Post(':id/members')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Add an existing student account to the class (Teacher only)' })
  addMember(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.classes.addMember(id, user.id, user.role, dto);
  }

  @Delete(':id/members/:studentId')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Remove a student from the class (Teacher only)' })
  removeMember(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.classes.removeMember(id, studentId, user.id, user.role);
  }

  @Post(':id/invite-links')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Create a shareable join link for the class (Teacher only)' })
  createInviteLink(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateInviteLinkDto,
  ) {
    return this.classes.createInviteLink(id, user.id, user.role, dto);
  }
}

@ApiTags('Classes')
@ApiBearerAuth('Bearer')
@Controller('invite-links')
export class InviteLinksController {
  constructor(private readonly classes: ClassesService) {}

  @Get(':token')
  @Roles('student', 'teacher', 'admin')
  @ApiOperation({ summary: 'Preview where an invite link leads before joining' })
  preview(@Param('token') token: string) {
    return this.classes.previewInviteLink(token);
  }

  @Post(':token/accept')
  @Roles('student')
  @ApiOperation({ summary: 'Join the class this link points at (Student only)' })
  @ApiResponse({ status: 400, description: 'Link revoked, expired, exhausted, or class archived' })
  accept(@CurrentUser() user: User, @Param('token') token: string) {
    return this.classes.acceptInviteLink(token, user.id, user.role);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Revoke an invite link (Teacher only)' })
  revoke(@CurrentUser() user: User, @Param('id') id: string) {
    return this.classes.revokeInviteLink(id, user.id, user.role);
  }
}
