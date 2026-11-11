import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';
import { DeliveryRoutesService } from './delivery-routes.service';

// A route stop's public page (/stop/<token>), copied from the route page and
// pasted into WhatsApp: where to go, the customer's directions and landmark
// photos. No login — the signed, expiring token (StopShareTokenService) is
// the only credential. Read-only, never proof-of-delivery photos or the
// customer's phone number, and rate-limited.
@Public()
@SkipLicenseCheck()
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('public/stops')
export class PublicStopController {
  constructor(private readonly routes: DeliveryRoutesService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.routes.publicStopView(token);
  }
}
