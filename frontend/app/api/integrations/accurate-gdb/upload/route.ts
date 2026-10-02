// Streams Accurate GDB uploads (400MB–1.2GB) straight through to the backend.
//
// Every other /api call goes through the rewrite in next.config.ts, and for
// those Next keeps an in-memory copy of the request body up to
// experimental.proxyClientMaxBodySize. That limit used to be raised to
// 1200mb for this one upload, which let anyone — signed in or not — make the
// frontend hold 1.2GB of RAM per request on any /api path. A route handler
// takes precedence over that rewrite and passes the body along as a stream,
// so the global limit can stay small.
const BACKEND_URL =
  process.env.INTERNAL_API_URL ?? process.env.BACKEND_URL ?? 'http://localhost:3000';

// Request headers the backend needs: the session (cookie or bearer), the
// CSRF and device headers, the multipart boundary, and the client address
// for rate limiting.
const FORWARDED_HEADERS = [
  'cookie',
  'authorization',
  'content-type',
  'content-length',
  'x-requested-with',
  'x-device-id',
  'user-agent',
  'x-forwarded-for',
  'x-forwarded-proto',
];

export async function POST(request: Request) {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(`${BACKEND_URL}/integrations/accurate-gdb/upload`, {
    method: 'POST',
    headers,
    body: request.body,
    // Required by Node's fetch to send a streamed request body.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
