// src/sessions/sessions.controller.ts
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import type { SummarySortKey } from './sessions.service';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { AddSessionItemDto } from './dto/add-session-item.dto';
import { CreateSessionDto } from './dto/create-session.dto';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post()
  create(@CurrentOrg() organizationId: string, @Body() body: CreateSessionDto) {
    return this.sessionsService.create(organizationId, body.type, undefined, undefined, {
      importBatchId: body.importBatchId,
      returnInvoiceId: body.returnInvoiceId,
    });
  }

  // Read-only, ungated — same reasoning as ProductController: session
  // listing is core infrastructure visible regardless of module status.
  @Get()
  findAll(
    @CurrentOrg() organizationId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.sessionsService.findAll(organizationId, {
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

@Get('summary')
summary(
  @CurrentOrg() organizationId: string,
  @CurrentUser() user: JwtPayload,
  @Query('page') page?: string,
  @Query('pageSize') pageSize?: string,
  @Query('search') search?: string,
  @Query('location') locationId?: string,
  @Query('oversold') oversold?: string,
  @Query('sort') sort?: string,
  @Query('dir') dir?: string,
) {
  return this.sessionsService.summary(organizationId, user, {
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    search,
    locationId: locationId || undefined,
    oversold: oversold === '1' || oversold === 'true',
    sort: sort as SummarySortKey | undefined,
    dir: dir === 'desc' ? 'desc' : 'asc',
  });
}

  @Get(':id')
  findOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.sessionsService.findOne(organizationId, id);
  }

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

  @UseGuards(ModuleGuard, RolesGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Roles('ADMIN')
  @Post(':id/cancel')
  cancel(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.sessionsService.cancel(organizationId, id, body?.reason, user.sub);
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