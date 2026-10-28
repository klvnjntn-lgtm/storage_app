import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BranchRecordGuard } from './auth/guards/branch-record.guard';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';

import { LocationModule } from './location/location.module';
import { BranchesModule } from './branches/branches.module';
import { ProductModule } from './product/product.module';
import { BrandModule } from './brand/brand.module';
import { StockModule } from './stock/stock.module';
import { SessionsModule } from './sessions/sessions.module';
import { CategoryModule } from './category/category.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { OrgGuard } from './auth/guards/org.guard';
import { DriverScopeGuard } from './auth/guards/driver-scope.guard';
// Global since @Roles/@RequireModule were silently ignored on any controller
// that forgot @UseGuards(RolesGuard/ModuleGuard). Explicit per-controller
// @UseGuards of either is now redundant but harmless.
import { RolesGuard } from './auth/guards/roles.guard';
import { ModuleGuard } from './auth/guards/module.guard';
import { RedactCostInterceptor } from './common/interceptors/redact-cost.interceptor';
import { DecimalQuantityInterceptor } from './common/interceptors/decimal-quantity.interceptor';
import { LicenseGuard } from './license/license.guard';
import { LicenseModule } from './license/license.module';
import { OrganizationModule } from './organization/organization.module';
import { HealthModule } from './health/health.module';
import { IntegrationModule } from './integration/integration.module';
import { GoodsReceiptModule } from './goods-receipt/goods-receipt.module';
import { MediaModule } from './media/media.module';
import { InvoiceModule } from './invoice/invoice.module';
import { OrganizationModulesModule } from './organization-module/organization-modules.module';
import { CustomersModule } from './customers/customers.module';
import { TaxRateModule } from './tax-rate/tax-rate.module';
import { PriceLevelModule } from './price-level/price-level.module';
import { PaymentsModule } from './payments/payment.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { WorkOrdersModule } from './work-orders/work-orders.module';
import { PerformanceModule } from './performance/performance.module';
import { TaxExportModule } from './tax-export/tax-export.module';
import { PartCatalogModule } from './part-catalog/part-catalog.module';
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
import { PlatformModule } from './platform/platform.module';
import { OrgTransferModule } from './org-transfer/org-transfer.module';
import { PlanLimitsModule } from './billing/plan-limits.module';
import { BillingModule } from './billing/billing.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PurchaseReturnModule } from './purchase-return/purchase-return.module';
import { SupplierBillModule } from './supplier-bill/supplier-bill.module';
import { StockTransferModule } from './stock-transfer/stock-transfer.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { ReorderModule } from './reorder/reorder.module';
import { BatchesModule } from './batches/batches.module';
import { MessagingModule } from './messaging/messaging.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ApiAccessModule } from './api-access/api-access.module';
import { SerialsModule } from './serials/serials.module';
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
    // Error tracking; inert unless SENTRY_DSN is set (see instrument.ts).
    SentryModule.forRoot(),
    PrismaModule,
    StorageModule,
    WarehouseModule,
    AuthModule,
    CategoryModule,
    LocationModule,
    BranchesModule,
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
    WorkOrdersModule,
    PerformanceModule,
    TaxExportModule,
    PartCatalogModule,
    CustomersModule,
    VehicleRemindersModule,
    TaxRateModule,
    PriceLevelModule,
    OrganizationModulesModule,
    IntegrationModule,
    GoodsReceiptModule,
    MediaModule,
    NotificationsModule,
    UsersModule,
    DevicesModule,
    AccessControlModule,
    PlatformModule,
    OrgTransferModule,
    PlanLimitsModule,
    BillingModule,
    OnboardingModule,
    PurchaseReturnModule,
    SupplierBillModule,
    StockTransferModule,
    ApprovalsModule,
    ReorderModule,
    BatchesModule,
    MessagingModule,
    DashboardModule,
    ApiAccessModule,
    SerialsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      // Reports unexpected errors (not 4xx HttpExceptions) to Sentry, then
      // responds exactly as Nest's default filter would.
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
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
      useClass: DriverScopeGuard, // 2b. DRIVER may only reach @Roles(..., 'DRIVER') routes
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard, // 2c. enforces @Roles wherever it appears
    },
    {
      provide: APP_GUARD,
      useClass: ModuleGuard, // 2d. enforces @RequireModule wherever it appears
    },
    {
      provide: APP_GUARD,
      useClass: BranchRecordGuard, // 2e. hides other branches' records from branch members
    },
    {
      provide: APP_GUARD,
      useClass: LicenseGuard, // 3. confirms the license is valid
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RedactCostInterceptor, // cost data is admin-only in every response
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DecimalQuantityInterceptor, // quantities go out as numbers, not Decimal strings
    },
  ],
})
export class AppModule {}
