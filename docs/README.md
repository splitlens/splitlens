# SplitLens docs — index

Two kinds of doc live here. Pick the right entry point for what you're doing.

## 🔭 Planning docs — original intent + still-valid product direction

Useful when you need to know *why* the project exists and *what* it's
supposed to become. These predate the codebase.

| File | Use when |
|---|---|
| [`PRD.md`](PRD.md) | You need the audience, problem statement, MVP scope |
| [`ROADMAP.md`](ROADMAP.md) | You're planning a release boundary |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | You want to know the *original* PGlite-in-browser plan. Most of this is now superseded by the daemon + SQLite reality — see `impl/ARCHITECTURE.md` for what we actually built |
| [`TESTING.md`](TESTING.md) | You're writing tests and want the project's stated test philosophy |
| [`adr/`](adr/) | Architecture Decision Records — the *why* behind tech-stack picks |

## 🛠 Implementation docs — what's actually built (read first)

Optimized for fast context loading when picking up a new feature. Each doc
covers one slice; cross-references are explicit so you can grep file paths
and jump straight to code.

| File | Use when |
|---|---|
| [`impl/README.md`](impl/README.md) | First read on a fresh session — gives the lay of the land + a feature changelog |
| [`impl/ARCHITECTURE.md`](impl/ARCHITECTURE.md) | You need to know which package owns what, the runtime topology (daemon vs web), or where a particular concern lives |
| [`impl/DATA-MODEL.md`](impl/DATA-MODEL.md) | You're touching SQLite, adding a source type, or reading `transaction_sources.raw_json` shapes |
| [`impl/PIPELINES.md`](impl/PIPELINES.md) | You're working on ingestion (PDF / email / OCR / invoice / manual attach) |
| [`impl/UI.md`](impl/UI.md) | You're working on the Next.js web app — pages, server components, server actions |
| [`impl/DEV.md`](impl/DEV.md) | Conventions, recipes, gotchas, and the build/test/dev command cheatsheet |

## Workflow for adding a new feature (suggested)

1. **Skim** [`impl/README.md`](impl/README.md) — orientation + recent feature timeline
2. **Find the right slice** — the table above tells you which doc owns your concern
3. **Read that doc + cross-referenced files** — usually 1–2 docs is enough
4. **Follow a recipe** if there's one for your change type — see [`impl/DEV.md`](impl/DEV.md)
5. **Add a changelog entry** to `impl/README.md` after you commit
