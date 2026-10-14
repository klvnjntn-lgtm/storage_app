// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LicenseModule } from '../license/license.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy, getJwtSecret } from './jwt.strategy';
import { MailerModule } from './mailer/mailer.module';
import { DevicesService } from './devices.service';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { BillingModule } from '../billing/billing.module';
import { PlanLimitsModule } from '../billing/plan-limits.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    MailerModule,
    NotificationsModule,
    LicenseModule,
    BillingModule,
    PlanLimitsModule,
    // FIX — was `process.env.JWT_SECRET ?? 'dev-secret-change-me'`, a
    // hardcoded, publicly-known fallback that let any client forge a
    // valid JWT for any user if JWT_SECRET was ever unset. Reuses
    // jwt.strategy.ts's fail-fast getJwtSecret() instead of leaving a
    // second, differently-guarded copy of the same secret lookup.
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController, TwoFactorController],
  providers: [AuthService, JwtStrategy, DevicesService, TwoFactorService],
  // DevicesService is exported so DevicesModule's admin-facing controller
  // can reuse this exact instance (see devices/devices.module.ts) rather
  // than duplicating device-approval logic in a second module.
  exports: [JwtModule, PassportModule, DevicesService],
})
export class AuthModule {}
