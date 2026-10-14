import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, SerialStatus } from '@prisma/client';

type Tx = Prisma.TransactionClient;

// How serial-numbered units move, as plain functions over the caller's
// transaction (like inventory-costing.ts): goods receipts, invoices,
// purchase returns and stock transfers each call these alongside their
// own stock movement, so a serial's status can never disagree with the
// document that moved it.

// Trimmed, de-duplicated (case-sensitive: serials are what's printed on
// the unit), empties dropped. A list typed twice by mistake is refused
// rather than silently collapsed, since the count must match a quantity.
export function normalizeSerials(raw: string[] | undefined | null): string[] {
  const list = (raw ?? []).map((s) => s.trim()).filter(Boolean);
  const dupes = list.filter((s, i) => list.indexOf(s) !== i);
  if (dupes.length)
    throw new BadRequestException(
      `Serial number listed twice: ${[...new Set(dupes)].join(', ')}`,
    );
  return list;
}

// For a tracked product, `quantity` units need exactly that many serials.
export function assertSerialCount(
  productName: string,
  quantity: number,
  serials: string[],
) {
  if (!Number.isInteger(quantity)) {
    throw new BadRequestException(
      `${productName} is tracked by serial number, so its quantity must be a whole number`,
    );
  }
  if (serials.length !== quantity) {
    throw new BadRequestException(
      `${productName}: ${quantity} unit(s) need ${quantity} serial number(s), got ${serials.length}`,
    );
  }
}

// Units arriving from a supplier. A serial already in the business (in
// stock or on the way) is a typo or a duplicate delivery; one that left
// before (sold, returned, written off) is coming back and is reused.
export async function receiveSerials(
  tx: Tx,
  p: {
    organizationId: string;
    productId: string;
    locationId: string;
    serials: string[];
    goodsReceiptId: string;
  },
) {
  if (p.serials.length === 0) return;
  const existing = await tx.productSerial.findMany({
    where: { productId: p.productId, serialNumber: { in: p.serials } },
  });
  const live = existing.filter(
    (e) =>
      e.status === SerialStatus.IN_STOCK ||
      e.status === SerialStatus.IN_TRANSIT,
  );
  if (live.length) {
    throw new ConflictException(
      `Already in stock: ${live.map((e) => e.serialNumber).join(', ')}`,
    );
  }
  for (const serialNumber of p.serials) {
    await tx.productSerial.upsert({
      where: {
        productId_serialNumber: { productId: p.productId, serialNumber },
      },
      create: {
        organizationId: p.organizationId,
        productId: p.productId,
        serialNumber,
        locationId: p.locationId,
        goodsReceiptId: p.goodsReceiptId,
      },
      update: {
        status: SerialStatus.IN_STOCK,
        locationId: p.locationId,
        goodsReceiptId: p.goodsReceiptId,
        invoiceId: null,
        soldAt: null,
        purchaseReturnId: null,
        stockTransferId: null,
      },
    });
  }
}

// Units leaving stock at a location — sold, sent back to the supplier, or
// put on a transfer. Every serial must be in stock there right now; the
// update is conditional on that, so two documents racing for the same
// unit can't both take it.
export async function takeSerials(
  tx: Tx,
  p: {
    organizationId: string;
    productId: string;
    locationId: string;
    serials: string[];
    to:
      | typeof SerialStatus.SOLD
      | typeof SerialStatus.RETURNED_TO_SUPPLIER
      | typeof SerialStatus.IN_TRANSIT;
    refs: {
      invoiceId?: string;
      purchaseReturnId?: string;
      stockTransferId?: string;
    };
  },
) {
  if (p.serials.length === 0) return;
  const moved = await tx.productSerial.updateMany({
    where: {
      organizationId: p.organizationId,
      productId: p.productId,
      serialNumber: { in: p.serials },
      status: SerialStatus.IN_STOCK,
      locationId: p.locationId,
    },
    data: {
      status: p.to,
      ...(p.to === SerialStatus.SOLD && { soldAt: new Date() }),
      ...(p.to === SerialStatus.IN_TRANSIT && { locationId: null }),
      ...p.refs,
    },
  });
  if (moved.count !== p.serials.length) {
    const found = await tx.productSerial.findMany({
      where: { productId: p.productId, serialNumber: { in: p.serials } },
      select: { serialNumber: true, status: true, locationId: true },
    });
    const ok = new Set(
      found
        .filter(
          (f) =>
            f.status === p.to ||
            (f.status === SerialStatus.IN_STOCK &&
              f.locationId === p.locationId),
        )
        .map((f) => f.serialNumber),
    );
    const bad = p.serials.filter((s) => !ok.has(s));
    throw new BadRequestException(
      `Not in stock at this location: ${bad.join(', ')}`,
    );
  }
}

// A voided invoice puts its units back where they were sold from.
export async function restoreInvoiceSerials(
  tx: Tx,
  organizationId: string,
  invoiceId: string,
) {
  await tx.productSerial.updateMany({
    where: { organizationId, invoiceId, status: SerialStatus.SOLD },
    data: { status: SerialStatus.IN_STOCK, invoiceId: null, soldAt: null },
  });
}

// Units on a transfer arriving (or, on cancel, going back to the source).
// Anything listed in `lost` didn't arrive and is written off.
export async function landTransferSerials(
  tx: Tx,
  p: {
    organizationId: string;
    stockTransferId: string;
    locationId: string;
    lost?: string[];
    productId?: string;
  },
) {
  if (p.lost?.length) {
    await tx.productSerial.updateMany({
      where: {
        organizationId: p.organizationId,
        stockTransferId: p.stockTransferId,
        status: SerialStatus.IN_TRANSIT,
        serialNumber: { in: p.lost },
        ...(p.productId && { productId: p.productId }),
      },
      data: {
        status: SerialStatus.WRITTEN_OFF,
        note: 'Did not arrive on stock transfer',
      },
    });
  }
  await tx.productSerial.updateMany({
    where: {
      organizationId: p.organizationId,
      stockTransferId: p.stockTransferId,
      status: SerialStatus.IN_TRANSIT,
      ...(p.productId && { productId: p.productId }),
    },
    data: { status: SerialStatus.IN_STOCK, locationId: p.locationId },
  });
}
