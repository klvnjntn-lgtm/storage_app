// src/customers/customer-location.controller.ts
import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ModuleKey } from '@prisma/client';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { MAX_PHOTO_UPLOAD_BYTES } from '../storage/private-photo';
import { CustomerLocationService } from './customer-location.service';

// Office staff manage location photos; drivers see them on their route
// stops (DeliveryRoutesService), never through here.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@Roles('ADMIN', 'USER')
@RequireModule(ModuleKey.DELIVERY_DMS)
@Controller('customers/:id/location-photos')
export class CustomerLocationController {
  constructor(private readonly locations: CustomerLocationService) {}

  @Get()
  list(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.locations.list(organizationId, id);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_UPLOAD_BYTES },
    }),
  )
  upload(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.locations.upload(organizationId, id, file);
  }

  @Delete(':photoId')
  remove(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.locations.remove(organizationId, id, photoId);
  }
}
