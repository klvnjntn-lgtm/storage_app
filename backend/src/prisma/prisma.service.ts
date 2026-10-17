import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  // Without this, app.close() (shutdown, and every spec's module.close())
  // left the connection pool open — specs leaked a pool per file until the
  // test DB ran out of connections.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
