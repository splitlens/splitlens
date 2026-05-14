import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Transpile workspace packages so Next.js can use TypeScript sources directly
  transpilePackages: ["@splitlens/core", "@splitlens/db"],
  // typedRoutes graduated from experimental in Next.js 15.5
  typedRoutes: true,
};

export default config;
