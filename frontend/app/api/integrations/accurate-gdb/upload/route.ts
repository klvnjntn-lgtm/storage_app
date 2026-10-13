// Streams Accurate GDB uploads (400MB–1.2GB) straight through to the backend
// (see lib/stream-proxy.ts). This used to be the reason the global
// proxyClientMaxBodySize was 1200mb, which let anyone — signed in or not —
// make the frontend hold 1.2GB of RAM per request on any /api path.
import { streamToBackend } from '@/lib/stream-proxy';

export function POST(request: Request) {
  return streamToBackend(request, '/integrations/accurate-gdb/upload');
}
