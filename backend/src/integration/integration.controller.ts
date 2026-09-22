import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntegrationService } from './integration.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards() // relies on the global JwtAuthGuard/OrgGuard already applied at APP_GUARD level
@Controller('integrations')
export class IntegrationController {
  constructor(private readonly integrationService: IntegrationService) {}

  @Get('connections')
  listConnections(@CurrentUser() user: { organizationId: string }) {
    return this.integrationService.listConnections(user.organizationId);
  }

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