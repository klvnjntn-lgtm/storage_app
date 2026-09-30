// src/storage/files.controller.ts
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  FILE_STORAGE,
  FileNotFoundError,
  contentTypeForKey,
  type FileStorage,
} from './file-storage.interface';
import { SignedFileUrlService, isPrivateKey } from './signed-file-url.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';

// Serves private files (delivery proofs) behind a signed, expiring link.
// No JWT guard on purpose: the signature *is* the credential — see
// SignedFileUrlService — so it opts out of the global JWT/org/license
// guards, same as the token-authed print routes. Public files (media/, logos/) don't come through
// here; main.ts serves those at /uploads.
@Public()
@SkipLicenseCheck()
@Controller('files')
export class FilesController {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly signer: SignedFileUrlService,
  ) {}

  @Get('signed')
  async signed(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    // Only private prefixes are ever signed, so anything else is a forgery.
    if (!key || !isPrivateKey(key))
      throw new ForbiddenException('Invalid file link');
    const secondsLeft = this.signer.verify(key, exp, sig);
    if (secondsLeft == null)
      throw new ForbiddenException('File link is invalid or has expired');

    let data: Buffer;
    try {
      data = await this.storage.get(key);
    } catch (err) {
      if (err instanceof FileNotFoundError)
        throw new NotFoundException('File not found');
      throw err;
    }
    res.set({
      'Content-Type': contentTypeForKey(key),
      'Cache-Control': `private, max-age=${secondsLeft}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    res.send(data);
  }
}
