# Pipelines — how data gets into the canonical ledger

> Five ingestion paths feed the SQLite ledger. Each section maps one
> path: what triggers it, what files it reads, what it writes, and where
> the code lives.

```
inbox/                            archive/
├── *.pdf            ─────────────► hdfc-savings/, hdfc-cc/, phonepe/, …
│                                   (statement-level archive)
├── screenshots/*.png ────────────► screenshots/<merchant>/
│                                   or manual/<txnId>/
├── invoices/*.pdf  ─────────────► invoices/zepto/
│                                   or manual/<txnId>/
└── (IMAP polled separately)
```

```
unparsed/<file>  ◄── any pipeline failure routes here with a sibling .error.log
```

## 1. PDF ingestion — `inbox/*.pdf`

The bank-statement path. Watcher: `apps/daemon/src/main.ts` (root chokidar
on `inbox/`, depth 0). Handler: `apps/daemon/src/process-file.ts`.

### Flow

```
file detected
  └─ processInboxFile(filePath, db, paths)
       └─ dispatchFile(filePath, db, opts)              [@splitlens/ingest]
            ├─ classifyByFilename(filePath)             [@splitlens/ingest/classify.ts]
            │    returns { sourceType } or null
            └─ switch (sourceType):
                 ├─ "phonepe"      → ingestPhonePe()
                 ├─ "hdfc_savings" → ingestHdfcSavings()
                 ├─ "hdfc_cc"      → ingestHdfcCc()
                 ├─ "hdfc_fd"      → no_orchestrator (file goes to archive/hdfc-fd/)
                 └─ default        → no_orchestrator (file goes to unparsed/)

      File then renamed to archive/<source-type>/<name>
      or unparsed/<name> with .error.log on failure
```

### Classifier

`packages/ingest/src/classify.ts` — filename-only, regex-driven, deliberately
narrow. Known patterns:

| File pattern | Source type |
|---|---|
| `^PhonePe_Transaction_Statement.*\.pdf$` | `phonepe` |
| `^Acct_Statement_X+\d{4}_\d{8}\.(pdf|txt|xls|xlsx)$` | `hdfc_savings` |
| `^[A-Z][a-z]{2}\d{4}_Billedstatements_\d{4}_[\d_-]+\.pdf$` | `hdfc_cc` |
| `^gpay_statement_\d{8}_\d{8}\.pdf$` | `gpay` |
| `^FDAdvice_\d+\.pdf$` | `hdfc_fd` (recognized for archival, no ingest) |

Add a new bank: add a regex + map to a source type in this file, then
add the orchestrator case in `dispatch.ts`.

### Orchestrators — the `ingestX` / `writeXIngest` pattern

Every orchestrator splits into:
- `ingestX(filePath, db, opts)` — reads bytes, calls the pure parser, calls the writer
- `writeXIngest({ db, parsed, sourceFile, sourceHash, pageCount })` — pure-DB writer (tests can drive this directly without a real PDF)

Examples:
- `packages/ingest/src/phonepe.ts`
- `packages/ingest/src/hdfc-savings.ts`
- `packages/ingest/src/hdfc-cc.ts`
- `packages/ingest/src/zepto-invoice.ts`

The pure parsers live in `@splitlens/core/parsers/`:
- `parsePhonePe`, `parsePhonePeText`
- `parseHdfcSavings`, `parseHdfcSavingsPages`
- `parseHdfcCc`, `parseHdfcCcText`
- `parseZeptoInvoiceText`, `parseZeptoInvoicePositional`

### Source-file dedup

`statements.uq_statement_source_hash` (SHA-256 of bytes) is the only
mechanism. Every orchestrator computes the hash up front and bails
with `skipped_duplicate` if a row already exists.

### Autopay linking (post-ingest)

After HDFC savings + HDFC CC are both ingested, `linkAutopayPairs(db)`
sweeps for pairs where `(savings AUTOPAY debit, cc AUTOPAY PAYMENT credit)`
match by amount + date, and sets `transactions.linked_txn_id`
symmetrically. Triggers automatically at the end of each
`ingestHdfcSavings` / `ingestHdfcCc` run.

