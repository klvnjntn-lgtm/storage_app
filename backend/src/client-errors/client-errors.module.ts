// src/client-errors/client-errors.module.ts
import { Module } from '@nestjs/common';
import { ClientErrorsController } from './client-errors.controller';

@Module({ controllers: [ClientErrorsController] })
export class ClientErrorsModule {}
