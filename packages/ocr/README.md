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

## What's deferred — daemon integration

The task spec referenced an `apps/daemon/` (chokidar file watcher) and a `packages/email-receipts/` package that don't exist on this branch yet. Once those land, the integration is short:

```ts
// apps/daemon/src/process-file.ts
import { extname } from "node:path";
import {
  recognizeText,
  parseReceipt,
  matchTxn,
  VisionUnavailableError,
} from "@splitlens/ocr";

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".heic"]);

export async function processScreenshot(filePath: string) {
  if (!IMG_EXT.has(extname(filePath).toLowerCase())) return;

  let ocr;
  try {
    ocr = await recognizeText(filePath);
  } catch (err) {
    if (err instanceof VisionUnavailableError) {
      // surface the install hint to the user, don't crash the daemon
      console.error(err.message);
      return moveToUnparsed(filePath, "vision-unavailable");
    }
    throw err;
  }

  const receipt = parseReceipt(ocr.lines);
  if (!receipt) return moveToUnparsed(filePath, "no-parser-matched");

  const txn = matchTxn(
    { date: todayIso(), amount: receipt.amount, merchant: receipt.merchant },
    await loadRecentTxns(),
  );
  if (!txn) return moveToUnparsed(filePath, "no-txn-match");

  await attachReceiptToTxn(txn.id, receipt);
  await moveToArchive(filePath, receipt.merchant);
}
```

And in `apps/daemon/src/paths.ts`:

```ts
export const INBOX_SCREENSHOTS = path.join(INBOX, "screenshots");
export const ARCHIVE_SCREENSHOTS = path.join(ARCHIVE, "screenshots");
// per-merchant subdirs are created on demand: archive/screenshots/zepto/, etc.
```

## Notes for future work

- **Receipt date parsing.** The matcher takes a date from the caller. Today the parsers don't extract the order date from the receipt text — when integrating, default to the screenshot file's mtime (or today's date if mtime is bogus). A follow-up could extract `Delivered on DD MMM, HH:MM` lines.
- **Rupee glyph fragility.** Vision frequently misreads `₹` as `7`, `{`, or `Z`. `_util.ts:parseInr` handles this; parsers prefer label-based total extraction over position-based extraction for that reason.
- **HEIC support.** macOS Vision handles HEIC natively via ImageIO; no decode step needed in TS.
