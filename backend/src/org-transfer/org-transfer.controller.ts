import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { OrgTransferService } from './org-transfer.service';
import { TransferPasswordDto } from './org-transfer.dto';
import {
  requireFile,
  sendExport,
  TransferFileInterceptor,
} from './transfer-upload';

// Moving a business between WareSys installs (web ⇄ desktop). The web
// side imports through the platform console (PlatformController); this is
// the business's own export, and the desktop app's first-launch import.
@Controller('org-transfer')
export class OrgTransferController {
  constructor(private readonly transfer: OrgTransferService) {}

  // Everything the business has, so admins only.
  @Roles('ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('export')
  async export(
    @CurrentOrg() organizationId: string,
    @Body() dto: TransferPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendExport(
      res,
      await this.transfer.export(organizationId, dto.password),
    );
  }

  // Desktop app only, and only before its one business exists: instead of
  // registering, bring the business in from an export. The users come with
  // it and sign in with their existing passwords.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('import')
  @UseInterceptors(TransferFileInterceptor)
  async import(
    @UploadedFile() upload: Express.Multer.File | undefined,
    @Body() dto: TransferPasswordDto,
  ) {
    const file = requireFile(upload);
    try {
      if (process.env.SINGLE_ORGANIZATION !== 'true') {
        throw new ForbiddenException(
          'Importing a business is done from the platform console',
        );
      }
      return await this.transfer.import(file.path, dto.password);
    } finally {
      await fs.rm(file.path, { force: true });
    }
  }
}
