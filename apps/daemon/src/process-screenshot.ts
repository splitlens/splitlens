/**
 * Per-screenshot processing — the OCR side of the daemon. Mirrors
 * process-file.ts for PDFs, but the pipeline is OCR → parseReceipt → matchTxn
 * → write a transaction_sources row → archive.
 *
 * Scope of work the watcher hands off:
 *   inbox/screenshots/<file>.png   →  archive/screenshots/<merchant>/<file>
 *                                  →  unparsed/<file>          (on any failure)
 *
 * Failure modes — each routes the file to unparsed/ with an .error.log
 * sibling so the user (and later us) can triage without running grep over the
 * daemon's main log:
 *   - unsupported extension      → kind: "unsupported_image"
 *   - splitlens-vision missing   → kind: "vision_unavailable"  (install hint in log)
 *   - vision spawn / OCR failure → kind: "ocr_failed"
 *   - no parser recognized text  → kind: "no_parser_match"
 *   - parser hit but no txn pair → kind: "no_txn_match"
 *   - sqlite write failed        → kind: "write_failed"
 *
 * No coupling to chokidar here — `processScreenshotFile` takes a path and a
 * DB and is unit-testable on its own.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";

import { sql } from "drizzle-orm";

import { accounts, statements, transactionSources, type SplitLensDb } from "@splitlens/db";
import {
  matchTxn,
  parseReceipt,
  recognizeText,
  VisionRuntimeError,
  VisionUnavailableError,
  type ExtractedReceipt,
  type MatchableTxn,
} from "@splitlens/ocr";

import type { DaemonPaths } from "./paths";

export type ScreenshotOutcome =
  | { kind: "unsupported_image"; ext: string }
  | { kind: "vision_unavailable"; message: string }
  | { kind: "ocr_failed"; error: Error }
  | { kind: "no_parser_match" }
  | {
      kind: "no_txn_match";
      receipt: ExtractedReceipt;
    }
  | {
      kind: "ingested";
      receipt: ExtractedReceipt;
      transactionId: number;
      sourceType: string;
    }
  | { kind: "write_failed"; receipt: ExtractedReceipt; error: Error };

export interface ProcessedScreenshot {
  src: string;
  dst: string;
  outcome: ScreenshotOutcome;
}

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".heic"]);

/** Look back this many days when assembling the candidate txn pool for matching. */
const MATCH_LOOKBACK_DAYS = 14;

export interface ProcessScreenshotOptions {
  /** Override the resolved Vision binary path. Tests use this. */
  visionBinPath?: string;
  /** Override the date we pretend the receipt is dated. Default: file mtime. */
  receiptDateIso?: string;
}

export async function processScreenshotFile(
  filePath: string,
  db: SplitLensDb,
  paths: DaemonPaths,
  opts: ProcessScreenshotOptions = {},
): Promise<ProcessedScreenshot> {
  const name = basename(filePath);
  const ext = extname(name).toLowerCase();
  const outcome = await runPipeline(filePath, db, opts);
  const dst = destinationFor(name, outcome, paths);

  mkdirSync(dirname(dst), { recursive: true });
  renameSync(filePath, dst);

  if (
    outcome.kind === "ocr_failed" ||
    outcome.kind === "no_parser_match" ||
    outcome.kind === "no_txn_match" ||
    outcome.kind === "write_failed" ||
    outcome.kind === "unsupported_image" ||
    outcome.kind === "vision_unavailable"
  ) {
    const logPath = dst + ".error.log";
    appendFileSync(logPath, [
      `# ${new Date().toISOString()}`,
      `file: ${name}`,
      `ext: ${ext}`,
      `outcome: ${outcome.kind}`,
      describeOutcome(outcome),
      "",
    ].join("\n"));
  }

  return { src: filePath, dst, outcome };
}

async function runPipeline(
  filePath: string,
  db: SplitLensDb,
  opts: ProcessScreenshotOptions,
): Promise<ScreenshotOutcome> {
  const ext = extname(filePath).toLowerCase();
  if (!IMG_EXT.has(ext)) return { kind: "unsupported_image", ext };

  // 1. OCR.
  let ocr;
  try {
    ocr = await recognizeText(filePath, { binPath: opts.visionBinPath });
  } catch (err) {
    if (err instanceof VisionUnavailableError) {
      return { kind: "vision_unavailable", message: err.message };
    }
    if (err instanceof VisionRuntimeError) {
      return { kind: "ocr_failed", error: err };
    }
    return { kind: "ocr_failed", error: err as Error };
  }

  // 2. Per-merchant parser.
  const receipt = parseReceipt(ocr.lines);
  if (!receipt) return { kind: "no_parser_match" };

  // 3. Date the receipt — file mtime is the best signal we have until parsers
  //    learn to read order timestamps. Tests can override via receiptDateIso.
  const receiptDate = opts.receiptDateIso ?? mtimeIso(filePath);

  // 4. Candidate canonical txns inside the match window.
  const candidates = loadRecentTxns(db, receiptDate, MATCH_LOOKBACK_DAYS);
  const matched = matchTxn(
    { date: receiptDate, amount: receipt.amount, merchant: receipt.merchant },
    candidates,
  );
  if (!matched) return { kind: "no_txn_match", receipt };

  // 5. Persist a transaction_sources row pointing at the matched txn.
  const sourceType = `${receipt.merchant}_ocr`;
  try {
    attachReceiptToTxn(db, {
      transactionId: matched.id as number,
      accountId: matched.accountId,
      receipt,
      sourceType,
      sourceFile: filePath,
    });
  } catch (err) {
    return { kind: "write_failed", receipt, error: err as Error };
  }
  return {
    kind: "ingested",
    receipt,
    transactionId: matched.id as number,
    sourceType,
  };
}

