# Architecture — current implementation

> Where each concern lives, the runtime topology, and what depends on what.
> Read this before opening a PR that touches more than one package.

## Package layout

Eight workspaces in a pnpm monorepo orchestrated by Turborepo.

```
splitlens/
├── apps/
│   ├── daemon/        # File-watcher + email-poll process (Node, launchd-managed)
│   └── web/           # Next.js 15 app — UI + server actions
└── packages/
    ├── core/          # Pure logic — parsers, rules, people, settlement. NO I/O.
    ├── db/            # Drizzle ORM + SQLite schema + openDb/closeDb
    ├── email-receipts/# IMAP client + per-merchant email extractors
    ├── ingest/        # Ingestion orchestrators that touch the DB
    ├── ocr/           # macOS Vision binary + screenshot parsers
    └── tsconfig/      # Shared TS configs
```

### Responsibility table

| Package | What it owns | What it MUST NOT do |
|---|---|---|
| `@splitlens/core` | PDF text parsers, categorization rules, people registry, settlement math, shared types | Touch the DB, do file I/O, import Node-specific modules |
| `@splitlens/db` | Drizzle schema, `openDb()`, `closeDb()`, `defaultDbPath()` | Define business logic |
| `@splitlens/email-receipts` | IMAP client (imapflow), `fetchEmailsFrom()`, per-merchant extractors (HDFC alert, Swiggy, Zomato, CRED, Apple, Uber, Rapido), `findEmailsForTransaction()` | Touch the canonical DB |
| `@splitlens/ingest` | Orchestrators — `ingestPhonePe`, `ingestHdfcSavings`, `ingestHdfcCc`, `ingestZeptoInvoice`, `backfillTimesFromHdfcAlerts`, `backfillSwiggyZomatoItems`, `writeForcedAttachment`, `linkAutopayPairs`, `dispatchFile` | Be browser-imported (uses `node:fs`, `pdfjs-dist`) |
| `@splitlens/ocr` | macOS Vision Swift binary (`bin/splitlens-vision`), `recognizeText()`, `parseReceipt()`, screenshot parsers (Zepto, Blinkit, Instamart), `matchTxn()` | Run on non-macOS without the binary; the spawn fails with a friendly error |
| `apps/daemon` | 3 chokidar watchers (PDF / screenshot / invoice) + IMAP poll loop. Process-file routing, launchd plist. | Have any UI |
| `apps/web` | Next.js 15 pages + server components + server actions. Reads the SQLite directly via `@splitlens/db`. Writes via server actions. | Bundle native modules (`better-sqlite3` is `serverExternalPackages`) |

## Runtime topology

### Process 1 — the daemon

Lives in `apps/daemon/src/main.ts`. Spawned by launchd via
`apps/daemon/launchd/install.sh`. Three chokidar watchers + one
poll loop:

- **`inbox/*.pdf`** → `processInboxFile` → `dispatchFile` → per-source orchestrator
- **`inbox/screenshots/*.{png,jpg,heic}`** → `processScreenshotFile` → Vision OCR → parser → match → write source row
- **`inbox/invoices/*.pdf`** → `processInvoiceFile` → `ingestZeptoInvoice` (Zepto only for now)
- **IMAP poll** every `SPLITLENS_EMAIL_POLL_MINUTES` (default 30, min 5) → `backfillTimesFromHdfcAlerts` then `backfillSwiggyZomatoItems`

All writes go through `@splitlens/ingest`. The daemon is the only writer
to canonical txns; everything else enriches existing rows.

### Process 2 — the web app

`apps/web` is a Next.js 15 app. Pages are **Server Components** that read
the SQLite file directly via `@splitlens/db`. User edits flow through
**Server Actions** in `app/<route>/actions.ts`. Form-attached files
(Zepto invoices, screenshots) go through the same `@splitlens/ingest`
helpers the daemon uses — currently synchronously, **bypassing the
daemon's watchers** (see `fix(web): attach-bill is now synchronous`).

### Process 3 — the CLI (optional)

`packages/ingest/src/cli.ts` is the `splitlens-ingest` binary. Same
dispatch logic as the daemon but one-shot. Useful for backfilling.

```
pnpm ingest <file.pdf>              # single file
pnpm ingest backfill-times          # HDFC alert email → txn_time
pnpm ingest enrich-items            # Swiggy/Zomato email → items
```

## Data flow at a glance

