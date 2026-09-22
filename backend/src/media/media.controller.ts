// src/media/media.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — mirrors organization logo upload's limit

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  list(
    @CurrentOrg() orgId: string,
    @Query('q') q?: string,
    @Query('mimeType') mimeType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.mediaService.list(orgId, {
      q,
      mimeType,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
    }),
  )
  upload(
    @CurrentOrg() orgId: string,
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const { sub: userId } = req.user;
    return this.mediaService.upload(orgId, userId, file);
  }

  @Delete(':id')
  remove(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.mediaService.remove(orgId, id);
  }
}
