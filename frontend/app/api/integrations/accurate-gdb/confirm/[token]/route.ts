// The confirm step runs the whole Accurate import in one request, which can
// take minutes. Through the /api rewrite, Next gives up on it after 30s and
// answers 500 while the backend carries on and finishes the import. A route
// handler isn't bound by that proxy timeout (see lib/stream-proxy.ts); nginx's
// proxy_read_timeout (300s) is the limit here.
import { streamToBackend } from '@/lib/stream-proxy';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return streamToBackend(request, `/integrations/accurate-gdb/confirm/${encodeURIComponent(token)}`);
}
