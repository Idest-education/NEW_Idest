import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ClassesModule } from '../classes/classes.module.js';
import { OnboardingService } from './onboarding.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, AuditModule, ClassesModule],
  controllers: [UsersController],
  providers: [UsersService, OnboardingService],
})
export class UsersModule {}
