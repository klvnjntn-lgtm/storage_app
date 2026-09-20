import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { SalaryComponentKind } from '@prisma/client';

export class CreateSalaryComponentTypeDto {
  @IsString()
  name: string;

  @IsEnum(SalaryComponentKind)
  type: SalaryComponentKind;

  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  // true = defaultAmount is a flat amount; false = defaultPercentage of baseSalary
  @IsBoolean()
  isFixed: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPercentage?: number;

  // Which GL liability account this DEDUCTION posts to (e.g. a specific
  // "BPJS Payable" or "PPh21 Payable" account). Omit to fall back to the
  // generic PAYROLL_DEDUCTIONS_PAYABLE system account — see
  // PostingRulesService.postPayrollRun(). Meaningless for ALLOWANCE
  // components (allowances just add to gross pay / Salary Expense, they
  // don't create a separate liability line), so the service ignores it
  // there rather than rejecting it outright.
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class UpdateSalaryComponentTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @IsOptional()
  @IsBoolean()
  isFixed?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPercentage?: number;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

class EmployeeComponentAssignment {
  @IsUUID()
  componentId: string;

  // Overrides for this employee; falls back to the component type's default
  // if omitted. At least one of amount/percentage should resolve at
  // compute-time — enforced in the service, not here.
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  percentage?: number;
}

// Full replace of an employee's component set (simpler than PATCH semantics
// for a list that's usually edited as a whole — e.g. "here's their new
// allowance/deduction package").
export class SetEmployeeComponentsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => EmployeeComponentAssignment)
  components: EmployeeComponentAssignment[];
}