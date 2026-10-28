// scripts/gdb-backfill-staff.ts
//
// Fills in salespeople and mechanics on invoices already imported from an
// Accurate GDB — see GdbImportService.backfillStaff. Dry run by default:
// prints what the file holds and changes nothing.
//
// The path is as the Firebird server sees it (e.g. /tmp/gdb-imports/x.gdb
// in docker-compose). Usage:
//   node dist/src/scripts/gdb-backfill-staff.js <organizationId> <gdbPath>          # dry run
//   node dist/src/scripts/gdb-backfill-staff.js <organizationId> <gdbPath> --apply

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { GdbImportModule } from '../gdb-import/gdb-import.module';
import { GdbImportService } from '../gdb-import/gdb-import.service';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [organizationId, gdbPath] = args.filter((a) => !a.startsWith('--'));
  if (!organizationId || !gdbPath) {
    console.error('Usage: gdb-backfill-staff <organizationId> <gdbPath> [--apply]');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(GdbImportModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(GdbImportService).backfillStaff(gdbPath, organizationId, { apply });
    console.log(JSON.stringify(result, null, 2));
    if (!apply) console.log('Dry run — rerun with --apply.');
  } finally {
    await app.close();
  }
}

// Explicit exit: the import module's upload sweeper keeps a timer alive.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
