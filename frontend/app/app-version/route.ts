// Which frontend is running: a new value on every deploy (the server
// restarts with the new build). Pages left open on a phone compare it with
// the one they were loaded from — see useReloadOnNewVersion.
const VERSION = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function GET() {
  return Response.json({ version: VERSION }, { headers: { 'Cache-Control': 'no-store' } });
}
