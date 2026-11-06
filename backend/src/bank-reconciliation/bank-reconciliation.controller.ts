import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BankReconciliationService } from './bank-reconciliation.service';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

class StatementLineDto {
  @Matches(DATE_ONLY)
  date: string;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  balance?: number | null;

  @IsInt()
  @Min(0)
  seq: number;
}

class ImportDto {
  @IsString()
  bankAccountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;

  // The page sends long statements in batches.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines: StatementLineDto[];
}

class PeriodDto {
  @IsString()
  bankAccountId: string;

  @Matches(DATE_ONLY)
  from: string;

  @Matches(DATE_ONLY)
  to: string;
}

class MatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  journalEntryLineIds: string[];
}

class IgnoreDto {
  @IsBoolean()
  ignored: boolean;
}

class RecordDto {
  @IsString()
  accountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  memo?: string;
}

// Works across branches on the books, so MASTER only.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@Roles('MASTER')
@RequireModule(ModuleKey.ACCOUNTING)
@Controller('bank-reconciliation')
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  @Get()
  report(
    @CurrentOrg() organizationId: string,
    @Query('bankAccountId') bankAccountId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.report(organizationId, bankAccountId, from, to);
  }

  @Post('import')
  importLines(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: ImportDto) {
    return this.service.importLines(organizationId, dto.bankAccountId, dto.fileName, dto.lines, req.user.sub);
  }

  @Post('auto-match')
  autoMatch(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: PeriodDto) {
    return this.service.autoMatch(organizationId, dto.bankAccountId, dto.from, dto.to, req.user.sub);
  }

  @Post('clear')
  clear(@CurrentOrg() organizationId: string, @Body() dto: PeriodDto) {
    return this.service.clearOpen(organizationId, dto.bankAccountId, dto.from, dto.to);
  }

  @Post('lines/:id/match')
  match(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: MatchDto) {
    return this.service.match(organizationId, id, dto.journalEntryLineIds, req.user.sub);
  }

  @Post('lines/:id/unmatch')
  unmatch(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.service.unmatch(organizationId, id);
  }

  @Post('lines/:id/ignore')
  ignore(@CurrentOrg() organizationId: string, @Param('id') id: string, @Body() dto: IgnoreDto) {
    return this.service.setIgnored(organizationId, id, dto.ignored);
  }

  @Post('lines/:id/record')
  record(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: RecordDto) {
    return this.service.record(organizationId, id, dto.accountId, dto.memo, req.user.sub);
  }
}
