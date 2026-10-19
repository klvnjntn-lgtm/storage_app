import type { NextConfig } from "next";

const backendUrl =
  process.env.BACKEND_URL || "http://localhost:3000";

const isDev = process.env.NODE_ENV === "development";

// The desktop app (desktop/) ships this frontend as a self-contained
// server.js. Image optimization is off there: it needs sharp's native
// binary for the target OS, and every image is a logo or a photo the
// backend has already compressed.
const isDesktopBuild = !!process.env.DESKTOP_BUILD;

// Content-Security-Policy for the app's pages. 'unsafe-inline' scripts are
// still needed (Next's inline bootstrap and the theme-init script in the
// root layout), so this mainly limits where code, frames and form posts
// can come from, rather than fully preventing injected inline script.
// No upgrade-insecure-requests: LAN installs are served over plain http.
// Google Maps (when a key is set) loads its script, tiles, fonts and
// workers from Google — the sources below are Google's documented CSP
// allowlist, including 'unsafe-eval'. Without a key, none of it is allowed.
const googleMaps = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const gm = (sources: string) => (googleMaps ? ` ${sources}` : "");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev || googleMaps ? " 'unsafe-eval'" : ""}${gm("blob: https://*.googleapis.com https://*.gstatic.com *.google.com https://*.ggpht.com *.googleusercontent.com")}`,
  `style-src 'self' 'unsafe-inline'${gm("https://fonts.googleapis.com")}`,
  // Map tiles and logos saved as absolute URLs.
  "img-src 'self' data: blob: https: http:",
  `font-src 'self' data:${gm("https://fonts.gstatic.com")}`,
  `connect-src 'self'${gm("https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:")}`,
  `worker-src 'self'${gm("blob:")}`,
  ...(googleMaps ? ["frame-src *.google.com"] : []),
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Print URLs carry a short-lived token in the query string; never send
  // full URLs to other sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drivers use the camera (proof photos) and location (GPS on delivery).
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
  // Ignored by browsers on plain-http LAN installs; applies on the HTTPS domain.
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(isDesktopBuild && {
    // Own build folder, so it never clobbers a dev or Docker build in .next.
    distDir: ".next-desktop",
    output: "standalone",
    outputFileTracingRoot: __dirname,
    images: { unoptimized: true },
  }),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Not on /api or /uploads: those responses come from the backend,
      // which sets its own headers (e.g. a sandbox CSP on uploaded files)
      // that this must not overwrite.
      {
        source: "/:path((?!api/|uploads/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
  experimental: {
    // Next keeps an in-memory copy of every body proxied through the /api
    // rewrite, up to this size. 15mb covers the largest regular upload (10MB
    // photos and spreadsheets). The 1GB+ Accurate GDB upload doesn't go
    // through the rewrite — it streams via app/api/integrations/accurate-gdb/
    // upload/route.ts — so this must not be raised for it again.
    proxyClientMaxBodySize: "15mb",
  },
  async rewrites() {
    return [
      {
        // Next checks rewrites before dynamic routes, so this would swallow
        // the long-running app/api/integrations/accurate-gdb/confirm/[token]
        // handler and cut the import off at the proxy timeout. Static route
        // handlers (the GDB upload) already win over rewrites.
        source: "/api/:path((?!integrations/accurate-gdb/confirm/).*)",
        destination: `${backendUrl}/:path`,
      },
      {
        source: "/uploads/:path*",
        destination: `${backendUrl}/uploads/:path*`,
      },
    ];
  },

  turbopack: {},
};

export default nextConfig;