## 2. Email enrichment — IMAP poll

Email never creates canonical rows — it only **enriches** existing ones.
Two passes today, both in `packages/ingest/src/email-backfill.ts`:

### 2a. `backfillTimesFromHdfcAlerts`

Fills `txn_time` on canonical rows that have a `ref_no` but no time.
HDFC InstaAlerts emails carry the wall-clock time + UTR in the body.

```
candidates = SELECT * FROM transactions WHERE txn_time IS NULL AND ref_no IS NOT NULL
emails     = bulk-fetch HDFC InstaAlerts (1 IMAP call per configured account)
parse each email body via hdfcAlertExtractor  → { utr, time }
build UTR → time map
UPDATE transactions SET txn_time = map[ref_no] WHERE ref_no IN map
```

Two regex formats (`FORMAT_A`, `FORMAT_B`) live in
`packages/email-receipts/src/extractors/hdfc-alert.ts` — HDFC has used
both at different times. Real coverage on the dev DB: 71.5% → 97.9% of
candidates filled.

### 2b. `backfillSwiggyZomatoItems`

Attaches item-level breakdowns. Adds a `transaction_sources` row with
`source_type = swiggy_email | zomato_email` carrying parsed items.

```
candidates = canonical rows with counterparty containing "swiggy" or "zomato"
             AND no existing swiggy_email / zomato_email source row
emails     = bulk-fetch (Swiggy + Zomato senders, both accounts)
extract    = swiggyExtractor / zomatoExtractor.extract(email)
match policy: ±2 days, ±₹2 — consume each email at most once
write      = transaction_sources row + synthetic statement per (merchant, account)
```

Match logic is `pickEmailMatches` — pure function, well-tested in
`packages/ingest/tests/email-backfill.test.ts`.

### Daemon integration

`apps/daemon/src/main.ts:runEmailBackfillOnce`. Runs once at startup +
every `SPLITLENS_EMAIL_POLL_MINUTES` (default 30, min 5, `0` disables).
Overlap prevention via `apps/daemon/src/poll.ts:schedulePoll` —
ensures no two cycles can run concurrently.

### IMAP credentials

Set via env vars:

```
GMAIL_USER_1=you@gmail.com
GMAIL_APP_PWD_1=xxxx xxxx xxxx xxxx   # Google App Password, NOT OAuth
GMAIL_USER_2=you-personal@gmail.com   # up to 4 accounts: _1, _2, _3, _4
GMAIL_APP_PWD_2=...
```

The launchd plist template
(`apps/daemon/launchd/in.splitlens.daemon.plist.template`) reads these.
`apps/daemon/launchd/install.sh` prompts for them at install time.

### Extractors

One per sender, in `packages/email-receipts/src/extractors/`:
- `hdfc-alert.ts` — InstaAlerts UTR + time
- `swiggy.ts` — order id, items, total
- `zomato.ts` — order id, restaurant, items
- `cred.ts`, `apple.ts`, `uber.ts`, `rapido.ts` — currently unused, but
  registered so `findEmailsForTransaction` can search them on demand

Each extractor implements `MerchantExtractor`:

```ts
interface MerchantExtractor {
  id: string;
  senders: string[];               // From: addresses we should fetch
  extract(email: EmailMessage):    // EmailMessage = parsed mailparser output
    ExtractedInfo | null;
}
```

Default registry: `DEFAULT_EXTRACTORS` in
`packages/email-receipts/src/extractors/index.ts`. Order matters only
for ambiguous senders — first-match wins.

### On-demand email lookup (the `findEmailsForTransaction` primitive)

`packages/email-receipts/src/find-emails.ts:findEmailsForTransaction(auth, txn, opts)`
— scores 0..1 across 3 independent IMAP searches (refNo in body, counterparty
in body, known-merchant senders), unions + dedups, returns ranked matches.
Used by `apps/web/src/app/friends/email-lookup-actions.ts:lookupEmailsForTxn`
to surface candidate emails for a single txn on demand from the UI.

## 3. Screenshot OCR — `inbox/screenshots/*.{png,jpg,heic}`

