import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { chmodSync, mkdirSync } from 'fs';
import { chmod, unlink } from 'fs/promises';
import { Request } from 'express';
import { GdbImportService } from './gdb-import.service';
import { InvoiceFormat } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// JwtAuthGuard is registered globally in AppModule (APP_GUARD), so
// req.user.organizationId is already populated on every route by the time
// this controller runs — no per-controller @UseGuards(...) needed here.
interface AuthedRequest extends Request {
  user?: { organizationId: string };
}

const UPLOAD_DIR = '/tmp/gdb-imports';

// diskStorage's `destination` does not create the directory for you — make
// sure it exists once, at module load, rather than on every request.
// Firebird 2.5 (running as the `firebird` system user via xinetd) needs to
// traverse into it, which only takes the execute bit. 0o711 rather than
// 0o777: other users can still open a file whose name they know, but can't
// list the directory — and every file is a whole company's accounting
// database under a random UUID name. chmod is explicit because mkdirSync's
// mode is masked by the umask; it can fail on a bind mount owned by another
// user, which is fine — the directory then keeps whatever mode it had.
mkdirSync(UPLOAD_DIR, { recursive: true });
try {
  chmodSync(UPLOAD_DIR, 0o711);
} catch {
  // see above
}

// NEW — was 'products_only' | 'full_invoices'. Adding a target here is the
// only wiring step the PO importer needs on this side; the service already
// branches on the exact string 'full_invoices_and_purchase_orders'.
type GdbImportTarget = 'products_only' | 'full_invoices' | 'full_invoices_and_purchase_orders';
const VALID_TARGETS: GdbImportTarget[] = [
  'products_only',
  'full_invoices',
  'full_invoices_and_purchase_orders',
];

// Admin-only: a confirmed import bulk-writes products, invoices and
// purchase orders (and their ledger entries) into the organization.
@UseGuards(RolesGuard)
@Roles('ADMIN')
@Controller('integrations/accurate-gdb')
export class GdbImportController {
  private readonly logger = new Logger(GdbImportController.name);

  constructor(private readonly gdbImportService: GdbImportService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        // Never trust the original filename for the on-disk path — generate
        // our own, since Firebird's `database` option is a raw filesystem
        // path and a malicious filename could otherwise be used for path
        // traversal.
        filename: (_req, _file, cb) => cb(null, `${randomUUID()}.gdb`),
      }),
      limits: { fileSize: 1200 * 1024 * 1024 }, // ~1.2GB — headroom above the 1GB requirement
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.gdb')) {
          return cb(new BadRequestException('File must be a .gdb file'), false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: AuthedRequest) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new BadRequestException('No organization found on the authenticated request');
    }

    // Firebird 2.5 Classic (the legacy-ODS fallback engine) runs as the
    // `firebird` system user via xinetd, not as whatever user this Node
    // process runs as — so the file multer just wrote (owned by this
    // process's user) is unreadable to it unless we open up the mode here.
    // Fine for /tmp scratch data that's deleted within 30 minutes anyway.
    await chmod(file.path, 0o666);

    const token = this.gdbImportService.registerUploadedFile(file.path, organizationId);

    try {
      return await this.gdbImportService.preview(token, organizationId);
    } catch (err) {
      // A file Firebird can't open (wrong format, corrupt, not an Accurate
      // database) used to surface as a bare 500 and leave the upload on disk
      // for the full 30-minute TTL. Delete it now and say what went wrong.
      await this.gdbImportService.cleanupToken(token);
      if (err instanceof HttpException) throw err;
      this.logger.warn(`GDB preview failed: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException(
        'Could not open this file as an Accurate database. Check that it is a valid, uncorrupted .gdb file.',
      );
    }
  }

  @Post('confirm/:token')
  async confirm(
    @Param('token') token: string,
    @Req() req: AuthedRequest,
    @Body()
    body: {
      target: GdbImportTarget;
      invoiceFormat?: InvoiceFormat;
    },
  ) {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new BadRequestException('No organization found on the authenticated request');
    }
    if (!VALID_TARGETS.includes(body.target)) {
      throw new BadRequestException(`target must be one of: ${VALID_TARGETS.join(', ')}`);
    }

    return this.gdbImportService.confirmImport(
      token,
      organizationId,
      body.target,
      body.invoiceFormat ?? InvoiceFormat.A4,
    );
  }
}