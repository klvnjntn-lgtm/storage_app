import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import Firebird = require('node-firebird');
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceFormat, InvoiceStatus, PaymentStatus } from '@prisma/client';
import { LocationService } from 'src/location/location.service';
// ---------------------------------------------------------------------------
// Firebird helpers (promisified — node-firebird is callback-based)
// ---------------------------------------------------------------------------

function attach(options: Firebird.Options): Promise<Firebird.Database> {
  return new Promise((resolve, reject) => {
    Firebird.attach(options, (err, db) => {
      if (err) {
        reject(err);
        return;
      }

      // node-firebird's Database is an EventEmitter. If it ever emits
      // 'error' (e.g. the connection is dropped/reset mid-import) and
      // nothing is listening, Node treats it as an uncaught exception
      // and kills the entire process — no stack trace, no 500 body,
      // just the socket to the caller resetting. This listener turns
      // that into a normal, loggable event instead of a process crash.
      //
      // (Database is typed as an EventEmitter via a local .d.ts
      // augmentation — see src/types/node-firebird.d.ts.)
      db.on('error', (dbErr) => {
        console.error('[Firebird] connection error after attach', {
          database: options.database,
          port: options.port,
          message: dbErr?.message,
          gdscode: (dbErr as any)?.gdscode,
        });
      });

      resolve(db);
    });
  });
}

function fbQuery<T = any>(
  db: Firebird.Database,
  sql: string,
  params: any[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result as T[]);
      }
    });
  });
}

