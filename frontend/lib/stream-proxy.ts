// Streams a large upload straight through to the backend.
//
// Every other /api call goes through the rewrite in next.config.ts, and for
// those Next keeps an in-memory copy of the request body up to
// experimental.proxyClientMaxBodySize (15mb). A route handler takes
// precedence over that rewrite and passes the body along as a stream, so
// the global limit can stay small. Used for the Accurate GDB upload and
// .wsexport imports.
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

export async function streamToBackend(request: Request, backendPath: string): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(`${BACKEND_URL}${backendPath}`, {
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
