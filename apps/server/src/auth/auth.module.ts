import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { clerkClientProvider } from './clerk-client.provider.js';
import { UserSyncService } from './user-sync.service.js';
import { WebhookController } from './webhook.controller.js';
import { InvitationController } from './invitation.controller.js';
import { AuthController } from './auth.controller.js';

@Module({
  imports: [ConfigModule],
  controllers: [WebhookController, InvitationController, AuthController],
  providers: [clerkClientProvider, UserSyncService],
  exports: [clerkClientProvider, UserSyncService],
})
export class AuthModule {}
