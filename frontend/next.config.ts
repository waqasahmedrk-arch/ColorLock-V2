import type { NextConfig } from "next";

const config: NextConfig = {
  // The admin site (scripts/dev-admin.mjs) builds into .next-admin, so it can run beside the user site.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
