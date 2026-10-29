import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';
import { SalesQuotationService } from './sales-quotation.service';
import { RespondToQuotationDto } from './dto/sales-quotation.dto';

// The customer's approval page (/estimate/<token>) for a workshop quotation — no login: the unguessable
// token, which staff send by hand, is the only credential. It only reads one quotation and answers it,
// and is rate-limited. The path stays /public/estimates so links sent before quotations replaced work
// order estimates keep working (their tokens moved to the quotations).
@Public()
@SkipLicenseCheck()
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('public/estimates')
export class PublicQuotationController {
  constructor(private readonly quotations: SalesQuotationService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.quotations.publicView(token);
  }

  @Post(':token/approve')
  approve(@Param('token') token: string, @Body() dto: RespondToQuotationDto) {
    return this.quotations.respond(token, true, dto);
  }

  @Post(':token/decline')
  decline(@Param('token') token: string, @Body() dto: RespondToQuotationDto) {
    return this.quotations.respond(token, false, dto);
  }
}
