import { apiFetch } from '@/lib/apifetch';

// For a select that must offer every row of a paginated list endpoint
// ({ data, total }): one fixed page silently dropped rows past it. Pages
// through at the server's max page size; MAX_PAGES is only a runaway stop.
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await apiFetch(`${path}${sep}page=${page}&pageSize=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const body: { data: T[]; total: number } = await res.json();
    rows.push(...body.data);
    if (body.data.length < PAGE_SIZE || rows.length >= body.total) break;
  }
  return rows;
}
