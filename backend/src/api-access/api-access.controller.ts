import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import { WebhooksService, WEBHOOK_EVENTS } from './webhooks.service';
import {
  CreateApiKeyDto,
  CreateWebhookDto,
  UpdateWebhookDto,
} from './dto/api-access.dto';

// Managing API keys and webhooks is admin-only — and only from a real
// sign-in: an API key can't mint more keys (see JwtAuthGuard).
@Roles('ADMIN')
@Controller('integrations-api')
export class ApiAccessController {
  constructor(
    private keys: ApiKeysService,
    private webhooks: WebhooksService,
  ) {}

  @Get('keys')
  listKeys(@CurrentOrg() organizationId: string) {
    return this.keys.list(organizationId);
  }

  @Post('keys')
  createKey(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.keys.create(organizationId, user.sub, dto);
  }

  @Delete('keys/:id')
  revokeKey(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.keys.revoke(organizationId, id);
  }

  @Get('webhooks/events')
  events() {
    return WEBHOOK_EVENTS;
  }

  @Get('webhooks')
  listWebhooks(@CurrentOrg() organizationId: string) {
    return this.webhooks.list(organizationId);
  }

  @Post('webhooks')
  createWebhook(
    @CurrentOrg() organizationId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.create(organizationId, dto);
  }

  @Patch('webhooks/:id')
  updateWebhook(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(organizationId, id, dto);
  }

  @Delete('webhooks/:id')
  removeWebhook(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.webhooks.remove(organizationId, id);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.webhooks.deliveries(organizationId, id);
  }

  @Post('webhooks/:id/test')
  test(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.webhooks.test(organizationId, id);
  }
}
