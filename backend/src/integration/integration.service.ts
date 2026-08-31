import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseCsv } from './csv-parser.util';
import { ConfirmImportDto } from './dto/confirm-import.dto';

@Injectable()
export class IntegrationService {
  constructor(private readonly prisma: PrismaService) {}

  // Step 1: customer uploads a file. We just parse headers + a preview
  // of rows so the UI can show a column-mapping screen. Nothing is
  // written to the DB yet.
  previewFile(fileBuffer: Buffer, connectionId: string | undefined, organizationId: string) {
    const text = fileBuffer.toString('utf-8');
    const rows = parseCsv(text);

    if (rows.length === 0) {
      throw new BadRequestException('File is empty or could not be parsed');
    }

    const headers = Object.keys(rows[0]);

    return {
      headers,
      preview: rows.slice(0, 5), // first 5 rows for the UI to show
      totalRows: rows.length,
      // if we already have a saved mapping for this connection, return it
      // so the UI can pre-fill instead of asking again
      savedMapping: connectionId ? this.getSavedMapping(connectionId, organizationId) : null,
      rawRows: rows, // frontend sends this back in confirmImport
    };
  }

  private async getSavedMapping(connectionId: string, organizationId: string) {
    const conn = await this.prisma.integrationConnection.findFirst({
      where: { id: connectionId, organizationId },
    });
    return conn?.columnMapping ?? null;
  }

  // Step 2: user confirms/adjusts the column mapping. We reshape rows into
  // our standard fields, resolve products where possible, and create
  // ExternalOrder + ExternalOrderItem rows. Unmapped SKUs are kept with
  // productId: null so nothing is silently dropped — they show up as
  // "needs mapping" in the UI afterward.
  async confirmImport(dto: ConfirmImportDto, organizationId: string) {
    const connection = await this.prisma.integrationConnection.findFirst({
      where: { id: dto.connectionId, organizationId },
    });

    if (!connection) {
      throw new NotFoundException('Integration connection not found');
    }

    // Save the mapping for next time
    await this.prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { columnMapping: dto.columnMapping },
    });

    const results: { created: number; skipped: number; errors: string[] } = {
      created: 0,
      skipped: 0,
      errors: [],
    };

    // Group rows by externalRef so multiple line items on one invoice
    // become one ExternalOrder with several ExternalOrderItems
    const grouped = new Map<string, typeof dto.rows>();
    for (const row of dto.rows) {
      if (!row.externalRef || !row.sku || !row.quantity) {
        results.errors.push(`Skipped incomplete row: ${JSON.stringify(row)}`);
        continue;
      }
      const existing = grouped.get(row.externalRef) ?? [];
      existing.push(row);
      grouped.set(row.externalRef, existing);
    }

    for (const [externalRef, rows] of grouped) {
      const alreadyExists = await this.prisma.externalOrder.findUnique({
        where: { connectionId_externalRef: { connectionId: connection.id, externalRef } },
      });

      if (alreadyExists) {
        results.skipped++;
        continue; // don't double-import the same invoice on re-upload
      }

      const itemsData = await Promise.all(
        rows.map(async (row) => {
          const productId = await this.resolveProductId(connection.id, organizationId, row.sku);
          return {
            externalSku: row.sku,
            quantity: row.quantity,
            productId,
          };
        }),
      );

      await this.prisma.externalOrder.create({
        data: {
          organizationId,
          connectionId: connection.id,
          externalRef,
          customerName: rows[0].customerName ?? null,
          items: { create: itemsData },
        },
      });

      results.created++;
    }

    return results;
  }

  // Tries an explicit mapping first, falls back to a direct Product.sku match
  private async resolveProductId(
    connectionId: string,
    organizationId: string,
    externalSku: string,
  ): Promise<string | null> {
    const mapping = await this.prisma.externalProductMapping.findUnique({
      where: { connectionId_externalSku: { connectionId, externalSku } },
    });
    if (mapping) return mapping.productId;

    const product = await this.prisma.product.findFirst({
      where: { organizationId, sku: externalSku },
    });
    return product?.id ?? null;
  }

  async listConnections(organizationId: string) {
    return this.prisma.integrationConnection.findMany({ where: { organizationId } });
  }

  async createConnection(organizationId: string, provider: string) {
    return this.prisma.integrationConnection.create({
      data: { organizationId, provider },
    });
  }

  // Orders sitting in PENDING, ready for a warehouse worker to pick up
  async listPendingOrders(organizationId: string) {
    return this.prisma.externalOrder.findMany({
      where: { organizationId, status: 'PENDING' },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}