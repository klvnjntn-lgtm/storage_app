import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { MediaModule } from './media/media.module';
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
import { DeliveryRoutesModule } from './delivery-routes/delivery-routes.module';
import { TeamsModule } from './teams/teams.module';
import { PurchaseOrderModule } from './purchase-order/purchase-order.module';
import { SupplierModule } from './supplier/supplier.module';
import { BankAccountModule } from './bank-accounts/bank-account.module';
import { SalesSearchModule } from './sales-quotation/sales-search.module';
import { AccountingModule } from './accounting/accounting.module';
import { SupplierPaymentsModule } from './accounting/supplier-payments.module';
import { ExpensesModule } from './accounting/expenses.module';
import { PayrollModule } from './accounting/payroll.module';
import { FixedAssetsModule } from './accounting/fixed-assets.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UsersModule } from './users/users.module';
import { DevicesModule } from './devices/devices.module';
import { AccessControlModule } from './access-control/access-control.module';
@Module({
  imports: [
    // FIX — @nestjs/throttler was a listed dependency and @Throttle()
    // decorators already existed on several admin/auth routes (see
    // organization-modules.controller.ts, auth.controller.ts), but
    // ThrottlerModule/ThrottlerGuard was never actually registered, so
    // those decorators were silently non-functional. This is the global
    // default (100 req/min per IP+route); tighter per-route limits via
    // @Throttle() override it.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    PrismaModule,
    WarehouseModule,
    AuthModule,
    CategoryModule,
    LocationModule,
    ProductModule,
    SupplierModule,
    StockModule,
    BrandModule,
    SalesSearchModule,
    BankAccountModule,
    PaymentsModule,
    SalesQuotationModule,
    SalesOrderModule,
    DeliveryOrderModule,
    DeliveryRoutesModule,
    TeamsModule,
    PurchaseOrderModule,
    GdbImportModule,
    AccountingModule,
    SupplierPaymentsModule,
    ExpensesModule,
    PayrollModule,
    FixedAssetsModule,
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
    MediaModule,
    NotificationsModule,
    UsersModule,
    DevicesModule,
    AccessControlModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, // 0. rate-limit before doing any auth/license work
    },
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
