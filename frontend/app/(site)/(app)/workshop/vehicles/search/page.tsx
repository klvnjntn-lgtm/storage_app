// app/(app)/workshop/vehicles/search/page.tsx
// The old Vehicle Lookup page was folded into /workshop/vehicles (search
// there, then open the vehicle's detail page for its history). Kept as a
// redirect so bookmarks and old links still land somewhere useful.
import { redirect } from 'next/navigation';

export default async function VehicleLookupRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const trimmed = (Array.isArray(q) ? q[0] : q)?.trim();
  redirect(trimmed ? `/workshop/vehicles?query=${encodeURIComponent(trimmed)}` : '/workshop/vehicles');
}
