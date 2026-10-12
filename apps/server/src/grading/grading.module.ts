import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller.js';
import { GradingService } from './grading.service.js';
import { IntakeModule } from '../intake/intake.module.js';

@Module({
  imports: [IntakeModule],
  controllers: [GradingController],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}
