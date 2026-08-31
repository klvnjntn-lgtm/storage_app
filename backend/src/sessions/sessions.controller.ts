// src/sessions/sessions.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionType, ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { AddSessionItemDto } from './dto/add-session-item.dto';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post()
  create(@CurrentOrg() organizationId: string, @Body() body: { type: SessionType }) {
    return this.sessionsService.create(organizationId, body.type);
  }

  // Read-only, ungated — same reasoning as ProductController: session
  // listing is core infrastructure visible regardless of module status.
  @Get()
  findAll(@CurrentOrg() organizationId: string) {
    return this.sessionsService.findAll(organizationId);
  }

@Get('summary')
summary(
  @CurrentOrg() organizationId: string,
  @CurrentUser() user: JwtPayload,
) {
  return this.sessionsService.summary(organizationId, user);
}

  @Get(':id')
  findOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.sessionsService.findOne(organizationId, id);
  }

  // TODO: confirm whether addNote should stay ungated. Every other
  // write on this controller requires WAREHOUSE_OPS; this is currently
  // the one exception and the original rationale for that wasn't
  // available when this file was last edited.
// src/sessions/sessions.controller.ts — only this route changes
@UseGuards(ModuleGuard)
@RequireModule(ModuleKey.WAREHOUSE_OPS)
@Post(':id/notes')
addNote(
  @Param('id') id: string,
  @Body('note') note: string,
  @CurrentOrg() organizationId: string,
  @CurrentUser() user: JwtPayload,
) {
  return this.sessionsService.addNote(organizationId, id, note, user.sub);
}

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post(':id/advance')
  advanceStage(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.sessionsService.advanceStage(organizationId, id);
  }

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post(':id/back')
  regressStage(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.sessionsService.regressStage(organizationId, id);
  }

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post(':id/complete')
  complete(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.sessionsService.complete(organizationId, id);
  }

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post(':id/reopen')
  reopen(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.sessionsService.reopen(organizationId, id, body.reason, user.sub);
  }

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post(':id/items')
  addItem(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() body: AddSessionItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.addItem(
      organizationId, id, body.productId, body.qty,
      body.fromLocationId, body.toLocationId, body.reason, user.sub,
    );
  }
}