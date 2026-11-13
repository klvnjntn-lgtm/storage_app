// src/routing/maps-link.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { resolveMapsLink } from './maps-link';

export class ResolveMapsLinkQuery {
  @IsString()
  @MaxLength(2000)
  url!: string;
}

// Wherever a pin is typed in (customer, saved address, stop, start point).
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('maps')
export class MapsLinkController {
  @Get('resolve-link')
  resolve(@Query() query: ResolveMapsLinkQuery) {
    return resolveMapsLink(query.url);
  }
}
