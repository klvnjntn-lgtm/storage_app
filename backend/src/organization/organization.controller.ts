import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ModuleKey } from '@prisma/client';
import { OrganizationService } from './organization.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator'; // TODO: verify — original file imported from './org.decorator'; confirm which actually exists in your repo (see grep below) before merging
import type { UpdateOrganizationSettingsInput } from './organization.service';
import { LOGO_STORAGE } from './storage/logo-storage.interface';
import type { LogoStorage } from './storage/logo-storage.interface';

const INVOICE_POS_FIELDS: (keyof UpdateOrganizationSettingsInput)[] = [
  'posPricingEnabled',
  'legalName',
  'npwp',
  'logoUrl',
  'bankName',
  'bankAccountNumber',
  'bankAccountName',
  'taxEnabled',
];

const WAREHOUSE_OPS_FIELDS: (keyof UpdateOrganizationSettingsInput)[] = ['fulfillmentMode'];

// Generous but bounded — big enough for a real logo image, small enough
// that this route can never be used to exhaust disk/memory. Multer's
// own default is Infinity, so this is what was actually missing before
// (there was no route, and therefore no limit, at all).
const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly modules: OrganizationModulesService,
    @Inject(LOGO_STORAGE) private readonly logoStorage: LogoStorage,
  ) {}

  // Admin-only, enforced via RolesGuard/@Roles instead of a manual
  // req.user.role check — so there's exactly one implementation of
  // "what counts as admin" across the whole app, shared with every
  // other @Roles('ADMIN') route.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Get('settings')
  getSettings(@CurrentOrg() orgId: string) {
    return this.organizationService.getSettings(orgId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch('settings')
  async updateSettings(
    @CurrentOrg() orgId: string,
    @Body() body: UpdateOrganizationSettingsInput,
  ) {
    await this.assertFieldsAllowed(orgId, body, INVOICE_POS_FIELDS, ModuleKey.INVOICE_POS);
    await this.assertFieldsAllowed(orgId, body, WAREHOUSE_OPS_FIELDS, ModuleKey.WAREHOUSE_OPS);

    return this.organizationService.updateSettings(orgId, body);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('logo')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: memoryStorage(), // buffer in memory; LogoStorage decides where it lands
      limits: { fileSize: MAX_LOGO_SIZE_BYTES },
    }),
  )
  async uploadLogo(
    @CurrentOrg() orgId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertFieldsAllowed(orgId, { logoUrl: '' }, INVOICE_POS_FIELDS, ModuleKey.INVOICE_POS);

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const logoUrl = await this.logoStorage.save(orgId, file);
    await this.organizationService.updateSettings(orgId, { logoUrl });

    return { logoUrl };
  }

  private async assertFieldsAllowed(
    orgId: string,
    body: UpdateOrganizationSettingsInput,
    gatedFields: (keyof UpdateOrganizationSettingsInput)[],
    module: ModuleKey,
  ) {
    const touchedField = gatedFields.find((f) => body[f] !== undefined);
    if (!touchedField) return;

    const allowed = await this.modules.isModuleEnabled(orgId, module);
    if (!allowed) {
      throw new ForbiddenException(`${module} is not active on this organization`);
    }
  }
}