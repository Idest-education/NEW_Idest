import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service.js';

@Module({
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
