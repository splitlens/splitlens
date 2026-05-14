# Architecture — SplitLens

## Constraints (immutable)

1. **No backend that processes user financial data, ever.** Static hosting only.
2. **Cross-platform end goal**: web (Phase 1), iOS + Android native (Phase 2), desktop optional (Phase 3).
3. **Solo developer with 15-30 hrs/week.** Architecture must minimize platform-specific work.
4. **Local-first**: data lives on user's device, encrypted at rest, never transmitted unless user explicitly opts into BYOC sync (v2).
5. **Open source the core**: parsers + rules + settlement = AGPL-3.0. UI + marketing = proprietary.

## High-level architecture

```
┌────────────────────────────────────────────────────────────────┐
│  USER'S DEVICE (browser tab / native app — same code)          │
│                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  UI Layer    │    │  State + UX  │    │  Persistence │      │
│  │  Next.js +   │◄──►│  Zustand +   │◄──►│  PGlite (web)│      │
│  │  shadcn/ui + │    │  TanStack    │    │  expo-sqlite │      │
│  │  Framer +    │    │  Query       │    │  (mobile)    │      │
│  │  ECharts     │    │              │    │              │      │
│  └──────┬───────┘    └──────────────┘    └──────────────┘      │
│         │                                                      │
│         ▼                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  packages/core (pure TypeScript, framework-free)        │   │
│  │  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌──────────────┐   │   │
│  │  │ Parsers │ │ Rules  │ │Settlement│ │  Analytics    │  │   │
│  │  │  (HDFC, │ │ Engine │ │  Math    │ │  Aggregations │  │   │
│  │  │   ...)  │ │        │ │          │ │  (DuckDB-WASM)│  │   │
│  │  └─────────┘ └────────┘ └──────────┘ └──────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Web Worker thread                                      │   │
│  │  ┌─────────────────────────┐                            │   │
│  │  │  PDF.js → text extract  │                            │   │
│  │  │  → parsers/             │                            │   │
│  │  └─────────────────────────┘                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ (zero outbound traffic for user data)
                              ▼
                    ┌──────────────────┐
                    │ Cloudflare Pages │
                    │  (static hosting │
                    │  of HTML/JS/CSS) │
                    └──────────────────┘
```

## Stack — final picks

| Layer                 | Pick                                                                          | Rationale                                                                                |
| --------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Framework**         | Next.js 15 (App Router)                                                       | SSG for marketing pages, fast SPA for app. Static export deployable to Cloudflare Pages. |
| **Language**          | TypeScript strict                                                             | Non-negotiable for finance. Catches off-by-one rupee bugs.                               |
| **Package mgr**       | pnpm 9                                                                        | Disk-efficient monorepo workspaces, used by Vercel/Linear.                               |
| **Runtime**           | Bun (dev), Node 22 (build)                                                    | Bun = 3-5x faster dev server.                                                            |
| **UI primitives**     | shadcn/ui + Radix                                                             | Copy-paste, own the code. No vendor lock-in.                                             |
| **Styling**           | Tailwind 4                                                                    | Pairs with shadcn. CSS vars for theming.                                                 |
| **Animation**         | Framer Motion 11                                                              | Smooth transitions for sunburst zoom, table row appearance.                              |
| **Charts**            | Apache ECharts (sunburst/treemap), Recharts (simple), Visx (calendar heatmap) | ECharts has best interactive sunburst on web. Click events expose path/depth richly.     |
| **Table**             | TanStack Table v8 + TanStack Virtual                                          | True cell range selection, virtual scroll, keyboard nav.                                 |
| **Database**          | PGlite (Postgres-WASM) → OPFS                                                 | Same SQL as the existing SQLite prototype. Persists across reloads. ~3MB gzipped.        |
| **ORM**               | Drizzle ORM                                                                   | Type-safe, lighter than Prisma, generates readable SQL.                                  |
| **Analytics queries** | DuckDB-WASM                                                                   | Sub-second SQL on 100K+ rows in browser. Used for monthly aggregations.                  |
| **State**             | Zustand (atomic) + TanStack Query (cache)                                     | Avoids Redux ceremony. TanStack Query for invalidation after mutations.                  |
| **Forms**             | React Hook Form + Zod                                                         | Type-safe validation.                                                                    |
| **PDF parsing**       | PDF.js (in Web Worker)                                                        | Battle-tested. Same regexes as Python prototype.                                         |
| **Encryption**        | Web Crypto API + Argon2 (via WASM)                                            | AES-256-GCM with passphrase-derived key.                                                 |
| **PWA**               | next-pwa                                                                      | Installable, offline-capable.                                                            |
| **Testing**           | Vitest + Playwright + Storybook                                               | Vitest unit/integration; Playwright E2E; Storybook visual regression.                    |
| **Deploy**            | Cloudflare Pages                                                              | Free tier, fast global CDN, GitHub integration, no cold starts.                          |
| **Analytics**         | Plausible (self-hosted later, hosted now)                                     | Privacy-first, no cookies, no PII. Aligned with brand.                                   |
| **Errors**            | Sentry (free tier)                                                            | Crash reports without PII. Configurable scrubbing.                                       |

