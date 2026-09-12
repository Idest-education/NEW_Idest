import { Module } from '@nestjs/common';
import { AssessmentsController } from './assessments.controller.js';
import { AssessmentPersistenceService } from './assessments.service.js';

@Module({
  controllers: [AssessmentsController],
  providers: [AssessmentPersistenceService],
  exports: [AssessmentPersistenceService],
})
export class AssessmentsModule {}
