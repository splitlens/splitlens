import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Transpile workspace packages so Next.js can use TypeScript sources directly.
  // We point @splitlens/core/db's package.json exports at src/*.ts (not dist/)
  // so dev never sees a stale compiled artifact.
  transpilePackages: ["@splitlens/core", "@splitlens/db"],
  // typedRoutes graduated from experimental in Next.js 15.5
  typedRoutes: true,
  webpack: (cfg) => {
    // The TS source uses NodeNext-style '.js' imports that resolve to '.ts'.
    // Tell webpack to honor that mapping when bundling workspace packages.
    cfg.resolve = cfg.resolve || {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return cfg;
  },
};

export default config;