## Repo layout (Turborepo monorepo)

```
splitlens/
├── packages/
│   ├── core/              ← TypeScript-only, framework-free, AGPL-3.0
│   │   ├── src/
│   │   │   ├── parsers/   ← HDFC savings, HDFC CC v1.3 + v1.6
│   │   │   ├── rules/     ← Categorization rules + engine
│   │   │   ├── settlement/← Per-person net balance math
│   │   │   ├── types/     ← Shared TS types
│   │   │   └── index.ts
│   │   ├── tests/         ← Vitest, TDD
│   │   └── package.json
│   ├── ui/                ← Tamagui components (deferred to Phase 2 cross-platform)
│   ├── db/                ← Drizzle schema + migrations
│   │   └── schema.ts
│   └── tsconfig/          ← Shared TS configs
├── apps/
│   └── web/               ← Next.js 15 app
│       ├── app/
│       │   ├── (marketing)/  ← Landing, pricing, privacy, blog
│       │   ├── (app)/        ← Dashboard
│       │   │   ├── transactions/
│       │   │   ├── insights/
│       │   │   └── settings/
│       │   └── layout.tsx
│       ├── components/
│       ├── lib/
│       │   ├── db.ts          ← PGlite singleton
│       │   ├── workers/       ← pdf-parse.worker.ts
│       │   └── crypto.ts
│       ├── public/
│       └── tests/             ← Playwright E2E
├── docs/                  ← This directory
├── .github/workflows/     ← CI: lint, type, test, build, deploy
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Data model (initial schema)

```typescript
// packages/db/schema.ts (Drizzle)

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  bank: text("bank").notNull(), // 'HDFC'
  type: text("type").notNull(), // 'savings' | 'credit_card'
  last4: text("last4").notNull(),
  customerName: text("customer_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const statements = pgTable("statements", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => accounts.id),
  sourceFile: text("source_file").notNull().unique(),
  periodFrom: text("period_from"), // ISO date
  periodTo: text("period_to"),
  ingestedAt: timestamp("ingested_at").defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accounts.id),
    statementId: integer("statement_id").references(() => statements.id),
    txnDate: text("txn_date").notNull(), // ISO YYYY-MM-DD
    narration: text("narration").notNull(),
    withdrawal: real("withdrawal"),
    deposit: real("deposit"),
    closingBalance: real("closing_balance"),
    category: text("category"),
    categoryRule: text("category_rule"),
    sharedWith: text("shared_with"), // CSV of person ids
    shareCount: integer("share_count").default(1),
    notes: text("notes"),
    reviewed: boolean("reviewed").default(false),
    sourceRowIdx: integer("source_row_idx").notNull(),
  },
  (t) => ({
    unq: unique().on(t.statementId, t.sourceRowIdx),
  }),
);

export const people = pgTable("people", {
  id: text("id").primaryKey(), // 'rahul', 'shivam'
  displayName: text("display_name").notNull(),
  upiPatterns: text("upi_patterns"), // JSON array of regex patterns
  createdAt: timestamp("created_at").defaultNow(),
});

export const rules = pgTable("rules", {
  id: serial("id").primaryKey(),
  pattern: text("pattern").notNull(),
  category: text("category").notNull(),
  enabled: boolean("enabled").default(true),
  custom: boolean("custom").default(false), // user-created vs default
  priority: integer("priority").default(100),
});
```

## Privacy + encryption model

1. **At rest**: PGlite database is stored in OPFS (Origin Private File System). The user can opt to encrypt with a passphrase → key derived via Argon2id (m=64MB, t=3, p=1) → AES-256-GCM on the DB file.

2. **In motion**: there is no "in motion" — all queries run in the browser tab.

3. **PDFs themselves**: parsed in Web Worker, raw bytes never persisted (only the extracted txns).

4. **Crash reports** (Sentry): explicitly scrubbed of all `narration`, `account_no`, `customer_name`, `email`, `withdrawal`, `deposit` fields via beforeSend hook.

5. **Analytics** (Plausible): no cookies, no PII, just page views + custom events ("uploaded PDF", "edited category", etc.).

## Deferred decisions (revisit at Phase 2)

- **BYOC sync** (iCloud KVS / Google Drive token / custom encrypted blob)
- **Native mobile** stack: Expo + Tamagui vs Capacitor wrap of web
- **Multi-bank parser plugin system** (community-contributed)
- **AI narrative reports** (Anthropic SDK with user's API key)

See `adr/` for individual decision records.
