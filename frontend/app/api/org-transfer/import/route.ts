// Desktop app's first-launch import of a .wsexport (can be large: it
// carries uploaded photos). See lib/stream-proxy.ts.
import { streamToBackend } from '@/lib/stream-proxy';

export function POST(request: Request) {
  return streamToBackend(request, '/org-transfer/import');
}
