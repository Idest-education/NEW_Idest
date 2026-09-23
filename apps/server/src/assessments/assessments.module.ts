import { Module } from '@nestjs/common';
import { AssessmentsController } from './assessments.controller.js';
import { AssessmentPersistenceService } from './assessments.service.js';
import { RevisionReasonsModule } from '../revision-reasons/revision-reasons.module.js';

@Module({
  imports: [RevisionReasonsModule],
  controllers: [AssessmentsController],
  providers: [AssessmentPersistenceService],
  exports: [AssessmentPersistenceService],
})
export class AssessmentsModule {}
