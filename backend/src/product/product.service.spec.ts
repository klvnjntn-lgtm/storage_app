import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanLimitsModule } from '../billing/plan-limits.module';
import { AccountingModule } from '../accounting/accounting.module';

describe('ProductService', () => {
  let service: ProductService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, PlanLimitsModule, AccountingModule],
      providers: [ProductService],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
