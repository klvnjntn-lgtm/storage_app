import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ModuleKey, SerialStatus } from '@prisma/client';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { SerialsService } from './serials.service';
import {
  CorrectSerialDto,
  RegisterSerialsDto,
  TrackSerialsDto,
} from './dto/serials.dto';

@RequireModule(ModuleKey.WAREHOUSE_OPS, ModuleKey.INVOICE_POS)
@Controller('serials')
export class SerialsController {
  constructor(private serials: SerialsService) {}

  @Get()
  search(
    @CurrentOrg() organizationId: string,
    @Query('q') q?: string,
    @Query('productId') productId?: string,
    @Query('status', new ParseEnumPipe(SerialStatus, { optional: true }))
    status?: SerialStatus,
  ) {
    return this.serials.search(organizationId, { q, productId, status });
  }

  @Get('available')
  available(
    @CurrentOrg() organizationId: string,
    @Query('productId') productId: string,
    @Query('locationId') locationId: string,
  ) {
    return this.serials.available(organizationId, productId, locationId);
  }

  @Get(':id')
  history(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.serials.history(organizationId, id);
  }

  @Roles('ADMIN')
  @Post()
  register(
    @CurrentOrg() organizationId: string,
    @Body() dto: RegisterSerialsDto,
  ) {
    return this.serials.register(
      organizationId,
      dto.productId,
      dto.locationId,
      dto.serialNumbers,
    );
  }

  @Roles('ADMIN')
  @Patch(':id')
  correct(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: CorrectSerialDto,
  ) {
    return this.serials.correct(organizationId, id, dto);
  }

  @Roles('ADMIN')
  @Patch('products/:productId')
  setTracking(
    @CurrentOrg() organizationId: string,
    @Param('productId') productId: string,
    @Body() dto: TrackSerialsDto,
  ) {
    return this.serials.setTracking(
      organizationId,
      productId,
      dto.trackSerials,
    );
  }
}
