import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JournalEntryStatus, JournalSourceType, ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from './journal.service';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingReportsService, AgingBucket } from './accounting-reports.service';
import { CashFlowService } from './cash-flow.service';
import { endOfBusinessDay, parseDateOnly, todayBusinessDate, toBusinessDate } from './business-date';
import { CreateAccountDto, CreateManualJournalEntryDto, UpdateAccountDto } from './dto/accounting.dto';

const AGING_BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+'];

// Query strings arrive as strings; anything non-numeric is rejected rather
// than silently treated as "no value".
function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException(`${name} must be a positive integer`);
  }
  return n;
}

function parseBucket(value: string | undefined): AgingBucket | undefined {
  if (value === undefined || value === '') return undefined;
  if (!AGING_BUCKETS.includes(value as AgingBucket)) {
    throw new BadRequestException(`bucket must be one of: ${AGING_BUCKETS.join(', ')}`);
  }
  return value as AgingBucket;
}

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!allowed.includes(value as T)) {
    throw new BadRequestException(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

// Manual entry dates may arrive as YYYY-MM-DD or a full ISO timestamp.
function parseEntryDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDateOnly(value, 'date');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('date is not a valid date');
  return d;
}

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('accounting')
export class AccountingController {
  constructor(
    private prisma: PrismaService,
    private journal: JournalService,
    private seedService: ChartOfAccountsSeedService,
    private accountsService: ChartOfAccountsService,
    private reports: AccountingReportsService,
    private cashFlow: CashFlowService,
  ) {}

  // Writes that change the books' structure or history are admin-only.
  // Reads are left at module-level access, as before.
  private assertAdmin(req: any) {
    if (req?.user?.role !== 'ADMIN') {
      throw new ForbiddenException('Only an administrator can perform this action');
    }
  }

  // --- Chart of Accounts ---

  @Post('accounts/seed-defaults')
  seedDefaults(@CurrentOrg() organizationId: string, @Req() req) {
    this.assertAdmin(req);
    return this.seedService.seedDefaults(organizationId);
  }

  @Get('accounts')
  listAccounts(@CurrentOrg() organizationId: string) {
    return this.accountsService.list(organizationId);
  }

  @Post('accounts')
  createAccount(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateAccountDto) {
    this.assertAdmin(req);
    return this.accountsService.create(organizationId, dto);
  }

  @Patch('accounts/:id')
  updateAccount(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    this.assertAdmin(req);
    return this.accountsService.update(organizationId, id, dto);
  }

  // --- Journal ---

  // Paginated. Query: status, sourceType, from, to (YYYY-MM-DD), search,
  // page, pageSize (max 100).
  @Get('journal')
  listEntries(
    @CurrentOrg() organizationId: string,
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const fromDate = from ? parseDateOnly(from, 'from') : undefined;
    const toDate = to ? parseDateOnly(to, 'to') : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('"from" must be on or before "to"');
    }

    return this.journal.listEntries(organizationId, {
      status: parseEnum(status, Object.values(JournalEntryStatus), 'status'),
      sourceType: parseEnum(sourceType, Object.values(JournalSourceType), 'sourceType'),
      from: fromDate,
      to: toDate,
      search,
      page: parsePositiveInt(page, 'page'),
      pageSize: parsePositiveInt(pageSize, 'pageSize'),
    });
  }

  @Get('journal/:id')
  getEntry(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.journal.getEntry(organizationId, id); // 404s if missing
  }

  @Post('journal/manual')
  async postManual(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateManualJournalEntryDto) {
    this.assertAdmin(req);

    const date = parseEntryDate(dto.date);
    await this.assertManualLinesBelongToOrg(organizationId, dto.lines as { accountId: string; locationId?: string }[]);

    return this.journal.postEntry(organizationId, {
      date,
      memo: dto.memo,
      sourceType: JournalSourceType.MANUAL,
      userId: req.user.sub,
      lines: dto.lines,
    });
  }

  // Only MANUAL entries can be voided here. An entry posted by a document
  // (invoice, payment, expense, ...) must be voided through that document,
  // otherwise the document stays live with nothing in the ledger.
  @Post('journal/:id/void')
  async voidEntry(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
    @Body('reason') reason?: string,
  ) {
    this.assertAdmin(req);

    const entry = await this.journal.getEntry(organizationId, id);
    if (entry.sourceType !== JournalSourceType.MANUAL) {
      throw new BadRequestException(
        `This entry was posted by a ${entry.sourceType} document. Void the source document instead; ` +
          `voiding the entry here would leave the document and the ledger out of sync.`,
      );
    }
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to void a journal entry');
    }

    return this.journal.voidEntry(organizationId, id, req.user.sub, reason.trim());
  }

  // --- Reports ---

  // Query: asOf (YYYY-MM-DD, default today in the business timezone),
  // page, pageSize (max 200), bucket, customerId. Summary totals always
  // cover all open invoices; only `lines` is paged/filtered.
  @Get('reports/ar-aging')
  getARAging(
    @CurrentOrg() organizationId: string,
    @Query('asOf') asOf?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('bucket') bucket?: string,
    @Query('customerId') customerId?: string,
  ) {
    // Aging compares timestamps (issuedAt), so use the true end of the business day.
    const asOfDate = endOfBusinessDay(asOf ? parseDateOnly(asOf, 'asOf') : todayBusinessDate());
    return this.reports.getARAging(organizationId, asOfDate, {
      page: parsePositiveInt(page, 'page'),
      pageSize: parsePositiveInt(pageSize, 'pageSize'),
      bucket: parseBucket(bucket),
      customerId: customerId || undefined,
    });
  }

  @Get('reports/ap-aging')
  getAPAging(
    @CurrentOrg() organizationId: string,
    @Query('asOf') asOf?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('bucket') bucket?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    const asOfDate = endOfBusinessDay(asOf ? parseDateOnly(asOf, 'asOf') : todayBusinessDate());
    return this.reports.getAPAging(organizationId, asOfDate, {
      page: parsePositiveInt(page, 'page'),
      pageSize: parsePositiveInt(pageSize, 'pageSize'),
      bucket: parseBucket(bucket),
      supplierId: supplierId || undefined,
    });
  }

  // Query: accountId, from, to (YYYY-MM-DD), page, pageSize (max 500).
  @Get('reports/account-ledger')
  getAccountLedger(
    @CurrentOrg() organizationId: string,
    @Query('accountId', ParseUUIDPipe) accountId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('from and to query params are required (YYYY-MM-DD)');
    }
    const fromDate = parseDateOnly(from, 'from');
    const toDate = parseDateOnly(to, 'to');
    if (fromDate > toDate) throw new BadRequestException('"from" must be on or before "to"');

    // entryDate is a date-only column, so date-only bounds are inclusive of the whole day.
    return this.reports.getAccountLedger(organizationId, accountId, fromDate, toDate, {
      page: parsePositiveInt(page, 'page'),
      pageSize: parsePositiveInt(pageSize, 'pageSize'),
    });
  }

  @Get('reports/trial-balance')
  getTrialBalance(
    @CurrentOrg() organizationId: string,
    @Query('asOf') asOf?: string,
    @Query('locationId') locationId?: string,
  ) {
    const asOfDate = asOf ? parseDateOnly(asOf, 'asOf') : todayBusinessDate();
    return this.reports.getTrialBalance(organizationId, asOfDate, locationId); // 400s if locationId is set
  }

  @Get('reports/balance-sheet')
  getBalanceSheet(
    @CurrentOrg() organizationId: string,
    @Query('asOf') asOf?: string,
    @Query('locationId') locationId?: string,
  ) {
    const asOfDate = asOf ? parseDateOnly(asOf, 'asOf') : todayBusinessDate();
    return this.reports.getBalanceSheet(organizationId, asOfDate, locationId); // 400s if locationId is set
  }

  @Get('reports/profit-loss')
  getProfitAndLoss(
    @CurrentOrg() organizationId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('locationId') locationId?: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('from and to query params are required (YYYY-MM-DD)');
    }
    const fromDate = parseDateOnly(from, 'from');
    const toDate = parseDateOnly(to, 'to');
    if (fromDate > toDate) throw new BadRequestException('"from" must be on or before "to"');

    return this.reports.getProfitAndLoss(organizationId, fromDate, toDate, locationId);
  }

  @Get('reports/cash-flow')
  getCashFlow(
    @CurrentOrg() organizationId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('from and to query params are required (YYYY-MM-DD)');
    }
    return this.cashFlow.getCashFlow(organizationId, parseDateOnly(from, 'from'), parseDateOnly(to, 'to'));
  }

  // --- Fiscal periods ---

  @Get('fiscal-periods')
  listPeriods(@CurrentOrg() organizationId: string) {
    return this.prisma.fiscalPeriod.findMany({
      where: { organizationId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  @Post('fiscal-periods/:year/:month/close')
  closePeriod(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    this.assertAdmin(req);
    const { y, m } = this.parseYearMonth(year, month);
    return this.journal.closePeriod(organizationId, y, m);
  }

  @Post('fiscal-periods/:year/:month/reopen')
  reopenPeriod(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    this.assertAdmin(req);
    const { y, m } = this.parseYearMonth(year, month);
    return this.journal.reopenPeriod(organizationId, y, m);
  }

  // --- helpers ---

  private parseYearMonth(year: string, month: string) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('year is not valid');
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new BadRequestException('month must be 1-12');
    return { y, m };
  }

  // postEntry() doesn't verify that account/location ids belong to the
  // organization, so anything user-supplied has to be checked here.
  private async assertManualLinesBelongToOrg(
    organizationId: string,
    lines: { accountId: string; locationId?: string }[],
  ) {
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.chartOfAccount.count({
      where: { id: { in: accountIds }, organizationId, isActive: true },
    });
    if (accounts !== accountIds.length) {
      throw new BadRequestException(
        'One or more accounts are invalid, inactive, or do not belong to this organization',
      );
    }

    const locationIds = [...new Set(lines.map((l) => l.locationId).filter((x): x is string => !!x))];
    if (locationIds.length > 0) {
      const locations = await this.prisma.location.count({
        where: { id: { in: locationIds }, organizationId },
      });
      if (locations !== locationIds.length) {
        throw new BadRequestException('One or more locations do not belong to this organization');
      }
    }
  }
}