import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import {
  CurrentUser,
  type JwtPayload,
} from '../auth/decorators/current-user.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import {
  PushSubscriptionDto,
  UnsubscribeDto,
} from './dto/push-subscription.dto';

// Deliberately no ModuleGuard/@RequireModule here — notifications span every
// module (delivery, workshop reminders, account/device alerts), not just one
// paid feature.
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  @Post('push/subscribe')
  subscribe(@CurrentUser() user: JwtPayload, @Body() dto: PushSubscriptionDto) {
    return this.pushService.subscribe(
      user.sub,
      dto.endpoint,
      dto.p256dh,
      dto.auth,
    );
  }

  @Delete('push/subscribe')
  unsubscribe(@CurrentUser() user: JwtPayload, @Body() dto: UnsubscribeDto) {
    return this.pushService.unsubscribe(user.sub, dto.endpoint);
  }

  // 'unread-count' must stay declared above ':id' style routes if any are
  // ever added — same static-segment-before-param convention used in
  // delivery-routes.controller.ts.
  @Get('unread-count')
  unreadCount(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.unreadCount(organizationId, user.sub);
  }

  @Get()
  listMine(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.listMine(organizationId, user.sub, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Patch('read-all')
  markAllRead(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.markAllRead(organizationId, user.sub);
  }

  @Patch(':id/read')
  markRead(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markRead(organizationId, user.sub, id);
  }
}