function describeOutcome(o: ScreenshotOutcome): string {
  switch (o.kind) {
    case "unsupported_image":
      return `ext "${o.ext}" not in ${[...IMG_EXT].join(", ")}`;
    case "vision_unavailable":
      return o.message;
    case "ocr_failed":
      return `error: ${o.error.message}\n${o.error.stack ?? ""}`;
    case "no_parser_match":
      return "no merchant parser recognized the OCR'd text";
    case "no_txn_match":
      return (
        `parsed ${o.receipt.merchant} receipt ` +
        `(₹${o.receipt.amount}, ${o.receipt.items.length} items) ` +
        `but no canonical txn matched within the date/amount window`
      );
    case "write_failed":
      return `error: ${o.error.message}\n${o.error.stack ?? ""}`;
    case "ingested":
      return `attached to txn ${o.transactionId} as ${o.sourceType}`;
  }
}

function destinationFor(
  name: string,
  outcome: ScreenshotOutcome,
  paths: DaemonPaths,
): string {
  if (outcome.kind === "ingested") {
    return join(paths.archiveScreenshots, outcome.receipt.merchant, name);
  }
  return join(paths.unparsed, name);
}

interface TxnRow extends MatchableTxn {
  id: number;
  accountId: number;
}

function loadRecentTxns(
  db: SplitLensDb,
  receiptDateIso: string,
  windowDays: number,
): TxnRow[] {
  const sinceIso = isoDateMinusDays(receiptDateIso, windowDays);
  const untilIso = isoDatePlusDays(receiptDateIso, windowDays);
  const rows = db.all<{
    id: number;
    account_id: number;
    txn_date: string;
    withdrawal: number | null;
    narration: string | null;
  }>(sql`
    SELECT id, account_id, txn_date, withdrawal, narration
    FROM transactions
    WHERE withdrawal IS NOT NULL
      AND txn_date >= ${sinceIso}
      AND txn_date <= ${untilIso}
  `);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.txn_date,
    amount: r.withdrawal ?? 0,
    narration: r.narration ?? undefined,
  }));
}

function attachReceiptToTxn(
  db: SplitLensDb,
  args: {
    transactionId: number;
    accountId: number;
    receipt: ExtractedReceipt;
    sourceType: string;
    sourceFile: string;
  },
): void {
  // SHA-256 of the file bytes — keeps re-runs idempotent: re-dropping the
  // same screenshot would fail the unique sourceHash constraint and we'd
  // route the rerun to unparsed/ instead of double-attaching.
  const sourceHash = sha256File(args.sourceFile);

  db.transaction((tx) => {
    // 1. Look up or create the synthetic statement for this screenshot.
    const existing = tx
      .select({ id: statements.id })
      .from(statements)
      .where(sql`source_hash = ${sourceHash}`)
      .get();
    let statementId: number;
    if (existing) {
      statementId = existing.id;
    } else {
      // Defensive: don't reference an account that isn't there.
      const accountExists = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(sql`id = ${args.accountId}`)
        .get();
      if (!accountExists) {
        throw new Error(`account ${args.accountId} not found in DB`);
      }
      const inserted = tx
        .insert(statements)
        .values({
          accountId: args.accountId,
          sourceFile: args.sourceFile,
          sourceHash,
          sourceType: args.sourceType,
          periodFrom: null,
          periodTo: null,
          pageCount: null,
          txnCount: 1,
        })
        .returning({ id: statements.id })
        .get();
      statementId = inserted.id;
    }

    // 2. Insert the transaction_sources row. source_row_idx is the canonical
    //    transaction id — guaranteed unique within a per-screenshot statement.
    tx.insert(transactionSources)
      .values({
        transactionId: args.transactionId,
        sourceType: args.sourceType,
        statementId,
        sourceRowIdx: args.transactionId,
        sourceTxnId: args.receipt.orderId,
        rawJson: JSON.stringify({
          merchant: args.receipt.merchant,
          amount: args.receipt.amount,
          orderId: args.receipt.orderId,
          items: args.receipt.items,
          rawLines: args.receipt.rawLines,
        }),
      })
      .run();
  });
}

// ── tiny helpers ───────────────────────────────────────────────────────────

function mtimeIso(filePath: string): string {
  const ms = statSync(filePath).mtimeMs;
  return new Date(ms).toISOString().slice(0, 10);
}

function isoDatePlusDays(iso: string, days: number): string {
  const t = Date.parse(iso) + days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

function isoDateMinusDays(iso: string, days: number): string {
  return isoDatePlusDays(iso, -days);
}

function sha256File(filePath: string): string {
  // Synchronous read is fine: typical receipt screenshots are well under 1MB,
  // and we're called inside a better-sqlite3 transaction that can't await.
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
