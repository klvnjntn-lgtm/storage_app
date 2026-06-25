import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventType } from '@prisma/client';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orgId: string, type: EventType) {
    return this.prisma.session.create({
      data: {
        type,
        status: 'OPEN',
        organizationId: orgId,                              // 🔒
      },
    });
  }

  async findAll(orgId: string) {
    return this.prisma.session.findMany({
      where: { organizationId: orgId },                    // 🔒
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async findOne(orgId: string, id: string) {
    const session = await this.prisma.session.findFirst({
      where: { id, organizationId: orgId },                // 🔒
      include: {
        events: {
          include: {
            fromLocation: true,
            toLocation: true,
          },
        },
      },
    });

    if (!session) throw new BadRequestException('Session not found');
    return session;
  }

  async addItem(
    orgId: string,
    sessionId: string,
    productId: string,
    qty: number,
    fromLocationId?: string,
    toLocationId?: string,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, organizationId: orgId },     // 🔒
    });
    if (!session) throw new BadRequestException('Session not found');
    if (!session.type) throw new BadRequestException('Session type invalid');

    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },     // 🔒
    });
    if (!product) throw new BadRequestException('Product not found');

    // SessionItem + Event are atomic — if the event write fails,
    // the item creation rolls back too.
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.sessionItem.create({
        data: {
          sessionId,
          productId,
          quantity: qty,
        },
      });

      await tx.event.create({
        data: {
          productId,
          sessionId,
          sessionItemId: item.id,
          type: session.type as EventType,
          quantity: qty,
          fromLocationId,
          toLocationId,
          organizationId: orgId,                           // 🔒
          metadata: { reason: 'session item added' },
        },
      });

      return item;
    });
  }

  async complete(orgId: string, id: string) {
    const session = await this.prisma.session.findFirst({
      where: { id, organizationId: orgId },                // 🔒
    });

    if (!session) throw new BadRequestException('Session not found');
    if (session.status === 'COMPLETED') return session;

    return this.prisma.session.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }
}