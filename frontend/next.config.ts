import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL ?? "http://localhost:8000";
const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "AI-Sales-Automation-Multi-Skill-Virtual-Assistant";
const pagesPath = `/${repositoryName}`;

const serverConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

const pagesConfig: NextConfig = {
  output: "export",
  basePath: pagesPath,
  assetPrefix: pagesPath,
  trailingSlash: true,
  images: { unoptimized: true },
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isGitHubPages ? pagesConfig : serverConfig),
};

export default nextConfig;