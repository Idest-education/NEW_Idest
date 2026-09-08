import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClerkAuthGuard } from './auth/clerk-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { AllExceptionsFilter } from './auth/auth.exception-filter.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Register the guards as ordinary providers and bind them globally via
    // `useExisting`. This is the shape NestJS documents for "overriding globally
    // registered enhancers": `overrideProvider(ClerkAuthGuard)` in tests only
    // reaches the guard when the APP_GUARD slot points at the class token rather
    // than instantiating its own copy via `useClass`.
    ClerkAuthGuard,
    { provide: APP_GUARD, useExisting: ClerkAuthGuard },
    RolesGuard,
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