Watcher: separate chokidar on `inbox/screenshots/` (set up in
`apps/daemon/src/main.ts`). Handler:
`apps/daemon/src/process-screenshot.ts`.

### Flow

```
file detected
  └─ processScreenshotFile(filePath, db, paths)
       ├─ validate extension (.png|.jpg|.jpeg|.heic)
       ├─ recognizeText(filePath)                   [@splitlens/ocr]
       │    → spawns Swift binary, returns { lines, blocks }
       ├─ parseReceipt(ocrLines)                    [@splitlens/ocr]
       │    → tries zeptoParser, blinkitParser, instamartParser
       │    → returns ExtractedReceipt | null
       ├─ matchTxn(receipt, candidates, opts)       [@splitlens/ocr]
       │    → finds canonical txn within ±1 day, ±₹2
       │    → tiebreaker: narration contains merchant name
       └─ attach as transaction_sources row
            source_type = <merchant>_ocr
            file → archive/screenshots/<merchant>/<name>

Failures route to unparsed/ with a sibling .error.log carrying the
ScreenshotOutcome kind + a human-readable explanation.
```

### Vision binary

Lives at `packages/ocr/bin/splitlens-vision` once built. Source:
`packages/ocr/src/swift/ocr-helper.swift`. Built with:

```
pnpm --filter @splitlens/ocr build:swift
```

(Auto-invoked by `apps/daemon/launchd/install.sh` on a fresh install.)

