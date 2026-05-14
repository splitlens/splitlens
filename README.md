# SplitLens 🔍

> Local-first personal finance for Indian banks. See your spending clearly. Split it cleanly. **Your data never leaves your device.**

**Status:** Pre-MVP planning · Phase 1 (web)
**Owner:** Prateek Aryan
**License:** [AGPL-3.0](LICENSE) — fully open source
**Domain:** [splitlens.in](https://splitlens.in) (primary)
**Code:** [github.com/splitlens](https://github.com/splitlens)

## What it is

Drop your bank PDF statements into SplitLens. It parses them, categorizes every transaction, surfaces patterns, tracks shared expenses with flatmates, and answers questions like _"how much did I spend on cigarettes in October?"_ — all running entirely in your browser.

**Differentiator:** every other personal finance app in India (Cred, Jupiter, Fi, Niyo, INDmoney) sends your bank data to their servers. SplitLens sends nothing, anywhere. No backend, no aggregator, no compliance risk. **Code is open source so you can verify this for yourself.**

## Quick links

- [Product Requirements](docs/PRD.md) — vision, audience, MVP scope
- [Architecture](docs/ARCHITECTURE.md) — tech stack + decisions
- [Roadmap](docs/ROADMAP.md) — Phase 1 week-by-week
- [Testing strategy](docs/TESTING.md) — TDD where it matters
- [ADRs](docs/adr/) — architecture decision records

## Quick start (once code exists)

```bash
pnpm install
pnpm dev          # apps/web on :3000
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright
```

## Contributing

PRs welcome — especially **bank parsers** for ICICI, Axis, SBI, and Kotak. See [contributing guide](docs/CONTRIBUTING.md) (TBD).

## Why "SplitLens"?

Two product ideas in one name:

1. **Split** — split shared expenses with flatmates / family / friends, settle cleanly
2. **Lens** — a clear lens through which to view your spending patterns

Both rely on the same foundation: **your data, on your device**.
