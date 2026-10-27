import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';
import { WorkOrdersService } from './work-orders.service';
import { RespondToEstimateDto } from './dto/work-order.dto';

// The customer's estimate approval page (/estimate/<token>) — no login: the
// unguessable token, which staff send by hand, is the only credential. It
// only reads one estimate and answers it, and is rate-limited.
@Public()
@SkipLicenseCheck()
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('public/estimates')
export class PublicEstimateController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.workOrders.publicEstimate(token);
  }

  @Post(':token/approve')
  approve(@Param('token') token: string, @Body() dto: RespondToEstimateDto) {
    return this.workOrders.respondToEstimate(token, true, dto);
  }

  @Post(':token/decline')
  decline(@Param('token') token: string, @Body() dto: RespondToEstimateDto) {
    return this.workOrders.respondToEstimate(token, false, dto);
  }
}
