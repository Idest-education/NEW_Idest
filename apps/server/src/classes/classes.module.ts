import { Module } from '@nestjs/common';
import { ClassesController, InviteLinksController } from './classes.controller.js';
import { ClassesService } from './classes.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ClassesController, InviteLinksController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
