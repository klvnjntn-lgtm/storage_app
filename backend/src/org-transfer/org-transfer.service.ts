// Moves one organization — every row that belongs to it, plus the uploaded
// files those rows point at — between WareSys installs: web to desktop and
// back. The file format is in transfer-container.ts.
//
// Which rows belong to an organization is worked out from the Prisma schema
// (see buildPlan), so tables added later are covered without touching this
// file. Ids are kept as they are, so references stored as plain text (links
// in notifications, ids in activity metadata) stay valid; only the
// autoincrement Int ids are renumbered on import, with every foreign key
// that points at them.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ModuleKey, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createReadStream, existsSync, promises as fs, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { uploadsRoot } from '../storage/local-file-storage';
import { assertValidKey } from '../storage/file-storage.interface';
import { LicenseService } from '../license/license.service';
import { autoEnabledModules } from '../auth/auth.service';
import {
  ContainerError,
  ExportHeader,
  Entry,
  MIN_PASSWORD_LENGTH,
  readContainer,
  readHeader,
  writeContainer,
} from './transfer-container';

type Row = Record<string, unknown>;
type Field = Prisma.DMMF.Field;
type Delegate = {
  findMany(args: object): Promise<Row[]>;
  createMany(args: { data: Row[] }): Promise<unknown>;
  update(args: object): Promise<unknown>;
};
type Client = Prisma.TransactionClient | PrismaService;

type ForeignKey = { field: string; target: string; required: boolean };

type ModelPlan = {
  name: string;
  table: string;
  delegate: string;
  idFields: string[]; // primary key (one field, or a compound key)
  intId: boolean; // autoincrement Int id, renumbered on import
  scalars: Field[];
  fks: ForeignKey[];
  // Prisma `where` selecting the rows of one organization.
  scope: (organizationId: string) => Row;
  // The organization id column, on models that have one.
  orgField: string | null;
  // Foreign keys inserted as null, then set once every row exists (self
  // references and cycles).
  deferred: string[];
};

// Global tables, and per-org rows that only mean something on the install
// that made them: module grants (set by the platform console, or by the
// desktop app's license) and browser push subscriptions (tied to that
// server's VAPID keys).
const SKIPPED_MODELS = new Set([
  'Installation',
  'License',
  'PlatformAuditLog',
  'OrganizationModule',
  'PushSubscription',
]);

// Columns left out of an export: what belongs to the source install
// (billing set by its platform console) and live secrets (sessions, reset
// tokens, one-time codes). The target's defaults apply instead.
export const STRIPPED_FIELDS: Record<string, string[]> = {
  Organization: [
    'plan',
    'seatLimit',
    'paidUntil',
    'billingNote',
    'suspendedAt',
    'suspendedReason',
  ],
  User: [
    'resetToken',
    'resetTokenExpires',
    'changePasswordOtpHash',
    'changePasswordOtpExpires',
    'changePasswordOtpAttempts',
    'pendingPasswordHash',
    'currentSessionId',
    'isPlatformOwner',
    'platformOtpHash',
    'platformOtpExpires',
    'platformOtpAttempts',
    'platformUnlockSessionId',
    'platformUnlockedUntil',
  ],
};

