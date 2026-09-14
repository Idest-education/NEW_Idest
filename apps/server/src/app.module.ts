import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module.js'; // Wait, let's check prisma import path
import { AuthModule } from './auth/auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module.js';
import { CloudinaryModule } from './cloudinary/cloudinary.module.js';
import { AssignmentsModule } from './assignments/assignments.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { AssessmentsModule } from './assessments/assessments.module.js';
import { ClassesModule } from './classes/classes.module.js';
import { UsersModule } from './users/users.module.js';
import { ClerkAuthGuard } from './auth/clerk-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { AllExceptionsFilter } from './auth/auth.exception-filter.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env.local', '../../.env'] }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    AuthModule,
    AuditModule,
    RabbitMQModule,
    CloudinaryModule,
    AssignmentsModule,
    SubmissionsModule,
    AssessmentsModule,
    ClassesModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    ClerkAuthGuard,
    { provide: APP_GUARD, useExisting: ClerkAuthGuard },
    RolesGuard,
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
