import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';

import { LocationModule } from './location/location.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { ProductModule } from './product/product.module';
import { BrandModule } from './brand/brand.module';
import { StockModule } from './stock/stock.module';
import { SessionsModule } from './sessions/sessions.module';
import { CategoryModule } from './category/category.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { LicenseGuard } from './license/license.guard';
import { LicenseModule } from './license/license.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CategoryModule,
    LocationModule,
    WarehouseModule,
    ProductModule,
    StockModule,
    BrandModule,
    SessionsModule,
    LicenseModule, // 👈 was missing
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // runs first — resolves the user
    },
    {
      provide: APP_GUARD,
      useClass: LicenseGuard, // runs second — checks license status
    },
  ],
})
export class AppModule {}