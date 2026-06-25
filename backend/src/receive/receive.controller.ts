import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ReceiveService } from './receive.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from 'src/auth/guards/org.guard';
import { CurrentOrg } from 'src/auth/decorators/org.decorator';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('receive')
export class ReceiveController {
  constructor(private readonly receiveService: ReceiveService) {}

  @Post()
  receive(
    @CurrentOrg() orgId: string,
    @Body()
    body: {
      productId: string;
      qty: number;
      locationId?: string;
    },
  ) {
    return this.receiveService.receive(orgId, body.productId, body.qty, body.locationId);
  }
}