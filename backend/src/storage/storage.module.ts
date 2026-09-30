// src/storage/storage.module.ts
import { Global, Module } from '@nestjs/common';
import { FILE_STORAGE } from './file-storage.interface';
import { LocalFileStorage } from './local-file-storage';
import { SignedFileUrlService } from './signed-file-url.service';
import { FilesController } from './files.controller';

// The one place that decides where uploaded files live. Swapping to an
// S3-compatible bucket later = a new FileStorage implementation bound
// here; MediaService, logos and delivery proofs don't change.
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    { provide: FILE_STORAGE, useClass: LocalFileStorage },
    SignedFileUrlService,
  ],
  exports: [FILE_STORAGE, SignedFileUrlService],
})
export class StorageModule {}
