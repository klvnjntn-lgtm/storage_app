import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { BatchesService } from './batches.service';
import { CreateBatchDto, TrackBatchesDto } from './dto/batches.dto';

@RequireModule(ModuleKey.WAREHOUSE_OPS, ModuleKey.INVOICE_POS)
@Controller('batches')
export class BatchesController {
  constructor(private batches: BatchesService) {}

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('productId') productId?: string,
    @Query('expiringWithinDays', new ParseIntPipe({ optional: true }))
    expiringWithinDays?: number,
  ) {
    return this.batches.list(organizationId, { productId, expiringWithinDays });
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateBatchDto) {
    return this.batches.create(organizationId, dto);
  }

  @Roles('ADMIN')
  @Patch('products/:productId')
  setTracking(
    @CurrentOrg() organizationId: string,
    @Param('productId') productId: string,
    @Body() dto: TrackBatchesDto,
  ) {
    return this.batches.setTracking(
      organizationId,
      productId,
      dto.trackBatches,
    );
  }
}
