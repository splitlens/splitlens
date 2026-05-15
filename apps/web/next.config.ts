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
  // better-sqlite3 is a native module — Next.js must NOT try to bundle it.
  // Server Components / Route Handlers import it through @splitlens/db.
  serverExternalPackages: ["better-sqlite3"],
  webpack: (cfg, { isServer }) => {
    // The TS source uses NodeNext-style '.js' imports that resolve to '.ts'.
    // Tell webpack to honor that mapping when bundling workspace packages.
    cfg.resolve = cfg.resolve || {};
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    // Native modules — keep them as runtime requires; don't try to bundle.
    // serverExternalPackages handles top-level imports, but transpilePackages
    // can re-introduce these as inner imports of @splitlens/db, so spell them
    // out explicitly here too.
    if (isServer) {
      const ext = Array.isArray(cfg.externals) ? cfg.externals : [];
      cfg.externals = [
        ...ext,
        { "better-sqlite3": "commonjs better-sqlite3" },
        { bindings: "commonjs bindings" },
      ];
    }
    return cfg;
  },
};

export default config;
