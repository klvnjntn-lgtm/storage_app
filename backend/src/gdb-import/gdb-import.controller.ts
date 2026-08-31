import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { chmod, unlink } from 'fs/promises';
import { Request } from 'express';
import { GdbImportService } from './gdb-import.service';
import { InvoiceFormat } from '@prisma/client';

// JwtAuthGuard is registered globally in AppModule (APP_GUARD), so
// req.user.organizationId is already populated on every route by the time
// this controller runs — no per-controller @UseGuards(...) needed here.
interface AuthedRequest extends Request {
  user?: { organizationId: string };
}

const UPLOAD_DIR = '/tmp/gdb-imports';

// diskStorage's `destination` does not create the directory for you — make
// sure it exists once, at module load, rather than on every request.
// Mode 0o777 so Firebird 2.5 (running as the `firebird` system user via
// xinetd) can traverse into it, not just this Node process's own user.
mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o777 });

@Controller('integrations/accurate-gdb')
export class GdbImportController {
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
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — adjust to your largest expected GDB
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.gdb')) {
          return cb(new BadRequestException('File must be a .gdb file'), false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Firebird 2.5 Classic (the legacy-ODS fallback engine) runs as the
    // `firebird` system user via xinetd, not as whatever user this Node
    // process runs as — so the file multer just wrote (owned by this
    // process's user) is unreadable to it unless we open up the mode here.
    // Fine for /tmp scratch data that's deleted within 30 minutes anyway.
    await chmod(file.path, 0o666);

    const token = this.gdbImportService.registerUploadedFile(file.path);

return await this.gdbImportService.preview(token);
  }

  @Post('confirm/:token')
  async confirm(
    @Param('token') token: string,
    @Req() req: AuthedRequest,
    @Body()
    body: {
      target: 'products_only' | 'full_invoices';
      invoiceFormat?: InvoiceFormat;
    },
  ) {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new BadRequestException('No organization found on the authenticated request');
    }
    if (body.target !== 'products_only' && body.target !== 'full_invoices') {
      throw new BadRequestException('target must be "products_only" or "full_invoices"');
    }

    return this.gdbImportService.confirmImport(
      token,
      organizationId,
      body.target,
      body.invoiceFormat ?? InvoiceFormat.A4,
    );
  }
}