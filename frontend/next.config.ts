import type { NextConfig } from "next";

const backendUrl =
  process.env.BACKEND_URL || "http://localhost:3000";

const nextConfig: NextConfig = {
experimental: {
  proxyClientMaxBodySize: "1200mb",
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