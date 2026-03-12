/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/enrichment/:path*",
        destination: "http://localhost:8765/api/enrichment/:path*",
      },
    ];
  },
};

export default nextConfig;
