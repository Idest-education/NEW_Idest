import { Module } from '@nestjs/common';
import { ClassesController, InviteLinksController } from './classes.controller.js';
import { ClassesService } from './classes.service.js';
import { ClassInvitationsService } from './class-invitations.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [ClassesController, InviteLinksController],
  providers: [ClassesService, ClassInvitationsService],
  exports: [ClassesService],
})
export class ClassesModule {}
