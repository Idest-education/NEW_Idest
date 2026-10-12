import { Module } from '@nestjs/common';
import { BatchesController } from './batches.controller.js';
import { BatchesService } from './batches.service.js';
import { IntakeModule } from '../intake/intake.module.js';

@Module({
  imports: [IntakeModule],
  controllers: [BatchesController],
  providers: [BatchesService],
})
export class BatchesModule {}