```
┌─────────────┐    ┌─────────────────┐
│  Bank PDF   │───▶│  @splitlens/    │
│  (HDFC,     │    │     core        │ ──┐
│  PhonePe)   │    │  pure parsers   │   │
└─────────────┘    └─────────────────┘   │
                                         ▼
┌─────────────┐    ┌─────────────────┐  ┌─────────────────────┐
│  Email      │───▶│  @splitlens/    │─▶│  @splitlens/ingest  │
│  (IMAP)     │    │ email-receipts  │  │   orchestrators     │
└─────────────┘    └─────────────────┘  │  + writer helpers   │
                                        └──────────┬──────────┘
┌─────────────┐    ┌─────────────────┐             │
│ Screenshot  │───▶│  @splitlens/    │─────────────┤
│  (PNG/JPG)  │    │      ocr        │             │
└─────────────┘    └─────────────────┘             │
                                                   ▼
┌──────────────────────────────────────────────────────────┐
│             SQLite — single canonical DB                 │
│   transactions ─┬─ transaction_sources                   │
│                 ├─ statements                            │
│                 └─ accounts / people / rules             │
└──────────────────────────────────────────────────────────┘
                                                   ▲
                                                   │ reads + Server-Action writes
                                                   │
                          ┌────────────────────────┴──────────┐
                          │  apps/web (Next.js 15)            │
                          │  Server Components + Server Acts  │
                          └───────────────────────────────────┘
```

## Inter-package dependency rules

```
core            (depends on: nothing)
db              (depends on: drizzle-orm, better-sqlite3)
ocr             (depends on: spawned Swift binary)
email-receipts  (depends on: imapflow, mailparser)
ingest          (depends on: core, db, email-receipts, pdfjs-dist)
daemon          (depends on: db, ingest, ocr, email-receipts, chokidar)
web             (depends on: db, core, ingest, ocr, email-receipts)
```

Rule of thumb: **anything that imports `node:fs` or `pdfjs-dist` cannot
be imported into a browser bundle.** Next.js handles this for server
components but pre-rendered routes must not pull these in via the
client tree.

## Key cross-cutting modules

### `@splitlens/db` — schema source of truth

`packages/db/src/schema.ts` (Drizzle definitions) AND
`packages/db/src/client.ts` (raw DDL for `openDb()` to apply on
startup) must stay in sync. The raw DDL is hand-maintained because
we don't run a migration tool yet — when you add a column, update
**both**.

### `@splitlens/ingest/dispatch.ts` — central PDF router

`dispatchFile(filePath, db, opts)` is the single function the daemon
calls per PDF. It runs `classifyByFilename()` to pick a source type,
then routes to the right orchestrator. To add a new bank statement
parser, you add a regex to `classify.ts` and a case to `dispatch.ts`.

### `@splitlens/core/parsers/index.ts` — re-exports every parser

Top-level barrel so `@splitlens/core` imports stay short.
`parseHdfcSavings`, `parseHdfcCc`, `parsePhonePe`, `parseZeptoInvoiceText`,
`parseZeptoInvoicePositional`. All pure — `bytes → ParseResult`.

### `apps/web/src/lib/repo.ts` — main read-side query layer

Every page that needs ledger data calls into `repo.ts`. Functions are
async + cached via Next.js's request-scoped cache. **Don't query the DB
from a component file directly** — go through `repo.ts` or its sibling
`review-repo.ts` (which is split out because the review-page queries
have heavier joins).

## Local dependencies / native bits

| Thing | Where | How to install |
|---|---|---|
| `better-sqlite3` native binding | Auto-built on `pnpm install` (Node ≥ 20) | If broken, `cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run install` |
| macOS Vision OCR Swift binary | `packages/ocr/bin/splitlens-vision` | `pnpm --filter @splitlens/ocr build:swift` (needs `xcode-select --install`) |
| Vision binary at deploy | Auto-built by `apps/daemon/launchd/install.sh` | Run that on a fresh box |

## Where the production process actually runs

User's MacBook. Not a server. The launchd plist
(`apps/daemon/launchd/in.splitlens.daemon.plist.template`) is the only
"deployment" — `bash apps/daemon/launchd/install.sh` puts it in
`~/Library/LaunchAgents/` and launchctl-loads it.

The web app is `pnpm --filter @splitlens/web dev` for development. There
is no production deploy of the web app today — it's a localhost-only
surface. A future change might add a `splitlens-web` binary that boots
Next.js in standalone mode under launchd too.