// "/uploads/media/x.webp" (stored URLs) or "delivery-proofs/…/x.webp"
// (stored storage keys) → the storage key, if that file exists.
function uploadKey(value: string): string | null {
  const at = value.indexOf('/uploads/');
  const key = (at >= 0 ? value.slice(at + '/uploads/'.length) : value).split(
    /[?#]/,
  )[0];
  if (!key.includes('/') || /\s/.test(key) || !/\.[a-z0-9]{2,5}$/i.test(key))
    return null;
  try {
    assertValidKey(key);
  } catch {
    return null;
  }
  return existsSync(join(uploadsRoot(), ...key.split('/'))) ? key : null;
}

// An id value (String or Int column) as a map/set key.
const idKey = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function buildPlan(): ModelPlan[] {
  const models = Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((m) => [m.name, m]));
  const owning = (m: Prisma.DMMF.Model) =>
    m.fields.filter(
      (f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0,
    );
  const isRequired = (m: Prisma.DMMF.Model, f: Field) =>
    (f.relationFromFields ?? []).every(
      (n) => m.fields.find((x) => x.name === n)?.isRequired,
    );

  // How each model reaches its organization: directly (organizationId),
  // else through the shortest chain of relations, preferring required ones.
  const paths = new Map<string, string[]>([['Organization', []]]);
  for (const m of models) {
    if (owning(m).some((f) => f.type === 'Organization'))
      paths.set(m.name, ['@org']);
  }
  for (const requiredOnly of [true, false]) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of models) {
        if (paths.has(m.name)) continue;
        const via = owning(m).find(
          (f) =>
            paths.has(f.type) &&
            f.type !== m.name &&
            (!requiredOnly || isRequired(m, f)),
        );
        if (via) {
          paths.set(m.name, [via.name, ...paths.get(via.type)!]);
          changed = true;
        }
      }
    }
  }

  const plans = new Map<string, Omit<ModelPlan, 'deferred'>>();
  for (const m of models) {
    if (SKIPPED_MODELS.has(m.name)) continue;
    const path = paths.get(m.name);
    if (!path)
      throw new Error(
        `Model ${m.name} has no link to Organization: add it to SKIPPED_MODELS or link it`,
      );
    const idField = m.fields.find((f) => f.isId);
    const idFields = idField
      ? [idField.name]
      : [...(m.primaryKey?.fields ?? [])];
    if (!idFields.length) throw new Error(`Model ${m.name} has no primary key`);
    // The column holding the organization id, on this model (direct) or
    // on the last model of its chain.
    const orgField = (model: Prisma.DMMF.Model) =>
      owning(model).find((f) => f.type === 'Organization')!
        .relationFromFields![0];
    let last = m;
    for (const rel of path.filter((p) => p !== '@org')) {
      last = byName.get(last.fields.find((f) => f.name === rel)!.type)!;
    }
    const lastOrgField = m.name === 'Organization' ? 'id' : orgField(last);
    const scope = (organizationId: string): Row => {
      let where: Row = { [lastOrgField]: organizationId };
      for (const rel of path.filter((p) => p !== '@org').reverse())
        where = { [rel]: where };
      return where;
    };
    plans.set(m.name, {
      name: m.name,
      table: m.dbName ?? m.name,
      delegate: lowerFirst(m.name),
      idFields,
      intId:
        idField?.type === 'Int' &&
        (idField.default as { name?: string } | undefined)?.name ===
          'autoincrement',
      scalars: m.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum'),
      fks: owning(m)
        .filter((f) => !SKIPPED_MODELS.has(f.type))
        .flatMap((f) => {
          const target = byName.get(f.type)!;
          const targetId = target.fields.find((x) => x.isId)?.name;
          // Tenant-safe composite keys — (customerId, organizationId) →
          // Customer(id, organizationId) — also carry the organization
          // column, which an import keeps as it is: only the id pair is a
          // reference to follow.
          return f.relationFromFields!.flatMap((from, i) => {
            const to = f.relationToFields![i];
            if (to === targetId) {
              return [
                {
                  field: from,
                  target: f.type,
                  required: !!m.fields.find((x) => x.name === from)?.isRequired,
                },
              ];
            }
            if (to === 'organizationId' && from === 'organizationId') return [];
            throw new Error(
              `${m.name}.${f.name} references ${f.type}.${to}; not supported`,
            );
          });
        }),
      scope,
      orgField: path[0] === '@org' ? orgField(m) : null,
    });
  }

  // Insert order: a model after every model its foreign keys point at.
  // Where optional keys form a cycle, one model goes first with only its
  // required keys satisfied; its other keys (and self references) are
  // deferred: inserted as null, set once every row exists.
  const order: string[] = [];
  const pending = new Set(plans.keys());
  const waitsOn = (n: string, requiredOnly: boolean) =>
    plans
      .get(n)!
      .fks.some(
        (fk) =>
          (!requiredOnly || fk.required) &&
          fk.target !== n &&
          pending.has(fk.target),
      );
  while (pending.size) {
    let ready = [...pending].filter((n) => !waitsOn(n, false)).sort();
    if (!ready.length) {
      const breaker = [...pending].sort().find((n) => !waitsOn(n, true));
      if (!breaker)
        throw new Error(
          `Required foreign keys form a cycle: ${[...pending].join(', ')}`,
        );
      ready = [breaker];
    }
    for (const n of ready) {
      order.push(n);
      pending.delete(n);
    }
  }
  return order.map((n) => {
    const p = plans.get(n)!;
    const before = new Set(order.slice(0, order.indexOf(n)));
    const deferred = p.fks
      .filter((fk) => !before.has(fk.target))
      .map((fk) => fk.field);
    for (const fk of p.fks) {
      if (deferred.includes(fk.field) && fk.required) {
        throw new Error(
          `${n}.${fk.field} is required but can't be inserted in order`,
        );
      }
    }
    if (deferred.length && p.idFields.length !== 1)
      throw new Error(`${n} needs deferred keys but has a compound id`);
    return { ...p, deferred };
  });
}

