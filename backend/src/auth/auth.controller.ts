// src/auth/auth.controller.ts
import { Body, Controller, Post, Get, Patch, Param, Headers, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { InviteDto } from './dto/invite.dto';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { ForbiddenException } from '@nestjs/common';
import { SetSeatLimitDto } from './dto/set-seat-limit.dto';
import { SkipLicenseCheck } from 'src/license/decorators/skip-license-check.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

@Get('me')
async me(@CurrentUser() user: any) {
  console.log('🔥 RAW USER FROM DECORATOR:', user);

  const result = await this.authService.me(user.userid);

  console.log('🔥 RESULT:', result);

  return result;
}

  @Public()
  @SkipLicenseCheck()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.organizationName, dto.email, dto.password);
  }

  @Public()
  @SkipLicenseCheck()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('invite')
  invite(@Body() dto: InviteDto, @CurrentUser() user: { organizationId: string }) {
    return this.authService.invite(user.organizationId, dto.email, dto.password, dto.role);
  }
@Public()
@SkipLicenseCheck()
@Patch('org/:orgId/seats')
setSeatLimit(
  @Param('orgId') orgId: string,
  @Body() dto: SetSeatLimitDto,
  @Headers('x-superadmin-secret') secret: string,
) {
  if (secret !== process.env.SUPERADMIN_SECRET) {
    throw new ForbiddenException();
  }
  return this.authService.setSeatLimit(orgId, dto.seatLimit);
}
}