import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntegrationService } from './integration.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

// Auth, org and role checks all come from the global guards (app.module.ts).
// Staff only — drivers are already kept out by DriverScopeGuard; stated
// here so the intent is visible. Deliberately not module-gated: the order
// upload page is shown to every org regardless of modules.
@Roles('ADMIN', 'USER')
@Controller('integrations')
export class IntegrationController {
  constructor(private readonly integrationService: IntegrationService) {}

  @Get('connections')
  listConnections(@CurrentUser() user: { organizationId: string }) {
    return this.integrationService.listConnections(user.organizationId);
  }

  // Creating integration connections is admin-only configuration.
  @Roles('ADMIN')
  @Post('connections')
  createConnection(
    @Body() dto: CreateConnectionDto,
    @CurrentUser() user: { organizationId: string },
  ) {
    return this.integrationService.createConnection(user.organizationId, dto.provider);
  }

  // Step 1 — upload a file, get back headers + preview rows for the
  // column-mapping UI. Nothing is saved to the DB at this point.
  // FIX — no size limit meant an authenticated user could upload an
  // arbitrarily large file, buffered fully in memory by multer's default
  // behavior and then parsed character-by-character — a memory/CPU
  // exhaustion vector. 10MB comfortably covers any real CSV import.
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  previewImport(
    @UploadedFile() file: Express.Multer.File,
    @Query('connectionId') connectionId: string | undefined,
    @CurrentUser() user: { organizationId: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.integrationService.previewFile(file.buffer, connectionId, user.organizationId);
  }

  // Step 2 — user confirms the column mapping, we create ExternalOrder
  // + ExternalOrderItem rows.
  @Post('import/confirm')
  confirmImport(
    @Body() dto: ConfirmImportDto,
    @CurrentUser() user: { organizationId: string },
  ) {
    return this.integrationService.confirmImport(dto, user.organizationId);
  }

  @Get('orders/pending')
  listPendingOrders(@CurrentUser() user: { organizationId: string }) {
    return this.integrationService.listPendingOrders(user.organizationId);
  }
}