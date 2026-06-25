import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';

import { LocationModule } from './location/location.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { ProductModule } from './product/product.module';
import { BrandModule } from './brand/brand.module'; // if exists
import { StockModule } from './stock/stock.module';
import { SessionsModule } from './sessions/sessions.module';
import { CategoryModule } from './category/category.module'; // if exists
import { AuthModule } from './auth/auth.module'; // if exists
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core/constants';

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
  ],
  controllers: [AppController],
  providers: [AppService,
      {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ]
})
export class AppModule {}