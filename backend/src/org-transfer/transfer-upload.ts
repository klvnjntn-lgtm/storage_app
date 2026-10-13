import { BadRequestException, StreamableFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';

// Upload of a .wsexport file, to a temp file the caller deletes.
export const TransferFileInterceptor = FileInterceptor('file', {
  storage: diskStorage({
    destination: tmpdir(),
    filename: (_req, _file, cb) =>
      cb(null, `waresys-import-${randomUUID()}.wsexport`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.wsexport')) {
      return cb(
        new BadRequestException('Choose a WareSys export file (.wsexport)'),
        false,
      );
    }
    cb(null, true);
  },
});

export function requireFile(
  file: Express.Multer.File | undefined,
): Express.Multer.File {
  if (!file) throw new BadRequestException('No file uploaded');
  return file;
}

// Sends an export made by OrgTransferService.export and deletes it after.
export function sendExport(
  res: Response,
  exported: { file: string; filename: string },
): StreamableFile {
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${exported.filename}"`,
  });
  const stream = createReadStream(exported.file);
  stream.on('close', () => void fs.rm(exported.file, { force: true }));
  return new StreamableFile(stream);
}