function serialize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  return value;
}

function deserialize(field: Field, value: unknown): unknown {
  if (value === null || value === undefined) {
    return field.type === 'Json' && value === null ? Prisma.DbNull : value;
  }
  if (field.type === 'DateTime')
    return field.isList
      ? (value as string[]).map((v) => new Date(v))
      : new Date(value as string);
  return value;
}

export type ImportResult = {
  organizationId: string;
  name: string;
  rows: number;
  files: number;
};

@Injectable()
export class OrgTransferService {
  private readonly logger = new Logger(OrgTransferService.name);
  private plan: ModelPlan[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  private getPlan(): ModelPlan[] {
    return (this.plan ??= buildPlan());
  }

  private async latestMigration(client: Client): Promise<string> {
    const rows = await client.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC LIMIT 1`;
    return rows[0]?.migration_name ?? '';
  }

  // Writes the organization's export to a temp file and returns its path;
  // the caller sends it and deletes it.
  async export(
    organizationId: string,
    password: string,
  ): Promise<{ file: string; filename: string }> {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `The export password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    const plan = this.getPlan();
    const data = new Map<string, Buffer>();
    const files = new Set<string>();
    let orgName = '';
    let migration = '';

    // One snapshot for every table, so the export is consistent while the
    // business keeps working.
    await this.prisma.$transaction(
      async (tx) => {
        migration = await this.latestMigration(tx);
        for (const model of plan) {
          const delegate = (tx as unknown as Record<string, Delegate>)[
            model.delegate
          ];
          const stripped = new Set(STRIPPED_FIELDS[model.name] ?? []);
          const fields = model.scalars.filter((f) => !stripped.has(f.name));
          const select = Object.fromEntries(fields.map((f) => [f.name, true]));
          const lines: string[] = [];
          for (let skip = 0; ; skip += 2000) {
            const rows = await delegate.findMany({
              where: model.scope(organizationId),
              select,
              orderBy: model.idFields.map((f) => ({ [f]: 'asc' })),
              skip,
              take: 2000,
            });
            for (const row of rows) {
              const out: Row = {};
              for (const f of fields) {
                const v = serialize(row[f.name]);
                out[f.name] = v;
                if (f.type === 'String' && typeof v === 'string') {
                  const key = uploadKey(v);
                  if (key) files.add(key);
                }
              }
              if (model.name === 'Organization') orgName = String(row.name);
              lines.push(JSON.stringify(out));
            }
            if (rows.length < 2000) break;
          }
          if (lines.length)
            data.set(model.name, Buffer.from(`${lines.join('\n')}\n`));
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 10 * 60_000,
        maxWait: 30_000,
      },
    );
    if (!orgName) throw new BadRequestException('Organization not found');

    const file = join(tmpdir(), `waresys-export-${randomUUID()}.wsexport`);
    function* entries(): Iterable<Entry> {
      const manifest = {
        organizationId,
        counts: Object.fromEntries(
          [...data].map(([k, v]) => [k, v.toString().split('\n').length - 1]),
        ),
      };
      const m = Buffer.from(JSON.stringify(manifest));
      yield { name: 'manifest.json', data: m, size: m.length };
      for (const [name, buf] of data)
        yield { name: `data/${name}.jsonl`, data: buf, size: buf.length };
      for (const key of files) {
        const path = join(uploadsRoot(), ...key.split('/'));
        let size: number;
        try {
          size = statSync(path).size;
        } catch {
          continue; // deleted since the scan
        }
        yield {
          name: `files/${key}`,
          size,
          data: () => createReadStream(path) as AsyncIterable<Buffer>,
        };
      }
    }
    try {
      await writeContainer(
        file,
        {
          createdAt: new Date().toISOString(),
          organizationName: orgName,
          migration,
        },
        password,
        entries(),
      );
    } catch (err) {
      await fs.rm(file, { force: true });
      throw err;
    }
    const safeName =
      orgName.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'business';
    return {
      file,
      filename: `${safeName}-${new Date().toISOString().slice(0, 10)}.wsexport`,
    };
  }

  // Imports an export as a new organization on this install. Nothing is
  // written unless all of it fits: one transaction for the rows, and the
  // files are only moved into place after it commits.
  async import(file: string, password: string): Promise<ImportResult> {
    // Checked again inside the transaction; this just answers before the
    // whole file has been decrypted.
    if (
      process.env.SINGLE_ORGANIZATION === 'true' &&
      (await this.prisma.organization.count()) > 0
    ) {
      throw new ConflictException(
        'This WareSys install already has a business registered',
      );
    }
    let header: ExportHeader;
    try {
      header = (await readHeader(file)).header;
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const migration = await this.latestMigration(this.prisma);
    if (header.migration !== migration) {
      throw new BadRequestException(
        'This export was made by a different WareSys version. Update both installs to the same version, then export again.',
      );
    }

    const plan = this.getPlan();
    const byName = new Map(plan.map((p) => [p.name, p]));
    const rows = new Map<string, Row[]>();
    const staging = await fs.mkdtemp(join(tmpdir(), 'waresys-import-'));
    const stagedFiles: string[] = [];
    try {
      try {
        await readContainer(file, password, async (name, data) => {
          if (name.startsWith('data/') && name.endsWith('.jsonl')) {
            const model = name.slice(5, -6);
            if (!byName.has(model))
              throw new ContainerError(
                `This export has data this WareSys version doesn't know (${model}).`,
              );
            rows.set(
              model,
              data
                .toString()
                .split('\n')
                .filter(Boolean)
                .map((l) => JSON.parse(l) as Row),
            );
          } else if (name.startsWith('files/')) {
            const key = name.slice(6);
            assertValidKey(key);
            const dest = join(staging, ...key.split('/'));
            await fs.mkdir(dirname(dest), { recursive: true });
            await fs.writeFile(dest, data);
            stagedFiles.push(key);
          }
        });
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : String(err),
        );
      }

      const orgs = rows.get('Organization') ?? [];
      if (orgs.length !== 1)
        throw new BadRequestException(
          'This export does not contain exactly one business.',
        );
      const org = orgs[0];
      const organizationId = String(org.id);
      this.validateOwnership(plan, rows, organizationId);
      await this.assertNoConflicts(rows, organizationId);

      let total = 0;
      await this.prisma.$transaction(
        async (tx) => {
          if (
            process.env.SINGLE_ORGANIZATION === 'true' &&
            (await tx.organization.count()) > 0
          ) {
            throw new ConflictException(
              'This WareSys install already has a business registered',
            );
          }
          total = await this.insertAll(tx, plan, rows);
          // The desktop app: its modules and seats come from its own
          // license, as for a newly registered business.
          if (process.env.SINGLE_ORGANIZATION === 'true') {
            const modules = autoEnabledModules();
            if (modules.length) {
              await tx.organizationModule.createMany({
                data: modules.map((module: ModuleKey) => ({
                  organizationId,
                  module,
                  enabled: true,
                })),
              });
            }
            const seats = this.license.licensedSeats();
            if (seats)
              await tx.organization.update({
                where: { id: organizationId },
                data: { seatLimit: seats },
              });
          }
        },
        { timeout: 10 * 60_000, maxWait: 30_000 },
      );

      // Rows are in; now the files. An existing file with the same key is
      // left alone (keys are random, so it's the same file).
      let files = 0;
      for (const key of stagedFiles) {
        const dest = join(uploadsRoot(), ...key.split('/'));
        if (existsSync(dest)) continue;
        await fs.mkdir(dirname(dest), { recursive: true });
        await fs.copyFile(join(staging, ...key.split('/')), dest);
        files++;
      }
      this.logger.log(
        `Imported organization ${organizationId}: ${total} rows, ${files} files`,
      );
      return { organizationId, name: String(org.name), rows: total, files };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  // An export is only trusted to describe one organization: every row must
  // belong to it, and every foreign key must point inside the export — so a
  // crafted file can't attach rows to another business on this install.
  private validateOwnership(
    plan: ModelPlan[],
    rows: Map<string, Row[]>,
    organizationId: string,
  ) {
    const ids = new Map<string, Set<string>>();
    for (const p of plan) {
      if (p.idFields.length === 1)
        ids.set(
          p.name,
          new Set((rows.get(p.name) ?? []).map((r) => idKey(r[p.idFields[0]]))),
        );
    }
    for (const p of plan) {
      for (const row of rows.get(p.name) ?? []) {
        const owner =
          p.name === 'Organization'
            ? row.id
            : p.orgField
              ? row[p.orgField]
              : null;
        if (owner !== null && owner !== undefined && owner !== organizationId) {
          throw new BadRequestException(
            `The export contains data of another business (${p.name}).`,
          );
        }
        for (const fk of p.fks) {
          const v = row[fk.field];
          if (v === null || v === undefined) continue;
          if (!ids.get(fk.target)?.has(idKey(v))) {
            if (fk.required)
              throw new BadRequestException(
                `The export is incomplete: ${p.name}.${fk.field} points at a missing ${fk.target}.`,
              );
            row[fk.field] = null; // e.g. a link to a row of another business on the source
          }
        }
      }
    }
  }

  private async assertNoConflicts(
    rows: Map<string, Row[]>,
    organizationId: string,
  ) {
    if (
      await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      })
    ) {
      throw new ConflictException(
        'This business already exists on this WareSys install.',
      );
    }
    const emails = (rows.get('User') ?? []).map((u) =>
      String(u.email).toLowerCase(),
    );
    const taken = await this.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    if (taken.length) {
      throw new ConflictException(
        `These user emails are already used on this WareSys install: ${taken.map((u) => u.email).join(', ')}. Change them on one side first.`,
      );
    }
  }

  private async insertAll(
    tx: Prisma.TransactionClient,
    plan: ModelPlan[],
    rows: Map<string, Row[]>,
  ): Promise<number> {
    // New numbers for autoincrement ids, from this database's sequences.
    const intIds = new Map<string, Map<number, number>>();
    for (const p of plan) {
      const list = rows.get(p.name) ?? [];
      if (!p.intId || !list.length) continue;
      const fresh = await tx.$queryRawUnsafe<{ id: number }[]>(
        `SELECT nextval(pg_get_serial_sequence('"${p.table}"', 'id'))::int AS id FROM generate_series(1, $1)`,
        list.length,
      );
      intIds.set(
        p.name,
        new Map(list.map((r, i) => [Number(r.id), fresh[i].id])),
      );
    }
    const remap = (target: string, v: unknown) => {
      const map = intIds.get(target);
      if (!map || v === null || v === undefined) return v;
      const mapped = map.get(Number(v));
      if (mapped === undefined)
        throw new BadRequestException(
          `The export is incomplete: missing ${target} ${idKey(v)}.`,
        );
      return mapped;
    };

    let total = 0;
    const later: { model: ModelPlan; id: unknown; data: Row }[] = [];
    for (const p of plan) {
      const list = rows.get(p.name) ?? [];
      if (!list.length) continue;
      const fieldByName = new Map(p.scalars.map((f) => [f.name, f]));
      const data = list.map((row) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(row)) {
          const field = fieldByName.get(k);
          if (!field)
            throw new BadRequestException(
              `The export has a column this WareSys version doesn't know (${p.name}.${k}).`,
            );
          out[k] = deserialize(field, v);
        }
        if (p.intId) out.id = remap(p.name, row.id);
        const deferredData: Row = {};
        for (const fk of p.fks) {
          if (!(fk.field in out)) continue;
          out[fk.field] = remap(fk.target, out[fk.field]);
          if (p.deferred.includes(fk.field) && out[fk.field] != null) {
            deferredData[fk.field] = out[fk.field];
            out[fk.field] = null;
          }
        }
        if (Object.keys(deferredData).length)
          later.push({ model: p, id: out[p.idFields[0]], data: deferredData });
        return out;
      });
      const delegate = (tx as unknown as Record<string, Delegate>)[p.delegate];
      for (let i = 0; i < data.length; i += 1000)
        await delegate.createMany({ data: data.slice(i, i + 1000) });
      total += data.length;
    }
    for (const { model, id, data } of later) {
      await (tx as unknown as Record<string, Delegate>)[model.delegate].update({
        where: { [model.idFields[0]]: id },
        data,
      });
    }
    return total;
  }
}
