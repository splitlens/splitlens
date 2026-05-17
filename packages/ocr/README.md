# @splitlens/ocr

Local-first OCR pipeline for screenshot receipts. SplitLens uses this to ingest order summaries from quick-commerce apps (Blinkit, Zepto, Swiggy Instamart) that never email a confirmation.

Pipeline:

```
screenshot.png
   │
   ▼
recognizeText()          spawns splitlens-vision (Swift + Vision framework)
   │
   ▼
{ lines, blocks }
   │
   ▼
parseReceipt()           dispatches to zepto / blinkit / instamart parser
   │
   ▼
ExtractedReceipt
   │  { merchant, amount, orderId, items, rawLines }
   ▼
matchTxn()               finds the canonical txn (date ±1d, amount ±₹2)
   │
   ▼
transaction id  →  daemon attaches it as a transaction_sources row
```

No cloud. macOS Vision runs entirely on-device.

## Install (one-time)

1. Make sure the Swift toolchain is present. On a fresh macOS box:
   ```
   xcode-select --install
   ```
   Verify with `swift --version`.

2. Build the Vision helper from the repo root:
   ```
   pnpm --filter @splitlens/ocr build:swift
   ```
   That produces `packages/ocr/bin/splitlens-vision`. The TS wrapper finds it automatically via `import.meta.url`.

3. (Optional) For a system-wide install:
   ```
   cp packages/ocr/bin/splitlens-vision /usr/local/bin/
   ```

4. Override discovery with `SPLITLENS_VISION_BIN=/path/to/binary` if you want.

## Quick smoke test

```ts
import { recognizeText, parseReceipt } from "@splitlens/ocr";

const { lines } = await recognizeText("/path/to/zepto-receipt.png");
const receipt = parseReceipt(lines);
console.log(receipt);
// { merchant: "zepto", amount: 154, orderId: "ZP12345", items: [...], rawLines: [...] }
```

## What works in this PR

- Swift Vision helper (`src/swift/ocr-helper.swift`) — compiled and verified end-to-end on a synthetic Zepto receipt
- TS wrapper (`src/vision-ocr.ts`) — binary discovery, spawn, JSON parse, timeout, structured errors
- Three merchant parsers — Zepto, Blinkit, Instamart — each with `matches()` + `extract()` and unit tests
- Matcher (`src/match.ts`) — date ±1 day, amount ±₹2, narration tiebreaker

## Daemon integration

Wired into `apps/daemon` — drop a `.png` / `.jpg` / `.jpeg` / `.heic` into `~/Documents/bank/inbox/screenshots/` and the daemon:

1. OCRs it via `recognizeText()`
2. Picks a parser via `parseReceipt()`
3. Matches against canonical txns via `matchTxn()` (date ±1d, amount ±₹2, 14-day lookback)
4. Writes a `transaction_sources` row with `source_type=<merchant>_ocr` and the items / order id / raw lines as `raw_json`
5. Moves the file to `archive/screenshots/<merchant>/` on success; `unparsed/<name>.error.log` records why on failure

The Swift binary is built automatically by `apps/daemon/launchd/install.sh`. If `swiftc` is missing the install logs a warning, the daemon still ingests PDFs, and screenshots route to `unparsed/` with an install-hint log until the binary is built.

## Notes for future work

- **Receipt date parsing.** The matcher takes a date from the caller. Today the parsers don't extract the order date from the receipt text — when integrating, default to the screenshot file's mtime (or today's date if mtime is bogus). A follow-up could extract `Delivered on DD MMM, HH:MM` lines.
- **Rupee glyph fragility.** Vision frequently misreads `₹` as `7`, `{`, or `Z`. `_util.ts:parseInr` handles this; parsers prefer label-based total extraction over position-based extraction for that reason.
- **HEIC support.** macOS Vision handles HEIC natively via ImageIO; no decode step needed in TS.
