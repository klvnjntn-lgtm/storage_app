// app/(app)/sales/search/page.tsx
// The old Sales Search page was folded into /sales: Enter in its search box
// lists every match there, with the same type filter and paging. Kept as a
// redirect so bookmarks and old links still land somewhere useful.
import { redirect } from 'next/navigation';

export default async function SalesSearchRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; type?: string | string[] }>;
}) {
  const { q, type } = await searchParams;
  const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v)?.trim();
  const params = new URLSearchParams();
  if (first(q)) params.set('q', first(q)!);
  if (first(q) && first(type)) params.set('type', first(type)!);
  const qs = params.toString();
  redirect(qs ? `/sales?${qs}` : '/sales');
}
