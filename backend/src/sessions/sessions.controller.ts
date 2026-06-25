import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { EventType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from 'src/auth/guards/org.guard';
import { CurrentOrg } from 'src/auth/decorators/org.decorator';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  create(@CurrentOrg() orgId: string, @Body() body: { type: EventType }) {
    return this.sessionsService.create(orgId, body.type);
  }

  @Get()
  findAll(@CurrentOrg() orgId: string) {
    return this.sessionsService.findAll(orgId);
  }

  @Get(':id')
  findOne(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.sessionsService.findOne(orgId, id);
  }

  @Post(':id/complete')
  complete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.sessionsService.complete(orgId, id);
  }

  @Post(':id/items')
  addItem(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body()
    body: {
      productId: string;
      qty: number;
      fromLocationId?: string;
      toLocationId?: string;
    },
  ) {
    return this.sessionsService.addItem(
      orgId,
      id,
      body.productId,
      body.qty,
      body.fromLocationId,
      body.toLocationId,
    );
  }
}