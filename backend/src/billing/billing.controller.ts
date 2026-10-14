import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { AllowSuspendedOrg } from '../auth/decorators/allow-suspended-org.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';
import { BillingService } from './billing.service';
import { SubscriptionCheckoutDto } from './dto/billing.dto';

// Plan, usage and paying for a subscription. Admin-only: it shows what the
// business pays and lets them spend money. Reachable while suspended so an
// org cut off for non-payment can still pay its way back.
@Roles('ADMIN')
@AllowSuspendedOrg()
@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  // Just enough for the trial/lapsed banner every member sees.
  @Roles('ADMIN', 'USER')
  @Get('status')
  status(@CurrentOrg() organizationId: string) {
    return this.billing.getStatus(organizationId);
  }

  @Get()
  overview(@CurrentOrg() organizationId: string) {
    return this.billing.getOverview(organizationId);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('checkout')
  checkout(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubscriptionCheckoutDto,
  ) {
    return this.billing.createSubscriptionCheckout(
      organizationId,
      user.sub,
      dto.modules,
      dto.period,
    );
  }

  @Get('payments/:externalId')
  payment(
    @CurrentOrg() organizationId: string,
    @Param('externalId') externalId: string,
  ) {
    return this.billing.getPayment(organizationId, externalId);
  }

  // Completes a payment made with the fake (dev) gateway — refused for
  // anything else and in production.
  @Post('payments/:externalId/fake-pay')
  fakePay(
    @CurrentOrg() organizationId: string,
    @Param('externalId') externalId: string,
  ) {
    return this.billing.fakePay(organizationId, externalId);
  }
}

// Xendit calls this when an invoice is paid or expires. Authenticated by
// the x-callback-token header, not a session.
@Public()
@SkipLicenseCheck()
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private billing: BillingService) {}

  @HttpCode(200)
  @Post('xendit')
  xendit(
    @Headers('x-callback-token') token: string | undefined,
    @Body() body: { external_id?: string },
  ) {
    return this.billing.handleXenditWebhook(token, body);
  }
}
