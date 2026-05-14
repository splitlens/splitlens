# ADR-0002: Tech stack — Next.js + PGlite + TanStack + ECharts

**Status:** Accepted
**Date:** 2026-05-15
**Deciders:** Prateek Aryan
**Note:** License portion superseded by ADR-0005 (entire repo is AGPL-3.0)

## Context

Phase 1 is web-only. Phase 2 adds native mobile (iOS + Android). Need a stack that:

- Ships fast as a solo dev (15-30 hrs/week)
- Looks premium (competing on UX with established fintechs)
- Allows code reuse for Phase 2 mobile
- Operates entirely client-side (per ADR-0001)

## Decision

| Concern           | Choice                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| App framework     | **Next.js 15** (App Router, static export)                                        |
| Language          | **TypeScript strict**                                                             |
| Monorepo          | **Turborepo** + **pnpm**                                                          |
| UI primitives     | **shadcn/ui** + **Radix**                                                         |
| Styling           | **Tailwind 4**                                                                    |
| Charts            | **Apache ECharts** (sunburst), **Recharts** (simple), **Visx** (calendar heatmap) |
| Table             | **TanStack Table v8** + **TanStack Virtual**                                      |
| Database          | **PGlite** (Postgres-WASM in browser) → OPFS persistence                          |
| ORM               | **Drizzle**                                                                       |
| Analytics queries | **DuckDB-WASM**                                                                   |
| State             | **Zustand** + **TanStack Query**                                                  |
| Animation         | **Framer Motion 11**                                                              |
| PDF               | **PDF.js** in **Web Worker**                                                      |
| Forms/Validation  | **React Hook Form** + **Zod**                                                     |
| Encryption        | **Web Crypto API** + **argon2-browser**                                           |
| Testing           | **Vitest** + **Playwright** + **Storybook**                                       |
| Deploy            | **Cloudflare Pages** (static + edge)                                              |
| CI                | **GitHub Actions**                                                                |

## Why each pick (one-liners)

- **Next.js 15 (App Router)**: SSG marketing pages + SPA app shell, excellent ecosystem, static export to Cloudflare. Alternative Remix considered — smaller ecosystem.
- **shadcn/ui**: copy-paste primitives, you own the code, no upgrade lock-in. Used by Vercel, Cal, Linear-clones. Alternative MUI considered — heavier, less flexible.
- **Apache ECharts**: best interactive sunburst on the web, smooth slice-zoom animations Plotly can't do. Alternative Plotly considered — what current Streamlit dashboard uses; ECharts is significantly more polished.
- **TanStack Table**: cell range selection, virtual scroll, keyboard nav — what Linear/Notion are built on. Alternative AG Grid considered — heavier, licensing complications for OSS.
- **PGlite**: Postgres in WASM, ~3MB gzipped, persists in OPFS. Drop-in for Postgres syntax. Alternative SQLite-WASM considered — comparable, PGlite chosen for richer SQL features (window functions, JSON ops).
- **DuckDB-WASM**: sub-second analytics on 100K+ rows. Used in production by Mode, Hex, Evidence. Optional add-on for heavy aggregations.
- **Drizzle**: type-safe, lighter than Prisma, generates inspectable SQL. Schema-first approach.
- **Zustand + TanStack Query**: avoids Redux ceremony. Zustand for ephemeral UI state, TanStack Query for cached server data.
- **Framer Motion**: industry standard for React animation. Linear-grade transitions.
- **PDF.js in Web Worker**: battle-tested by Mozilla, runs off main thread so UI never freezes during a 20MB PDF parse.
- **Cloudflare Pages**: free tier generous, fast global CDN, no cold starts, GitHub integration. Alternative Vercel considered — comparable, Cloudflare slightly cheaper at scale.

## Consequences

### Positive

- **Single codebase deploys to web in Week 1**
- **Type-safe end-to-end** (Drizzle types flow through)
- **High performance** (Web Workers, virtual scroll, WASM-native SQL)
- **Reusable for mobile** — `packages/core` is framework-free, ports to React Native cleanly

### Negative

- **PGlite is young** (2024+) — minor risk of regressions; mitigated by fallback path to SQLite-WASM
- **DuckDB-WASM is 5MB** — only loaded on demand for heavy analytics
- **shadcn/ui isn't an npm package** — components live in our repo, security updates manual; this is by design

## Decisions deferred to Phase 2

- **Cross-platform UI library**: Tamagui vs separate native components — depends on how shadcn evolves and how much UI we want to share
- **Mobile shell**: Expo vs Capacitor vs Tauri Mobile — depends on which native APIs we need
- **Sync layer**: Replicache vs Electric SQL vs custom BYOC — depends on user demand signal post-launch