function detach(db: Firebird.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.detach((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Vehicle description parsing (Batam "BP" plates + KM/BERIKUTNYA readings
// embedded in ARINV.DESCRIPTION)
//
// Example: "# BP 1279 YI DH TERIOS KM: 87.919 BERIKUTNYA: 92.919 · ABE Mandiri"
//   plate         -> "BP 1279 YI"
//   vehicleModel  -> "TERIOS"      (stable vehicle info — Vehicle table)
//   odometer      -> 87919         (per-visit reading — Invoice table)
//   nextServiceKm -> 92919         (per-visit reminder — Invoice table)
//   extra         -> "ABE Mandiri" (parsed out, not currently persisted)
//
// odometer/nextServiceKm deliberately do NOT get folded into vehicleModel —
// the same vehicle can appear on many invoices with different readings, so
// the reading belongs on Invoice, not Vehicle. See Invoice.odometer /
// Invoice.nextServiceKm in the Prisma schema.
// ---------------------------------------------------------------------------

// BP + 1-4 digits + 1-3 letters, with optional space/dot/dash separators,
// anchored so it doesn't match mid-word and doesn't swallow trailing chars.
const PLATE_REGEX = /\bBP[\s.\-]{0,3}(\d{1,4})[\s.\-]{0,3}([A-Z]{1,3})(?![A-Z0-9])/i;
const KM_REGEX = /\bKM\s*[:.]?\s*([\d.,]+)/i;
const NEXT_KM_REGEX = /\bBERIKUTNYA\s*[:.]?\s*([\d.,]+)/i;
const SEGMENT_SEPARATOR_REGEX = /[·|]/;

interface ParsedVehicleDescription {
  plate: string | null;
  vehicleModel: string | null;
  odometer: number | null;
  nextServiceKm: number | null;
  extra: string | null;
}

function normalizeExtra(remainder: string): string | null {
  let t = remainder.trim();
  t = t.replace(/^\(+/, '').replace(/\)+$/, '');
  t = t.replace(/^[\s.\-,:;]+|[\s.\-,:;]+$/g, '');
  t = t.replace(/\s{2,}/g, ' ');
  return t.length > 0 ? t : null;
}

// Indonesian odometer readings use '.' as a thousands separator
// ("87.919" = 87919 km). Strip separators and parse as an integer.
function parseKmValue(raw: string): number | null {
  const digits = raw.replace(/[.,]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? null : n;
}

function parseVehicleDescription(description: string | null | undefined): ParsedVehicleDescription {
  const empty: ParsedVehicleDescription = {
    plate: null,
    vehicleModel: null,
    odometer: null,
    nextServiceKm: null,
    extra: null,
  };
  if (!description) return empty;

  // 1. Plate — same extraction behavior as before this change.
  const plateMatch = PLATE_REGEX.exec(description);
  if (!plateMatch) {
    // No plate -> this description isn't about a vehicle at all; don't
    // guess a model/odometer out of unrelated free text.
    return empty;
  }

  const digits = plateMatch[1];
  const letters = plateMatch[2].toUpperCase();
  const plate = `BP ${digits} ${letters}`;

  let working =
    description.slice(0, plateMatch.index) +
    ' ' +
    description.slice(plateMatch.index + plateMatch[0].length);

  // 2. Odometer (KM:) — optional.
  let odometer: number | null = null;
  const kmMatch = KM_REGEX.exec(working);
  if (kmMatch) {
    odometer = parseKmValue(kmMatch[1]);
    working = working.slice(0, kmMatch.index) + ' ' + working.slice(kmMatch.index + kmMatch[0].length);
  }

  // 3. Next-service reminder (BERIKUTNYA:) — optional.
  let nextServiceKm: number | null = null;
  const nextKmMatch = NEXT_KM_REGEX.exec(working);
  if (nextKmMatch) {
    nextServiceKm = parseKmValue(nextKmMatch[1]);
    working = working.slice(0, nextKmMatch.index) + ' ' + working.slice(nextKmMatch.index + nextKmMatch[0].length);
  }

  // 4. Whatever remains is: [optional code] [model words] [separator] [free text].
  // Split on a separator (·, |) so trailing shop/customer notes land in
  // `extra` instead of getting swallowed into the model.
  const sepIndex = working.search(SEGMENT_SEPARATOR_REGEX);
  const modelRegion = sepIndex >= 0 ? working.slice(0, sepIndex) : working;
  const extraRegion = sepIndex >= 0 ? working.slice(sepIndex + 1) : '';

  let modelTokens = modelRegion.trim().split(/\s+/).filter(Boolean);

  // Heuristic: a short (<=3 char) all-caps token immediately after the
  // plate, when followed by more text, is treated as a brand/dealer code
  // rather than part of the model — e.g. "DH TERIOS" -> model "TERIOS".
  // Based on one confirmed example; validate against more real
  // ARINV.DESCRIPTION samples before relying on it broadly.
  if (modelTokens.length > 1 && /^[A-Z]{1,3}$/.test(modelTokens[0])) {
    modelTokens = modelTokens.slice(1);
  }

  const vehicleModel = modelTokens.length > 0 ? modelTokens.join(' ') : null;
  const extra = normalizeExtra(extraRegion);

  return { plate, vehicleModel, odometer, nextServiceKm, extra };
}

function num(value: number | null | undefined): number {
  return value == null ? 0 : Number(value);
}

// gdscode for "Unsupported on-disk structure ... found X, support Y"
const ODS_MISMATCH_GDSCODE = 335544379;
// gdscode for "Your user name and password are not defined"
const AUTH_FAILURE_GDSCODE = 335544472;

// ---------------------------------------------------------------------------
// Firebird connection attempts
//
// This deploy runs a single physical Firebird 2.5 server (see
// docker-compose.yml — one `firebird` service). Some imported .GDB files
// were created under a "primary" SYSDBA login, others under a separate
// legacy "POS" login — same server, same port, different credentials.
// attachAnyVersion() below tries each credential set in order against the
// same host, and falls through to the next one on an auth failure (or an
// ODS/protocol mismatch, for deploys that DO run two distinct engines).
// ---------------------------------------------------------------------------

interface FirebirdAttempt {
  port: number;
  user: string | undefined;
  password: string | undefined;
}

function buildFirebirdAttempts(): FirebirdAttempt[] {
  const primaryPort = process.env.FIREBIRD_PORT ? Number(process.env.FIREBIRD_PORT) : 3050;
  const legacyPort = process.env.FIREBIRD_LEGACY_PORT ? Number(process.env.FIREBIRD_LEGACY_PORT) : primaryPort;

  return [
    { port: primaryPort, user: process.env.FIREBIRD_USER, password: process.env.FIREBIRD_PASSWORD },
    { port: legacyPort, user: process.env.FIREBIRD_LEGACY_USER, password: process.env.FIREBIRD_LEGACY_PASSWORD },
  ];
}

async function attachAnyVersion(
  dbPath: string,
  host: string,
): Promise<{ db: Firebird.Database; port: number; user: string | undefined; password: string | undefined }> {
  let lastErr: any;

  for (const attempt of buildFirebirdAttempts()) {
    const { port, user, password } = attempt;
    let db: Firebird.Database | undefined;

    try {
      console.log('[Firebird] ATTACH attempt', {
        port,
        database: dbPath,
        user,
      });

      db = await attach({
        host,
        user,
        password,
        role: 'NONE',
        database: dbPath,
        port,
      });

      console.log('[Firebird] ATTACH SUCCESS', {
        port,
        database: dbPath,
        user,
      });

      // Verify the connection actually works against this engine/login.
      const test = await fbQuery<{ CURRENT_USER: string }>(
        db,
        `SELECT CURRENT_USER FROM RDB$DATABASE`,
      );

      console.log('[Firebird] CURRENT_USER:', test);

      return { db, port, user, password };
    } catch (err: any) {
      lastErr = err;

      console.log('[Firebird] ATTACH/TEST FAILED', {
        port,
        user,
        gdscode: err?.gdscode,
        message: err?.message,
      });

      // If we managed to attach but the connection test failed,
      // close that connection before trying the next credential set.
      if (db) {
        try {
          await detach(db);
        } catch {
          // Ignore cleanup failure.
        }
      }

      // Only fall back for known Firebird compatibility/auth issues —
      // anything else (e.g. file not found, network unreachable) should
      // surface immediately rather than being masked by a second attempt.
      if (
        err?.gdscode !== ODS_MISMATCH_GDSCODE &&
        err?.gdscode !== AUTH_FAILURE_GDSCODE &&
        err?.gdscode !== 335544745
      ) {
        throw err;
      }
    }
  }

  throw lastErr;
}

// ---------------------------------------------------------------------------
// Temp file registry
// ---------------------------------------------------------------------------
// Uploaded .GDB files are written to disk (Firebird needs a real file path,
// not a buffer) and tracked by a short-lived token so the preview and
// confirm steps can reattach to the same file.
//
// NOTE: this is in-memory and per-instance. If this service ever runs behind
// multiple horizontally-scaled backend instances, a preview done on instance
// A and confirmed on instance B would fail to find the token — fine for a
// single-instance deploy, but flag this if that changes.

const TEMP_FILE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface TempFileEntry {
  path: string;
  timeout: NodeJS.Timeout;
  // Which Firebird port + credentials actually opened this file, set once
  // preview() succeeds — so confirmImport() reconnects directly instead of
  // re-running the whole fallback probe (and potentially guessing wrong,
  // since a file that needed the legacy login once will always need it).
  firebirdPort?: number;
  firebirdUser?: string;
  firebirdPassword?: string;
}

@Injectable()
export class GdbImportService {
  constructor(private readonly prisma: PrismaService,     
    private readonly locationService: LocationService,
) {}

  private readonly tempFiles = new Map<string, TempFileEntry>();

  registerUploadedFile(diskPath: string): string {
    const token = randomUUID();
    const timeout = setTimeout(() => this.cleanupToken(token), TEMP_FILE_TTL_MS);
    this.tempFiles.set(token, { path: diskPath, timeout });
    return token;
  }

  private async cleanupToken(token: string) {
    const entry = this.tempFiles.get(token);
    if (!entry) return;
    this.tempFiles.delete(token);
    clearTimeout(entry.timeout);
    try {
      await unlink(entry.path);
    } catch {
      // already gone — fine
    }
  }

  private getPathOrThrow(token: string): string {
    const entry = this.tempFiles.get(token);
    if (!entry) {
      throw new NotFoundException('Upload expired or not found — please re-upload the file');
    }
    return entry.path;
  }

  private firebirdHost(): string {
    return process.env.FIREBIRD_HOST || 'localhost';
  }

  // -------------------------------------------------------------------------
  // Preview: attach and return counts so the UI can show "X items, Y invoices
  // found" before committing to anything.
  // -------------------------------------------------------------------------

  async preview(token: string) {
    const dbPath = this.getPathOrThrow(token);

    const { db: fbDb, port, user, password } = await attachAnyVersion(dbPath, this.firebirdHost());

    console.log('[Firebird] PREVIEW ATTACHED', {
      port,
      user,
      database: dbPath,
    });

    try {
      const [test] = await fbQuery<{ CNT: number }>(
        fbDb,
        `SELECT COUNT(*) AS CNT FROM ITEM`,
      );

      console.log('[Firebird] ITEM TEST SUCCESS', test);

      const [invoiceCount] = await fbQuery<{ CNT: number }>(
        fbDb,
        `SELECT COUNT(*) AS CNT FROM ARINV`,
      );

      const [customerCount] = await fbQuery<{ CNT: number }>(
        fbDb,
        `
        SELECT COUNT(DISTINCT pd.ID) AS CNT
        FROM PERSONDATA pd
        JOIN ARINV inv ON inv.CUSTOMERID = pd.ID
        `,
      );

      const entry = this.tempFiles.get(token);
      if (entry) {
        entry.firebirdPort = port;
        entry.firebirdUser = user;
        entry.firebirdPassword = password;
      }

      return {
        token,
        itemCount: test.CNT,
        invoiceCount: invoiceCount.CNT,
        customerCount: customerCount.CNT,
      };
    } finally {
      await detach(fbDb);
    }
  }

  // -------------------------------------------------------------------------
  // Confirm: run the actual import. `target` picks how much gets written —
  // warehouse customers only need Products (+ Stock); invoicing/POS
  // customers need Products + Stock + Customers + Invoices.
  // -------------------------------------------------------------------------
// Called before confirmImport, so the UI can show "map these warehouses"
// with real counts before committing anything.
async previewWarehouses(token: string, organizationId: string) {
  const dbPath = this.getPathOrThrow(token);
  const entry = this.tempFiles.get(token);
  const fbDb =
    entry?.firebirdPort && entry.firebirdUser
      ? await attach({
          host: this.firebirdHost(),
          user: entry.firebirdUser,
          password: entry.firebirdPassword,
          database: dbPath,
          port: entry.firebirdPort,
        })
      : (await attachAnyVersion(dbPath, this.firebirdHost())).db;

  try {
    const warehouses = await fbQuery<{ WAREHOUSEID: number; NAME: string; DESCRIPTION: string | null }>(
      fbDb,
      `SELECT WAREHOUSEID, NAME, DESCRIPTION FROM WAREHS`,
    );
    const itemCounts = await fbQuery<{ WAREHOUSEID: number | null; CNT: number }>(
      fbDb,
      `SELECT WAREHOUSEID, COUNT(*) AS CNT FROM ITEM GROUP BY WAREHOUSEID`,
    );
    const countByWarehouseId = new Map(itemCounts.map((r) => [r.WAREHOUSEID, r.CNT]));

    const existingLocations = await this.prisma.location.findMany({
      where: { organizationId },
      select: { id: true, name: true, externalWarehouseId: true },
    });
    const locationByExternalId = new Map(
      existingLocations
        .filter((l) => l.externalWarehouseId != null)
        .map((l) => [l.externalWarehouseId as string, l]),
    );

    return {
      warehouses: warehouses.map((w) => ({
        externalWarehouseId: String(w.WAREHOUSEID),
        name: w.NAME,
        itemCount: countByWarehouseId.get(w.WAREHOUSEID) ?? 0,
        mappedLocation: locationByExternalId.get(String(w.WAREHOUSEID)) ?? null,
      })),
      availableLocations: existingLocations,
    };
  } finally {
    await detach(fbDb);
  }
}

// Called from the mapping step's "save" action, before the user hits
// confirmImport.
async saveWarehouseMapping(
  organizationId: string,
  mappings: { externalWarehouseId: string; locationId: string }[],
) {
  for (const m of mappings) {
    // Guard against cross-tenant IDs — locationId must belong to this org.
    const location = await this.prisma.location.findFirst({
      where: { id: m.locationId, organizationId },
      select: { id: true },
    });
    if (!location) {
      throw new NotFoundException(`Location ${m.locationId} not found for this organization`);
    }
    await this.prisma.location.update({
      where: { id: m.locationId },
      data: { externalWarehouseId: m.externalWarehouseId },
    });
  }
}
  async confirmImport(
    token: string,
    organizationId: string,
    target: 'products_only' | 'full_invoices',
    invoiceFormat: InvoiceFormat = InvoiceFormat.A4,
  ) {
    const dbPath = this.getPathOrThrow(token);
    const entry = this.tempFiles.get(token);

    // Reuse the port + credentials preview() already confirmed work for this
    // file rather than re-running the fallback probe — if it needed the
    // legacy login once, it always will, and re-probing wastes a connection
    // attempt against the wrong login every time.
    const fbDb =
      entry?.firebirdPort && entry.firebirdUser
        ? await attach({
            host: this.firebirdHost(),
            user: entry.firebirdUser,
            password: entry.firebirdPassword,
            database: dbPath,
            port: entry.firebirdPort,
          })
        : (await attachAnyVersion(dbPath, this.firebirdHost())).db;

    try {
      const { result: itemResult, productIdBySku, stockRows } = await this.importItems(fbDb, organizationId);
      const stockResult = await this.importStock(fbDb, organizationId, stockRows, productIdBySku);

      if (target === 'products_only') {
        return { items: itemResult, stock: stockResult };
      }

      const customerIdMap = await this.importCustomers(fbDb, organizationId);
      const invoiceResult = await this.importInvoices(fbDb, organizationId, customerIdMap, invoiceFormat);

      return { items: itemResult, stock: stockResult, invoices: invoiceResult };
    } finally {
      await detach(fbDb);
      await this.cleanupToken(token);
    }
  }

  // -------------------------------------------------------------------------
  // ITEM -> Product (+ raw rows handed off to importStock)
  // -------------------------------------------------------------------------
private async resolveDefaultLocation(
  organizationId: string,
  locationName: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const existing = await this.prisma.location.findFirst({
    where: { organizationId, archivedAt: null, name: locationName },
    select: { id: true, name: true },
  });
  if (existing) return { ...existing, created: false };

  const created = await this.locationService.create(organizationId, locationName);
  return { id: created.id, name: created.name, created: true };
}

private async getOrCreateImportCategory(organizationId: string): Promise<string> {
    const name = 'Imported from Accurate';
    const existing = await this.prisma.category.findFirst({ where: { organizationId, name } });
    if (existing) return existing.id;
    const created = await this.prisma.category.create({ data: { organizationId, name } });
    return created.id;
  }

  private async importItems(fbDb: Firebird.Database, organizationId: string) {
    const rows = await fbQuery<{
      SKU: string;
      NAME: string;
      STOCK: number | null;
      WAREHOUSE_ID: number | null;
    }>(
      fbDb,
      `SELECT ITEMNO AS SKU, ITEMDESCRIPTION AS NAME, QUANTITY AS STOCK, WAREHOUSEID AS WAREHOUSE_ID FROM ITEM`,
    );

    const categoryId = await this.getOrCreateImportCategory(organizationId);

    // Dedupe + clean incoming rows first.
    const bySku = new Map<string, string>(); // sku -> name
    for (const row of rows) {
      const sku = row.SKU?.trim();
      if (!sku) continue;
      const name = row.NAME?.trim() || sku;
      bySku.set(sku, name);
    }
    const skus = [...bySku.keys()];

    // One query to find every existing product for these SKUs, instead of
    // one findFirst per row (was ~10,853 sequential round trips on its own).
    const existingProducts = await this.prisma.product.findMany({
      where: { organizationId, sku: { in: skus } },
      select: { id: true, sku: true },
    });
    const existingBySku = new Map(existingProducts.map((p) => [p.sku, p.id]));

    const toCreate: { organizationId: string; sku: string; name: string; categoryId: string }[] = [];
    const toUpdate: { id: string; name: string }[] = [];

    for (const [sku, name] of bySku) {
      const existingId = existingBySku.get(sku);
      if (existingId) {
        toUpdate.push({ id: existingId, name });
      } else {
        toCreate.push({ organizationId, sku, name, categoryId });
      }
    }

    // Batch create in one query. Updates still need one query per row
    // (Prisma has no bulk-update-with-different-values-per-row), but we run
    // them concurrently in bounded chunks instead of one at a time.
    if (toCreate.length > 0) {
      await this.prisma.product.createMany({ data: toCreate, skipDuplicates: true });
    }

    const UPDATE_CHUNK_SIZE = 50;
    for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = toUpdate.slice(i, i + UPDATE_CHUNK_SIZE);
      await Promise.all(
        chunk.map((u) => this.prisma.product.update({ where: { id: u.id }, data: { name: u.name } })),
      );
    }

    // createMany doesn't return created rows, so re-fetch the complete
    // sku -> id map (pre-existing + just-created) for importStock to use.
    const allProducts = await this.prisma.product.findMany({
      where: { organizationId, sku: { in: skus } },
      select: { id: true, sku: true },
    });
    const productIdBySku = new Map(
      allProducts.filter((p) => p.sku != null).map((p) => [p.sku as string, p.id]),
    );

    console.log('[GdbImport] importItems done', { created: toCreate.length, updated: toUpdate.length });

    return {
      result: { created: toCreate.length, updated: toUpdate.length },
      productIdBySku,
      stockRows: rows,
    };
  }

  // -------------------------------------------------------------------------
  // ITEM.QUANTITY / WAREITEM -> Stock
  //
  // Different Accurate GDBs structure stock differently — some keep real
  // per-warehouse rows in WAREITEM (in which case ITEM.QUANTITY may be a
  // stale/aggregate figure), others (confirmed for this GDB) never populate
  // WAREITEM at all, in which case ITEM.QUANTITY is the authoritative
  // current stock. This checks WAREITEM per-file rather than hardcoding one
  // behavior for every GDB this importer will ever see.
  //
  // Idempotency: Stock.quantity is always SET (upsert with an absolute
  // value), never incremented, so re-importing the same GDB converges on
  // the same final quantity rather than compounding.
  // -------------------------------------------------------------------------

private async importStock(
  fbDb: Firebird.Database,
  organizationId: string,
  rows: { SKU: string; NAME: string; STOCK: number | null; WAREHOUSE_ID: number | null }[],
  productIdBySku: Map<string, string>,
) {
  const [wareItemCheck] = await fbQuery<{ CNT: number }>(
    fbDb,
    `SELECT COUNT(*) AS CNT FROM WAREITEM`,
  );
  const wareItemHasData = wareItemCheck.CNT > 0;
  if (wareItemHasData) {
    console.warn(
      '[GdbImport] WAREITEM has rows in this database — ITEM.QUANTITY may ' +
      'not be authoritative here. Proceeding with ITEM.QUANTITY anyway.',
    );
  }

  // Informational only — NOT used to route, split, or name anything right
  // now. Kept for future multi-warehouse support / diagnosing files where
  // ITEM.QUANTITY turns out to be per-warehouse after all.
  const warehouseCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.WAREHOUSE_ID == null ? 'NULL' : String(row.WAREHOUSE_ID);
    warehouseCounts.set(key, (warehouseCounts.get(key) ?? 0) + 1);
  }
  console.log(
    '[GdbImport] ITEM warehouse distribution (informational only, not used for routing or naming)',
    Object.fromEntries(warehouseCounts),
  );

  // Explicit for this import — the org's default WareSys Location, when it
  // needs to be auto-created, is always named "CENTRE". Not derived from
  // WAREHS or the warehouse-id distribution above.
  const DEFAULT_LOCATION_NAME = 'CENTRE';
  const defaultLocation = await this.resolveDefaultLocation(organizationId, DEFAULT_LOCATION_NAME);

  let written = 0;
  let skippedNoProduct = 0;
  const CONCURRENCY = 20;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (row) => {
        const sku = row.SKU?.trim();
        if (!sku) return;

        const productId = productIdBySku.get(sku);
        if (!productId) {
          skippedNoProduct++;
          return;
        }

        await this.prisma.stock.upsert({
          where: { productId_locationId: { productId, locationId: defaultLocation.id } },
          create: {
            organizationId,
            productId,
            locationId: defaultLocation.id,
            quantity: row.STOCK ?? 0,
          },
          update: { quantity: row.STOCK ?? 0 }, // absolute set, never increment -> idempotent
        });
        written++;
      }),
    );
  }

  console.log('[GdbImport] importStock done', {
    written,
    skippedNoProduct,
    wareItemHasData,
    defaultLocationId: defaultLocation.id,
    defaultLocationName: defaultLocation.name,
    defaultLocationCreated: defaultLocation.created,
  });

  return {
    written,
    skippedNoProduct,
    wareItemHasData,
    defaultLocation: {
      id: defaultLocation.id,
      name: defaultLocation.name,
      created: defaultLocation.created,
    },
    warehouseDistribution: Object.fromEntries(warehouseCounts), // informational only
  };
}  // -------------------------------------------------------------------------
  // PERSONDATA -> Customer (only rows referenced by ARINV.CUSTOMERID)
  // -------------------------------------------------------------------------

  private async importCustomers(
    fbDb: Firebird.Database,
    organizationId: string,
  ): Promise<Map<number, string>> {
    const rows = await fbQuery<{
      ID: number;
      NAME: string;
      PHONE: string | null;
      ADDRESSLINE1: string | null;
      ADDRESSLINE2: string | null;
    }>(
      fbDb,
      `
      SELECT DISTINCT pd.ID AS ID, pd.NAME AS NAME, pd.PHONE AS PHONE,
             pd.ADDRESSLINE1 AS ADDRESSLINE1, pd.ADDRESSLINE2 AS ADDRESSLINE2
      FROM PERSONDATA pd
      JOIN ARINV inv ON inv.CUSTOMERID = pd.ID
      `,
    );

    // Clean + dedupe by name first (name is the match key).
    const byName = new Map<string, { fbId: number; phone: string | null; address: string | null }>();
    for (const row of rows) {
      const name = row.NAME?.trim();
      if (!name) continue;
      const address = [row.ADDRESSLINE1, row.ADDRESSLINE2].filter(Boolean).join(', ') || null;
      byName.set(name, { fbId: row.ID, phone: row.PHONE?.trim() || null, address });
    }
    const names = [...byName.keys()];

    // One query for every existing customer by name, instead of one
    // findFirst per row.
    const existingCustomers = await this.prisma.customer.findMany({
      where: { organizationId, name: { in: names } },
      select: { id: true, name: true },
    });
    const existingByName = new Map(existingCustomers.map((c) => [c.name, c.id]));

    const toCreate = names
      .filter((name) => !existingByName.has(name))
      .map((name) => {
        const info = byName.get(name)!;
        return { organizationId, name, phone: info.phone, address: info.address };
      });

    if (toCreate.length > 0) {
      await this.prisma.customer.createMany({ data: toCreate, skipDuplicates: true });
    }

    // createMany doesn't return the created rows, so re-fetch by name to
    // pick up ids for the ones we just created (plus the pre-existing ones).
    const allCustomers = await this.prisma.customer.findMany({
      where: { organizationId, name: { in: names } },
      select: { id: true, name: true },
    });
    const idByName = new Map(allCustomers.map((c) => [c.name, c.id]));

    const idMap = new Map<number, string>();
    for (const [name, info] of byName) {
      const id = idByName.get(name);
      if (id) idMap.set(info.fbId, id);
    }

    console.log('[GdbImport] importCustomers done', { created: toCreate.length, total: idMap.size });

    return idMap;
  }

  // -------------------------------------------------------------------------
  // ARINV + ARINVDET -> Invoice + InvoiceItem
  //
  // KNOWN APPROXIMATIONS (surfaced in the return value, not hidden):
  //  - total copies ARINV.INVOICEAMOUNT directly.
  //  - taxAmount = TAX1AMOUNT + TAX2AMOUNT.
  //  - subtotal = TAXABLEAMOUNT1 + TAXABLEAMOUNT2 + TAXABLEAMOUNT3 (approximate).
  //  - lineTotal = quantity * unitPrice — does NOT apply ITEMDISCPC (per-line
  //    discount %); lines with a non-zero ITEMDISCPC are reported separately.
  //  - discount is left at 0 (TERMDISCOUNT/CASHDISCOUNT already reflected in
  //    INVOICEAMOUNT — applying again would double-count).
  //  - status is always ISSUED (no reliable "voided" signal in ARINV).
  //  - odometer/nextServiceKm are parsed from DESCRIPTION per-invoice — see
  //    parseVehicleDescription(). vehicleModel from the SAME description is
  //    stable vehicle info and goes on Vehicle instead (see
  //    resolveVehiclesForHeaders).
  // -------------------------------------------------------------------------

  private async importInvoices(
    fbDb: Firebird.Database,
    organizationId: string,
    customerIdMap: Map<number, string>,
    invoiceFormat: InvoiceFormat,
  ) {
    const headers = await fbQuery<{
      ARINVOICEID: number;
      EXTERNAL_INVOICE_NO: string;
      CUSTOMERID: number | null;
      CUSTOMER_NAME: string | null;
      DESCRIPTION: string | null; // source for plate/model/odometer parsing
      INVOICEDATE: Date | null;
      INVOICEAMOUNT: number | null;
      PAIDAMOUNT: number | null;
      TAX1AMOUNT: number | null;
      TAX2AMOUNT: number | null;
      TAXABLEAMOUNT1: number | null;
      TAXABLEAMOUNT2: number | null;
      TAXABLEAMOUNT3: number | null;
    }>(
      fbDb,
      `
      SELECT
        inv.ARINVOICEID AS ARINVOICEID,
        COALESCE(inv.INVOICENO, CAST(inv.ARINVOICEID AS VARCHAR(20))) AS EXTERNAL_INVOICE_NO,
        inv.CUSTOMERID AS CUSTOMERID,
        cust.NAME AS CUSTOMER_NAME,
        inv.DESCRIPTION AS DESCRIPTION,
        inv.INVOICEDATE AS INVOICEDATE,
        inv.INVOICEAMOUNT AS INVOICEAMOUNT,
        inv.PAIDAMOUNT AS PAIDAMOUNT,
        inv.TAX1AMOUNT AS TAX1AMOUNT,
        inv.TAX2AMOUNT AS TAX2AMOUNT,
        inv.TAXABLEAMOUNT1 AS TAXABLEAMOUNT1,
        inv.TAXABLEAMOUNT2 AS TAXABLEAMOUNT2,
        inv.TAXABLEAMOUNT3 AS TAXABLEAMOUNT3
      FROM ARINV inv
      LEFT JOIN PERSONDATA cust ON cust.ID = inv.CUSTOMERID
      ORDER BY inv.ARINVOICEID
      `,
    );

    const lines = await fbQuery<{
      ARINVOICEID: number;
      SEQ: number;
      SKU: string;
      QUANTITY: number;
      UNITPRICE: number;
      ITEMDISCPC: string | null;
    }>(
      fbDb,
      `SELECT ARINVOICEID, SEQ, ITEMNO AS SKU, QUANTITY, UNITPRICE, ITEMDISCPC FROM ARINVDET ORDER BY ARINVOICEID, SEQ`,
    );

    const linesByInvoice = new Map<number, typeof lines>();
    for (const line of lines) {
      const existing = linesByInvoice.get(line.ARINVOICEID) ?? [];
      existing.push(line);
      linesByInvoice.set(line.ARINVOICEID, existing);
    }

    // Parse each header's DESCRIPTION exactly once, reused by vehicle
    // resolution, invoice creation, and the odometer backfill/cache passes
    // below instead of re-parsing the same string repeatedly.
    const parsedByInvoiceId = new Map<number, ParsedVehicleDescription>();
    for (const header of headers) {
      parsedByInvoiceId.set(header.ARINVOICEID, parseVehicleDescription(header.DESCRIPTION));
    }

    let created = 0;
    let skipped = 0;
    let updated = 0;
    const errors: string[] = [];
    const fractionalQuantityWarnings: string[] = [];
    const discountIgnoredWarnings: string[] = [];

    // One query for every already-imported invoice number, instead of one
    // findFirst per header row (was up to thousands of sequential queries).
    const allInvoiceNumbers = headers.map((h) => h.EXTERNAL_INVOICE_NO);

    const existingInvoicesByNumber = new Map <
      string,
      { id: string; vehicleId: string | null; odometer: number | null; nextServiceKm: number | null }
    >();
    const INVOICE_LOOKUP_CHUNK_SIZE = 10_000;

    for (
      let i = 0;
      i < allInvoiceNumbers.length;
      i += INVOICE_LOOKUP_CHUNK_SIZE
    ) {
      const chunk = allInvoiceNumbers.slice(
        i,
        i + INVOICE_LOOKUP_CHUNK_SIZE,
      );

      const existingInvoices = await this.prisma.invoice.findMany({
        where: {
          organizationId,
          invoiceNumber: { in: chunk },
        },
        select: {
          id: true,
          invoiceNumber: true,
          vehicleId: true,
          odometer: true,
          nextServiceKm: true,
        },
      });

      for (const invoice of existingInvoices) {
        if (invoice.invoiceNumber) {
          existingInvoicesByNumber.set(invoice.invoiceNumber, {
            id: invoice.id,
            vehicleId: invoice.vehicleId,
            odometer: invoice.odometer,
            nextServiceKm: invoice.nextServiceKm,
          });
        }
      }
    }

    // One query for every product SKU referenced by any line, instead of a
    // findFirst per line item (previously nested inside a per-invoice
    // Promise.all — could easily be tens of thousands of queries total).
    const allSkus = [...new Set(lines.map((l) => l.SKU).filter(Boolean))];
    const products = await this.prisma.product.findMany({
      where: { organizationId, sku: { in: allSkus } },
      select: { id: true, sku: true },
    });
    const productIdBySku = new Map(products.map((p) => [p.sku, p.id]));

    // Resolve vehicles before the concurrent create loop below.
    const { vehicleIdByInvoiceId, stats: vehicleStats } = await this.resolveVehiclesForHeaders(
      headers,
      parsedByInvoiceId,
      customerIdMap,
      organizationId,
    );

    const buildInvoiceData = (header: (typeof headers)[number]) => {
      const invoiceNumber = header.EXTERNAL_INVOICE_NO;
      const itemLines = linesByInvoice.get(header.ARINVOICEID) ?? [];
      const customerId = header.CUSTOMERID != null ? customerIdMap.get(header.CUSTOMERID) ?? null : null;
      const vehicleId = vehicleIdByInvoiceId.get(header.ARINVOICEID) ?? null;
      const parsed = parsedByInvoiceId.get(header.ARINVOICEID) ?? null;

      const itemsData = itemLines
        .filter((line) => line.SKU && line.QUANTITY != null)
        .map((line) => {
          const rawQty = Number(line.QUANTITY);
          const roundedQty = Math.round(rawQty);
          if (Math.abs(rawQty - roundedQty) > 0.01) {
            fractionalQuantityWarnings.push(
              `Invoice ${invoiceNumber}, SKU ${line.SKU}: ${rawQty} rounded to ${roundedQty}`,
            );
          }

          const discPc = line.ITEMDISCPC ? parseFloat(line.ITEMDISCPC) : 0;
          if (discPc) {
            discountIgnoredWarnings.push(
              `Invoice ${invoiceNumber}, SKU ${line.SKU}: ${discPc}% line discount not applied to lineTotal`,
            );
          }

          const productId = productIdBySku.get(line.SKU) ?? null;
          const unitPrice = num(line.UNITPRICE);
          const lineTotal = roundedQty * unitPrice;

          return {
            productId,
            description: productId ? null : `Unmapped Accurate SKU: ${line.SKU}`,
            quantity: roundedQty,
            unitPrice: unitPrice.toString(),
            lineTotal: lineTotal.toString(),
            total: lineTotal.toString(),
          };
        });

      const invoiceAmount = num(header.INVOICEAMOUNT);
      const paidAmount = Math.round(num(header.PAIDAMOUNT));
      const taxAmount = num(header.TAX1AMOUNT) + num(header.TAX2AMOUNT);
      const subtotal = num(header.TAXABLEAMOUNT1) + num(header.TAXABLEAMOUNT2) + num(header.TAXABLEAMOUNT3);
      const paymentStatus: PaymentStatus =
        paidAmount <= 0
          ? PaymentStatus.UNPAID
          : paidAmount >= invoiceAmount
            ? PaymentStatus.PAID
            : PaymentStatus.PARTIAL;

      return {
        organizationId,
        invoiceNumber,
        format: invoiceFormat,
        status: InvoiceStatus.ISSUED,
        customerId,
        vehicleId,
        customerName: header.CUSTOMER_NAME ?? null,
        issuedAt: header.INVOICEDATE ?? undefined,
        amountPaid: paidAmount,
        paymentStatus,
        subtotal: subtotal.toString(),
        discount: '0',
        taxAmount: taxAmount.toString(),
        total: invoiceAmount.toString(),
        odometer: parsed?.odometer ?? null,
        nextServiceKm: parsed?.nextServiceKm ?? null,
        items: { create: itemsData },
      };
    };

    // Prisma has no bulk "create many rows each with their own nested
    // items" call, so each invoice still needs its own create — but we run
    // them concurrently in bounded chunks instead of one at a time, which
    // is the difference between minutes and seconds for large files.
    const CONCURRENCY = 20;

    for (let i = 0; i < headers.length; i += CONCURRENCY) {
      const chunk = headers.slice(i, i + CONCURRENCY);

      await Promise.all(
        chunk.map(async (header) => {
          const invoiceNumber = header.EXTERNAL_INVOICE_NO;

          try {
            const existingInvoice = existingInvoicesByNumber.get(invoiceNumber);
            const vehicleId = vehicleIdByInvoiceId.get(header.ARINVOICEID) ?? null;
            const parsed = parsedByInvoiceId.get(header.ARINVOICEID) ?? null;

            // Existing invoice: backfill vehicleId/odometer/nextServiceKm
            // if currently missing — covers re-imports of a GDB that now
            // includes KM data an earlier import predates.
            if (existingInvoice) {
              const patch: { vehicleId?: string; odometer?: number; nextServiceKm?: number } = {};
              if (!existingInvoice.vehicleId && vehicleId) patch.vehicleId = vehicleId;
              if (existingInvoice.odometer == null && parsed?.odometer != null) patch.odometer = parsed.odometer;
              if (existingInvoice.nextServiceKm == null && parsed?.nextServiceKm != null) {
                patch.nextServiceKm = parsed.nextServiceKm;
              }

              if (Object.keys(patch).length > 0) {
                await this.prisma.invoice.update({
                  where: { id: existingInvoice.id },
                  data: patch,
                });
                updated++;
              } else {
                skipped++;
              }

              return;
            }

            // New invoice: create it normally, including vehicleId/odometer/nextServiceKm.
            await this.prisma.invoice.create({
              data: buildInvoiceData(header),
            });

            created++;
          } catch (err: any) {
            errors.push(`Invoice ${invoiceNumber}: ${err.message}`);
          }
        }),
      );

      console.log('[GdbImport] importInvoices progress', {
        processed: Math.min(i + CONCURRENCY, headers.length),
        total: headers.length,
      });
    }

    // Refresh each vehicle's cached "current odometer" to the reading from
    // its most recently DATED invoice in this file (not just the last one
    // processed — headers are ordered by ARINVOICEID, not INVOICEDATE).
    // Vehicle.odometer is a denormalized cache for quick display; the
    // per-invoice Invoice.odometer values are the actual history.
    const latestOdometerByVehicleId = new Map<string, { odometer: number; issuedAt: Date }>();
    for (const header of headers) {
      const vehicleId = vehicleIdByInvoiceId.get(header.ARINVOICEID);
      const parsed = parsedByInvoiceId.get(header.ARINVOICEID);
      if (!vehicleId || parsed?.odometer == null || !header.INVOICEDATE) continue;

      const current = latestOdometerByVehicleId.get(vehicleId);
      if (!current || header.INVOICEDATE > current.issuedAt) {
        latestOdometerByVehicleId.set(vehicleId, { odometer: parsed.odometer, issuedAt: header.INVOICEDATE });
      }
    }

    let vehicleOdometerCacheUpdated = 0;
    for (const [vehicleId, { odometer }] of latestOdometerByVehicleId) {
      await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { odometer } });
      vehicleOdometerCacheUpdated++;
    }

    return {
      created,
      updated,
      skipped,
      errors,
      fractionalQuantityWarnings,
      discountIgnoredWarnings,
      invoicesScannedForVehicles: headers.length,
      vehicles: vehicleStats, // { descriptionsWithBp, vehiclesDetected, vehiclesCreated, duplicateVehicleRefsSkipped, ambiguousBpWarnings }
      vehicleOdometerCacheUpdated,
    };
  }

  // -------------------------------------------------------------------------
  // ARINV.DESCRIPTION -> Vehicle (plate + model ONLY — odometer/nextServiceKm
  // are per-invoice, handled by importInvoices/buildInvoiceData above)
  //
  // Runs BEFORE the concurrent invoice-creation loop, over headers only —
  // consistent with the existing idempotency model, where already-imported
  // invoices are never revisited for vehicle *creation* (they ARE revisited
  // for the odometer backfill above, which is a different, safe operation).
  // Vehicle resolution is batched (find-existing -> create-missing) rather
  // than done per-invoice, because the invoice loop below creates invoices
  // concurrently in chunks of 20 — resolving vehicles per-invoice there would
  // race two invoices for the same customer+plate into two separate vehicles.
  // -------------------------------------------------------------------------

  private async resolveVehiclesForHeaders(
    headers: {
      ARINVOICEID: number;
      EXTERNAL_INVOICE_NO: string;
      CUSTOMERID: number | null;
      DESCRIPTION: string | null;
    }[],
    parsedByInvoiceId: Map<number, ParsedVehicleDescription>,
    customerIdMap: Map<number, string>,
    organizationId: string,
  ) {
    interface Candidate {
      customerId: string;
      plate: string;
      vehicleModel: string | null;
    }

    const candidatesByKey = new Map<string, Candidate>(); // `${customerId}::${plate}`
    const vehicleKeyByInvoiceId = new Map<number, string>();

    let descriptionsWithBp = 0;
    let vehiclesDetected = 0;
    const ambiguousBpWarnings: string[] = [];

    for (const header of headers) {
      const desc = header.DESCRIPTION;
      if (!desc) continue;

      const hasBp = /BP/i.test(desc);
      if (hasBp) descriptionsWithBp++;

      const parsed = parsedByInvoiceId.get(header.ARINVOICEID);
      if (!parsed || !parsed.plate) {
        continue;
      }

      vehiclesDetected++;

      const prismaCustomerId =
        header.CUSTOMERID != null ? customerIdMap.get(header.CUSTOMERID) ?? null : null;

      if (!prismaCustomerId) {
        ambiguousBpWarnings.push(
          `Invoice ${header.EXTERNAL_INVOICE_NO}: plate "${parsed.plate}" detected but invoice has no mapped customer — vehicle not created`,
        );
        continue;
      }

      const key = `${prismaCustomerId}::${parsed.plate}`;
      vehicleKeyByInvoiceId.set(header.ARINVOICEID, key);

      const existing = candidatesByKey.get(key);
      if (!existing) {
        candidatesByKey.set(key, {
          customerId: prismaCustomerId,
          plate: parsed.plate,
          vehicleModel: parsed.vehicleModel,
        });
      } else if (!existing.vehicleModel && parsed.vehicleModel) {
        // Keep the first-seen candidate but backfill vehicleModel if an
        // earlier occurrence of this same customer+plate didn't have one.
        existing.vehicleModel = parsed.vehicleModel;
      }
    }

    const candidates = [...candidatesByKey.values()];

    if (candidates.length === 0) {
      return {
        vehicleIdByInvoiceId: new Map<number, string>(),
        stats: {
          descriptionsWithBp,
          vehiclesDetected: 0,
          vehiclesCreated: 0,
          duplicateVehicleRefsSkipped: 0,
          ambiguousBpWarnings,
        },
      };
    }

    const candidateCustomerIds = [...new Set(candidates.map((c) => c.customerId))];
    const candidatePlates = [...new Set(candidates.map((c) => c.plate))];

    const existingVehicles = await this.prisma.vehicle.findMany({
      where: {
        organizationId,
        customerId: { in: candidateCustomerIds },
        plateNumber: { in: candidatePlates },
      },
      select: { id: true, customerId: true, plateNumber: true, vehicleModel: true },
    });
    const existingByKey = new Map(
      existingVehicles.map((v) => [`${v.customerId}::${v.plateNumber}`, v]),
    );

    const toCreate = candidates
      .filter((c) => !existingByKey.has(`${c.customerId}::${c.plate}`))
      .map((c) => ({
        organizationId,
        customerId: c.customerId,
        plateNumber: c.plate,
        vehicleModel: c.vehicleModel ?? '',
      }));

    if (toCreate.length > 0) {
      await this.prisma.vehicle.createMany({ data: toCreate, skipDuplicates: true });
    }

    // Backfill vehicleModel on existing vehicles that don't have one yet —
    // same reasoning as the Invoice vehicleId backfill: a re-import of a
    // GDB that now yields a model where a prior import found none.
    for (const candidate of candidates) {
      const key = `${candidate.customerId}::${candidate.plate}`;
      const existing = existingByKey.get(key);
      if (existing && !existing.vehicleModel && candidate.vehicleModel) {
        await this.prisma.vehicle.update({
          where: { id: existing.id },
          data: { vehicleModel: candidate.vehicleModel },
        });
      }
    }

    // Re-fetch to build the complete key -> id map (pre-existing + just-created).
    const allVehicles = await this.prisma.vehicle.findMany({
      where: {
        organizationId,
        customerId: { in: candidateCustomerIds },
        plateNumber: { in: candidatePlates },
      },
      select: { id: true, customerId: true, plateNumber: true },
    });
    const vehicleIdByKey = new Map(
      allVehicles.map((v) => [`${v.customerId}::${v.plateNumber}`, v.id]),
    );

    const vehicleIdByInvoiceId = new Map<number, string>();
    for (const [invoiceId, key] of vehicleKeyByInvoiceId) {
      const vehicleId = vehicleIdByKey.get(key);
      if (vehicleId) vehicleIdByInvoiceId.set(invoiceId, vehicleId);
    }

    console.log('[GdbImport] resolveVehiclesForHeaders done', {
      candidates: candidates.length,
      created: toCreate.length,
    });

    return {
      vehicleIdByInvoiceId,
      stats: {
        descriptionsWithBp,
        vehiclesDetected,
        vehiclesCreated: toCreate.length,
        duplicateVehicleRefsSkipped: candidates.length - toCreate.length,
        ambiguousBpWarnings,
      },
    };
  }
}