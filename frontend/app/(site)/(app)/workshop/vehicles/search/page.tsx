import { redirect } from 'next/navigation';

// Vehicle Lookup was merged into the Vehicles list (search + Enter opens a
// car). Kept as a redirect so bookmarks and old links still land there.
export default async function VehicleLookupRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  redirect(q?.trim() ? `/workshop/vehicles?query=${encodeURIComponent(q.trim())}` : '/workshop/vehicles');
}
