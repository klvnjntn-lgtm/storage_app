import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiAccessController } from './api-access.controller';
import { ApiKeysService } from './api-keys.service';
import { WebhooksService } from './webhooks.service';

// Global: JwtAuthGuard (used in nearly every module) authenticates API keys,
// and document services across the app emit webhook events. Both take
// these as @Optional(), so narrow test modules don't have to import this.
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ApiAccessController],
  providers: [ApiKeysService, WebhooksService],
  exports: [ApiKeysService, WebhooksService],
})
export class ApiAccessModule {}
