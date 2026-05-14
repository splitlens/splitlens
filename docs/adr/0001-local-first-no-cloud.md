# ADR-0001: Local-first architecture, no cloud backend ever

**Status:** Accepted
**Date:** 2026-05-15
**Deciders:** Prateek Aryan (founder)

## Context

Indian personal finance apps (Cred, Jupiter, Fi, INDmoney, Niyo, Walnut, Khatabook) all operate cloud backends that ingest, store, and process user financial data. This creates:

1. **User trust friction** — many Indians refuse to give bank credentials or statements to a cloud service.
2. **Compliance burden** — RBI account aggregator framework, data localization rules, breach notification requirements.
3. **Operational cost** — backend infra, on-call, SOC 2, ISO 27001.
4. **Liability** — a single breach can be company-ending.

## Decision

**SplitLens will never operate a backend that processes user financial data.**

The product is a static web app (and later, native mobile apps) that:
- Runs entirely on the user's device
- Stores data in browser/device-local persistent storage (OPFS for web, native SQLite for mobile)
- Encrypts at rest with a user-provided passphrase
- Sends zero financial data over the network

The only outbound network traffic is:
- Anonymous page-view analytics (Plausible, no PII)
- Crash reports with PII scrubbed (Sentry)
- Loading static JS/CSS from CDN (Cloudflare Pages)

## Consequences

### Positive
- **Zero compliance burden** for handling financial data (we don't handle it)
- **Marketing wedge** that no competitor can authentically claim
- **Lower CapEx** — sustainable as solo project, no AWS bills tied to user count
- **No data breach risk** — there is no user data on our servers to breach
- **Simpler legal** — minimal privacy policy, no data-localization compliance

### Negative
- **Cross-device sync is hard** — solved later via BYOC (bring your own cloud) in Phase 2
- **No server-side ML** — categorization is rules-based + user-tuned, not learned from aggregate data
- **No collaborative features** — can't share an expense report with a partner inside the app
- **Browser/device storage limits** — typically 1-10GB available, but our data is small (<100MB even for years of statements)
- **PDF parsing on mobile is harder** than server-side (deferred to Phase 2 with Web Worker bundle of PDF.js)

## Alternatives considered

### A. Traditional cloud backend (Postgres + S3)
**Rejected.** Brings all the problems we want to avoid. Becomes one more "another finance app you have to trust."

### B. Hybrid (local UI + cloud sync)
**Rejected for v1.** Adds backend complexity without enough user value at MVP scale. Reconsider in Phase 2 as opt-in BYOC.

### C. Self-hosted by user (Docker container they run)
**Rejected.** Massive friction for non-technical users. Rules out the "1000+ users" goal.

## Re-evaluation triggers

Revisit this decision if:
- A user clearly demands hosted-by-us option AND privacy can be cryptographically guaranteed (e.g., E2E-encrypted storage with key only on device — same architecture, just our blob storage)
- Browser storage APIs become significantly less reliable (unlikely)
- We hit growth ceilings explicitly tied to no-sync (probably not before 50K users)
