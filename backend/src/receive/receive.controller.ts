// src/receive/receive.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ReceiveService } from './receive.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModuleKey } from '@prisma/client';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ReceiveItemDto } from './dto/receive-item.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.WAREHOUSE_OPS)
@Controller('receive')
export class ReceiveController {
  constructor(private readonly receiveService: ReceiveService) {}

  @Post()
  receive(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: ReceiveItemDto,
  ) {
    return this.receiveService.receive(
      organizationId,
      body.productId,
      body.qty,
      body.locationId,
      body.sessionId,
      user.sub,
    );
  }
}