The TS wrapper at `packages/ocr/src/vision-ocr.ts` discovers the binary
via:
1. `SPLITLENS_VISION_BIN` env var
2. `<package>/bin/splitlens-vision` (relative to this module's URL)
3. `/usr/local/bin/splitlens-vision`

Failure → `VisionUnavailableError` with install hint; daemon catches
and routes to unparsed with a friendly log.

### Parsers

`packages/ocr/src/parsers/{zepto,blinkit,instamart}.ts`. Each:

```ts
interface ReceiptParser {
  merchant: "zepto" | "blinkit" | "instamart";
  matches(lines: string[]): boolean;          // is this even an X receipt?
  extract(lines: string[]): ExtractedReceipt | null;
}
```

Tuned for **in-app order summary screenshots**, not GST tax-invoice PDFs.
Real-world drift is real — the Zepto parser was tuned on a 2024 version
of the app and the 2026 UI uses "Total Bill" instead of "Grand Total".
See `GOTCHAS.md` in `DEV.md` for the pattern.

### Sync attach via /review (alternative entry)

The review-page bill-attach flow (`apps/web/src/app/review/actions.ts:attachBillToTransaction`)
**does NOT go through the daemon's watcher**. It runs OCR synchronously
inside the server action and writes a `transaction_sources` row via
`writeForcedAttachment`. The user gets immediate feedback. See §4 below.

## 4. Zepto invoice — `inbox/invoices/*.pdf`

Watcher: third chokidar on `inbox/invoices/`. Handler:
`apps/daemon/src/process-invoice.ts`.

### Flow

```
file detected
  └─ processInvoiceFile(filePath, db, paths)
       ├─ classify by filename
       │    /^zepto_invoice_/i.test(name) → merchant: "zepto"
       │    else → unsupported_filename → unparsed/
       └─ ingestZeptoInvoice(filePath, db)
            ├─ readFile + sha256 hash
            ├─ check uq_statement_source_hash → skipped_duplicate
            ├─ extractPagesPositional(bytes)        [@splitlens/ingest]
            ├─ parseZeptoInvoicePositional(pages)   [@splitlens/core]
            │    → { orderNo, invoiceNo, date, amount, items }
            └─ writeZeptoInvoiceEnrichment({ db, parsed, ...})
                 ├─ find candidate canonical txn (±1 day, ±₹2, zepto in narration)
                 ├─ no match → no_canonical_match
                 ├─ match → insert statement + transaction_sources row
                 └─ source_type = "zepto_invoice"

      File moves to archive/invoices/zepto/<name>
      or unparsed/<name> with .error.log
```

### Parser internals

`packages/core/src/parsers/zepto-invoice.ts`. Uses `extractPagesPositional`
(pdfjs words + bounding boxes) because pdfjs's reading-order text
interleaves table columns badly. Algorithm:

1. Group words into rows by y-coordinate tolerance (±3 pt)
2. Find table bounds: first row matching `Description.*MRP/RSP` (header end), first subsequent row matching `Item Total|Invoice Value` (footer start)
3. Walk rows in document order (multi-page: header on p1, footer can spill to p2)
4. Data rows = rows starting with `^\d{1,2}$` at x<50 (seq column) + ≥5 words
5. For each data row, the **item band** = rows from prev data-row midpoint to next data-row midpoint
6. Within the band, name fragments come from x ∈ `[50, 110]` on the data row (where MRP column starts at ~110) and `[50, 180]` on continuation rows

Two tested invoice formats, both yield clean `{orderNo, items}` extraction.

### Force-attach via /review

`writeZeptoInvoiceEnrichment` accepts `forceTransactionId` — used by the
review-page attach flow to bypass the date+amount match and attach
directly to the user-chosen txn.

## 5. Manual attach — synchronous /review flow

`apps/web/src/app/review/actions.ts:attachBillToTransaction(txnId, fileName, base64)`.
**Always synchronous** — no daemon dependency.

### Routing

```
Routing inside attachBillToTransaction
  └─ ext + name check
       ├─ "zepto_invoice_*.pdf"          → ingestZeptoInvoice(forceTransactionId)
       ├─ .png | .jpg | .jpeg | .heic    → recognizeText → parseReceipt
       │                                    ├─ matched: source_type = "<merchant>_ocr"
       │                                    └─ no match: source_type = "manual_attachment",
       │                                                 raw_json carries the OCR lines
       └─ other .pdf                     → source_type = "manual_attachment"
                                            raw_json carries fileName + size + mime
```

All non-Zepto-invoice attachments land in:

```
~/Documents/bank/archive/manual/<txnId>/<filename>
```

This makes "where's the bill for txn N?" answerable instantly ("look in
`archive/manual/N/`").

### `writeForcedAttachment` — the shared writer

`packages/ingest/src/forced-attachment.ts`. Generic writer:

```ts
writeForcedAttachment({
  db,
  transactionId,
  sourceType,
  sourceFile,    // absolute path of archived file
  fileBytes,     // for SHA-256 computation
  rawJson,       // arbitrary; UI's formatter decides how to render
});
// returns: { kind: "attached"|"duplicate"|"txn_not_found"|"failed" }
```

Discriminated outcome — caller branches without try/catch. Idempotent
via `uq_statement_source_hash` — re-dropping a byte-identical file
returns `duplicate`.

## Failure routing — common to all pipelines

| When | Where the file goes | What's logged |
|---|---|---|
| Filename classifier doesn't recognize | `unparsed/<name>` | `.error.log` with classifier output |
| Parser throws (bad PDF, wrong password) | `unparsed/<name>` | `.error.log` with stack trace |
| `no_canonical_match` (enrichment can't find a target txn) | `unparsed/<name>` | `.error.log` with "no UPI debit in the ±1 day / ±₹2 window" |
| `skipped_duplicate` (file already ingested) | `archive/<source-type>/<name>` (stays in archive) | nothing — silently dedupes |

The `.error.log` format is human-readable + carries the outcome kind so
the user can re-run after fixing whatever was wrong.

## Adding a new pipeline

If you're adding a new file-type pipeline (e.g. "Apple receipt PDFs"):

1. Decide the inbox subdirectory (`inbox/apple/`?) and `archive/` target
2. Add a chokidar watcher in `apps/daemon/src/main.ts`
3. Write `apps/daemon/src/process-<thing>.ts` with the same shape as
   `process-screenshot.ts` (extension check → pure parse → DB write →
   move file)
4. Update `apps/daemon/src/paths.ts` to add the new directory constants
5. Update `ensureDirs()` in `main.ts` to mkdir them on startup
6. Add a parser to `@splitlens/core/parsers/` or `@splitlens/ocr/parsers/`
7. Add the source type to `apps/web/src/components/review/sourceFormat.ts`
   (icon, title, formatter) — see `DATA-MODEL.md` for the conventions

See [`DEV.md`](DEV.md) for the recipe.
