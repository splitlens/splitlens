# SplitLens — implementation overview

> **Audience:** Claude (or any engineer) picking up SplitLens for a new feature.
> **Goal:** maximum context per minute of reading. Skip to whichever section your task needs.

## What SplitLens actually is, in 60 seconds

A **local-first** personal-finance app for Indian banks. The user drops
bank PDFs into `~/Documents/bank/inbox/`. A background **daemon** parses
them into a SQLite database. A **Next.js web app** serves a dashboard,
friends-tracking, monthly reviews, and a per-transaction review surface
over that same SQLite file.

Three runtime processes share one local database:

```
┌──────────────────────────────────┐
│ apps/daemon                      │ ← chokidar watchers
│   • inbox/*.pdf       → ingest   │
│   • inbox/screenshots → OCR      │
│   • inbox/invoices    → parse    │
│   • IMAP poll (30 min)           │
└──────────────┬───────────────────┘
               ↓ writes
       ┌────────────────┐
       │  SQLite file   │ ← ~/Library/Application Support/splitlens/
       │  (canonical    │
       │   ledger)      │
       └────────────────┘
               ↑ reads
┌──────────────┴───────────────────┐
│ apps/web (Next.js 15)            │
│   • /dashboard  /review          │
│   • /friends    /reports         │
│   • Server Components + Actions  │
└──────────────────────────────────┘
```

> Both processes read and write the same `better-sqlite3` file. There is **no
> network layer between them** — direct shared-file access. WAL mode is on
> so concurrent reads + writes work without locking.

## Where things live

| You're looking for | It's in |
|---|---|
| Bank PDF parsers (pure logic) | `packages/core/src/parsers/` |
| People + categorization rules | `packages/core/src/{people,rules}/` |
| SQLite schema + client | `packages/db/src/` |
| Ingestion orchestrators (Node-only, touch DB) | `packages/ingest/src/` |
| IMAP email + extractors | `packages/email-receipts/src/` |
| Screenshot OCR + Vision binary | `packages/ocr/src/` |
| File-watcher daemon (launchd-managed) | `apps/daemon/src/` |
| Next.js web app (UI + server actions) | `apps/web/src/` |

## Where USER FILES live (matters for testing)

| Path | Contents |
|---|---|
| `~/Documents/bank/inbox/*.pdf` | Drop bank statements here — daemon picks up |
| `~/Documents/bank/inbox/screenshots/*.png` | Quick-commerce receipt screenshots |
| `~/Documents/bank/inbox/invoices/*.pdf` | Per-order invoice PDFs (Zepto) |
| `~/Documents/bank/archive/<source-type>/` | Successfully ingested files end up here |
| `~/Documents/bank/archive/manual/<txnId>/` | Files attached via the /review form |
| `~/Documents/bank/unparsed/` | Files that failed — with sibling `.error.log` |
| `~/Library/Application Support/splitlens/splitlens.sqlite` | The canonical DB |
| `packages/ocr/bin/splitlens-vision` | macOS Vision OCR helper (build with `pnpm --filter @splitlens/ocr build:swift`) |

## Read this next, by task

| If your task is… | Read |
|---|---|
| Adding a new bank parser | [`PIPELINES.md`](PIPELINES.md) §"PDF ingestion" + [`DEV.md`](DEV.md) §"Recipe: new PDF parser" |
| Adding a new source type to the review UI | [`DATA-MODEL.md`](DATA-MODEL.md) §"Source types" + [`UI.md`](UI.md) §"Source card formatter" |
| Touching the /review page | [`UI.md`](UI.md) §"/review" — most complex surface, has a sub-component map |
| Adding a new categorization rule | [`DATA-MODEL.md`](DATA-MODEL.md) §"Rules engine" |
| Wiring a new server action | [`UI.md`](UI.md) §"Server actions" + [`DEV.md`](DEV.md) §"Server-action gotchas" |
| Debugging Vision OCR | [`PIPELINES.md`](PIPELINES.md) §"Screenshot OCR" + [`DEV.md`](DEV.md) §"Gotchas" |
| Anything email-related | [`PIPELINES.md`](PIPELINES.md) §"Email enrichment" |

## Feature timeline — what's been shipped

Newest at the bottom. Each entry has the commit short hash so you can `git show <hash>` for the full context.

| Commit | Title |
|---|---|
| `35e93a1` | feat(data): SQLite ledger + multi-source statement ingestion |
| `ffd0577` | feat(daemon): launchd file watcher for `Documents/bank/inbox/` |
| `ee902ec` | feat(web): SQLite-backed dashboard with 11 widgets + dark mode + drill-down |
| `f8b5bb2` | feat(web): Friends section + Monthly review + name-based person matching |
| `f836c31` | feat(email): IMAP email-receipts package + HDFC time-backfill |
| `e5e3e2c` | feat(web): on-demand email lookup for a transaction |
| `23f3b07` | feat(daemon): periodic email sync with overlap-prevention |
| `155171d` | feat(email): item-level enrichment from Swiggy/Zomato emails |
| `d35aad0` | feat(email,ocr): 4 new email extractors + macOS Vision screenshot pipeline |
| `bf53017` | feat(daemon): wire OCR + enrich-items into the daemon |
| `ee210ea` | feat(invoices): Zepto invoice PDF ingestion as enrichment source |
| `822da30` | feat(web): surface Zepto invoice items in the dashboard timeline |
| `a71ab7a` | feat(web): /review page — form-driven txn-by-txn review with bill attach |
| `cfd53d9` | feat(web): expandable per-source detail cards on /review |
| `8d9b643` | feat(web): hierarchical time navigator on /review |
| `9bf068b` | feat(web): /review UX overhaul — surface the queue, calm the form |
| `6f4b8e0` | feat(web): timeline columns in /review sidebar (zoom-aware) |
| `de292d5` | feat(web): resizable two-pane /review layout + cross-component sync |
| `2a5d23f` | fix(web): attach-bill is now synchronous (no daemon dependency) |
| `85d71c2` | feat(web): structured OCR preview for screenshot source cards |

After committing a new feature, append a row here so the next session inherits the context.

## Stable invariants — don't break these

1. **Local-first, no cloud.** Nothing in this codebase makes outbound requests except for IMAP (user's own email) and the user's own SQLite. No telemetry, no analytics, no remote APIs.
2. **One canonical ledger.** `transactions` is the source of truth. `transaction_sources` is many-to-one. Never create a parallel ledger.
3. **`reviewed=1` protects user-edited fields.** Ingestion merge passes must not overwrite `counterparty`, `category`, `person_id`, `shared_with`, or `notes` on reviewed rows.
4. **All file paths in DB are absolute.** Including `statements.source_file`.
5. **Source types are lowercase snake_case strings** that double as a route key — pick a stable one when adding a new source.
6. **Pure parsers belong in `@splitlens/core`**, orchestrators in `@splitlens/ingest`. No DB code in `core`.
