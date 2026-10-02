import type { NextConfig } from "next";

const backendUrl =
  process.env.BACKEND_URL || "http://localhost:3000";

const isDev = process.env.NODE_ENV === "development";

// Content-Security-Policy for the app's pages. 'unsafe-inline' scripts are
// still needed (Next's inline bootstrap and the theme-init script in the
// root layout), so this mainly limits where code, frames and form posts
// can come from, rather than fully preventing injected inline script.
// No upgrade-insecure-requests: LAN installs are served over plain http.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Map tiles (OpenStreetMap) and logos saved as absolute URLs.
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
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
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
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