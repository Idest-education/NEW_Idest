import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RevisionReasonsController } from './revision-reasons.controller.js';
import { RevisionReasonsService } from './revision-reasons.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [RevisionReasonsController],
  providers: [RevisionReasonsService],
  exports: [RevisionReasonsService],
})
export class RevisionReasonsModule {}
