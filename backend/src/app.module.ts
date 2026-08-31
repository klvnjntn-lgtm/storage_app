import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';

import { LocationModule } from './location/location.module';
import { ProductModule } from './product/product.module';
import { BrandModule } from './brand/brand.module';
import { StockModule } from './stock/stock.module';
import { SessionsModule } from './sessions/sessions.module';
import { CategoryModule } from './category/category.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { OrgGuard } from './auth/guards/org.guard';
import { LicenseGuard } from './license/license.guard';
import { LicenseModule } from './license/license.module';
import { OrganizationModule } from './organization/organization.module';
import { HealthModule } from './health/health.module';
import { IntegrationModule } from './integration/integration.module';
import { InvoiceModule } from './invoice/invoice.module';
import { OrganizationModulesModule } from './organization-module/organization-modules.module';
import { CustomersModule } from './customers/customers.module';
import { TaxRateModule } from './tax-rate/tax-rate.module';
import { PaymentsModule } from './payments/payment.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { VehicleRemindersModule } from './vehicles/vehicle-reminders.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { GdbImportModule } from './gdb-import/gdb-import.module';
import { SalesQuotationModule } from './sales-quotation/sales-quotation.module';
import { SalesOrderModule } from './sales-order/sales-order.module';
import { DeliveryOrderModule } from './delivery-order/delivery-order.module';
import { PurchaseOrderModule } from './purchase-order/purchase-order.module';
import { SupplierModule } from './supplier/supplier.module';

@Module({
  imports: [
    PrismaModule,
    WarehouseModule,
    AuthModule,
    CategoryModule,
    LocationModule,
    ProductModule,
    SupplierModule,
    StockModule,
    BrandModule,
    PaymentsModule,
    SalesQuotationModule,
    SalesOrderModule,
    DeliveryOrderModule,
    PurchaseOrderModule,
    GdbImportModule,
    SessionsModule,
    LicenseModule,
    OrganizationModule,
    HealthModule,
    InvoiceModule,
    VehiclesModule,
    CustomersModule,
    VehicleRemindersModule,
    TaxRateModule,
    OrganizationModulesModule,
    IntegrationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // 1. resolves the user from JWT
    },
    {
      provide: APP_GUARD,
      useClass: OrgGuard, // 2. confirms the org in the token still exists
    },
    {
      provide: APP_GUARD,
      useClass: LicenseGuard, // 3. confirms the license is valid
    },
  ],
})
export class AppModule {}