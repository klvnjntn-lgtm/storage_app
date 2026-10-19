import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GDB_UPLOAD_DIR, GdbImportService } from './gdb-import.service';

describe('GDB upload sweep', () => {
  // The sweep only touches the filesystem, so no Nest module is needed.
  const service = Object.create(GdbImportService.prototype) as GdbImportService;
  const made: string[] = [];

  function file(name: string, ageMinutes: number) {
    const path = join(GDB_UPLOAD_DIR, name);
    writeFileSync(path, 'x');
    const t = (Date.now() - ageMinutes * 60_000) / 1000;
    utimesSync(path, t, t);
    made.push(path);
    return path;
  }

  beforeAll(() => mkdirSync(GDB_UPLOAD_DIR, { recursive: true }));
  afterAll(() => made.forEach((p) => rmSync(p, { force: true })));

  it('removes uploads past the TTL and keeps live ones and other files', async () => {
    const stale = file(`${randomUUID()}.gdb`, 45);
    const live = file(`${randomUUID()}.gdb`, 5);
    const other = file(`${randomUUID()}.txt`, 45);

    await service.sweepStaleUploads();

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });
});
