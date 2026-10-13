// Platform console: importing a business from a .wsexport (can be large: it
// carries uploaded photos). See lib/stream-proxy.ts.
import { streamToBackend } from '@/lib/stream-proxy';

export function POST(request: Request) {
  return streamToBackend(request, '/platform/organizations/import');
}
