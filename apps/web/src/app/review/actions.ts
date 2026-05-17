"use server";

import "server-only";
import { copyFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { openDb } from "@splitlens/db";
import { DEFAULT_PEOPLE } from "@splitlens/core";
import {
  ingestZeptoInvoice,
  isForcedAttachmentDuplicate,
  writeForcedAttachment,
} from "@splitlens/ingest";
import {
  parseReceipt,
  recognizeText,
  VisionRuntimeError,
  VisionUnavailableError,
} from "@splitlens/ocr";
import { extractCounterpartyFromNarration } from "@/lib/narration";

// ============================================================================
// Field edits — counterparty / category / narration / notes / person
// ============================================================================

export interface TransactionEdits {
  counterparty?: string | null;
  category?: string | null;
  narration?: string | null;
  notes?: string | null;
  personId?: string | null;
  /**
   * Names of friends this txn is split with (excluding "me"). Stored as a
   * JSON-encoded text array in `shared_with`. Setting this also derives
   * `share_count` (length + 1) unless `shareCount` is given explicitly.
   * Pass `null` to clear (back to "just me").
   */
  sharedWith?: string[] | null;
  /**
   * Explicit override for share_count. Usually omitted — derived from
   * sharedWith.length + 1. Useful when you want to say "3-way split" but
   * haven't named the third person yet.
   */
  shareCount?: number;
  /**
   * How often this expense recurs. App-enforced enum: 'one_time' |
   * 'monthly' | 'weekly' | 'quarterly' | 'yearly'. Pass `null` to clear.
   */
  recurrence?:
    | "one_time"
    | "monthly"
    | "weekly"
    | "quarterly"
    | "yearly"
    | null;
  /** When true, also set reviewed=1 (the "Save + mark reviewed" path). */
  markReviewed?: boolean;
}

/**
 * Persist user-edited fields on a transaction. The merger guarantees
 * reviewed=1 rows are never overwritten by future ingestion, so flipping
 * the reviewed flag here doubles as edit-protection.
 *
 * `null` values are treated as "clear this field", not "leave unchanged".
 * Omit a key from `edits` to leave it alone — TypeScript optional vs
 * explicit null.
 */
export async function updateTransaction(
  txnId: number,
  edits: TransactionEdits,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) {
    return { ok: false, error: "invalid txnId" };
  }
  // Validate personId against the registry if it's being set to a non-null
  // value. Allow clearing (null).
  if (edits.personId != null) {
    const known = new Set(DEFAULT_PEOPLE.map((p) => p.id));
    if (!known.has(edits.personId)) {
      return { ok: false, error: `unknown person: ${edits.personId}` };
    }
  }

  // Compose the SET clause only from keys actually present in `edits`.
  // sql.empty + sql.join keeps the binding code readable and injection-safe.
  const fragments: ReturnType<typeof sql>[] = [];
  if ("counterparty" in edits) {
    fragments.push(sql`counterparty = ${edits.counterparty}`);
  }
  if ("category" in edits) {
    fragments.push(sql`category = ${edits.category}`);
    // When the user manually picks a category, drop the rule attribution —
    // the next merge pass shouldn't think a rule produced this.
    fragments.push(sql`category_rule = NULL`);
  }
  if ("narration" in edits) {
    fragments.push(sql`narration = ${edits.narration}`);
  }
  if ("notes" in edits) {
    fragments.push(sql`notes = ${edits.notes}`);
  }
  if ("personId" in edits) {
    fragments.push(sql`person_id = ${edits.personId}`);
  }
  if ("sharedWith" in edits) {
    // Clearing → NULL in shared_with, 1 in share_count (back to "just me").
    // The on-disk shape is a comma-separated string (matches what the
    // detail repo reads), not JSON.
    if (edits.sharedWith == null || edits.sharedWith.length === 0) {
      fragments.push(sql`shared_with = NULL`);
      if (!("shareCount" in edits)) fragments.push(sql`share_count = 1`);
    } else {
      const cleaned = edits.sharedWith
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      fragments.push(sql`shared_with = ${cleaned.join(", ")}`);
      if (!("shareCount" in edits)) {
        fragments.push(sql`share_count = ${cleaned.length + 1}`);
      }
    }
  }
  if ("shareCount" in edits && typeof edits.shareCount === "number") {
    fragments.push(sql`share_count = ${Math.max(1, Math.floor(edits.shareCount))}`);
  }
  if ("recurrence" in edits) {
    fragments.push(sql`recurrence = ${edits.recurrence}`);
  }
  if (edits.markReviewed) {
    fragments.push(sql`reviewed = 1`);
  }
  if (fragments.length === 0) {
    return { ok: true };
  }
  fragments.push(sql`updated_at = CURRENT_TIMESTAMP`);

  const db = openDb();
  db.run(sql`
    UPDATE transactions
    SET ${sql.join(fragments, sql`, `)}
    WHERE id = ${txnId}
  `);

  revalidatePath("/review");
  revalidatePath("/dashboard");
  revalidatePath("/reports", "layout");
  if (edits.personId) revalidatePath(`/friends/${edits.personId}`);
  return { ok: true };
}

// ============================================================================
// Bill attach — drag-and-drop a file in, force-route it to the picked txn
// ============================================================================

export type AttachBillResult =
  | {
      ok: true;
      kind: "zepto_invoice";
      transactionId: number;
      orderNo: string;
      amount: number;
      itemCount: number;
    }
  | {
      ok: true;
      kind: "ocr_attached";
      transactionId: number;
      merchant: string;
      amount: number;
      itemCount: number;
    }
  | {
      ok: true;
      kind: "manual_attached";
      transactionId: number;
      fileName: string;
      /** Brief human-readable explanation of what happened (OCR fallback, plain file, etc.). */
      reason: string;
    }
  | { ok: false; error: string };

/**
 * Server action used by the review-form dropzone. Always synchronous —
 * no daemon dependency. By the time we return, either:
 *   (a) a transaction_sources row has been written, or
 *   (b) an error has been reported.
 *
 * Routing by file type:
 *   - `zepto_invoice_*.pdf`           → ingestZeptoInvoice (parses items inline)
 *   - `.png | .jpg | .jpeg | .heic`   → OCR via @splitlens/ocr; if a known
 *                                       merchant parser recognizes the text we
 *                                       attach with the parsed items, else we
 *                                       attach as `manual_attachment` keeping
 *                                       the raw OCR lines so search still works
 *   - Other `.pdf`                    → attach as `manual_attachment` (no parse;
 *                                       file referenced by path)
 *
 * All non-Zepto attachments land in
 *   `~/Documents/bank/archive/manual/<txnId>/<filename>`
 * so the user always knows where to find an attached file ("everything for
 * txn #N is in archive/manual/N/").
 *
 * Idempotent: re-dropping a byte-identical file returns an error citing the
 * existing attachment (uq_statement_source_hash).
 */
export async function attachBillToTransaction(
  txnId: number,
  fileName: string,
  base64: string,
): Promise<AttachBillResult> {
  if (!Number.isInteger(txnId) || txnId <= 0) {
    return { ok: false, error: "invalid txnId" };
  }
  const cleanName = basename(fileName).replace(/[^A-Za-z0-9._-]/g, "_");
  if (cleanName.length === 0 || cleanName.length > 200) {
    return { ok: false, error: "invalid file name" };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "couldn't decode base64 payload" };
  }
  if (bytes.length === 0) return { ok: false, error: "empty file" };
  if (bytes.length > 25 * 1024 * 1024) {
    return { ok: false, error: "file too large (>25 MB)" };
  }

  const ext = extname(cleanName).toLowerCase();
  const bankRoot =
    process.env.SPLITLENS_BANK_ROOT ?? join(homedir(), "Documents", "bank");

  // Preflight dedup — runs BEFORE any disk write so re-dropping a file that
  // is already attached to THIS txn doesn't overwrite-then-unlink the
  // existing archive copy. Per-txn scoping means the same bytes can still
  // attach to a different txn.
  {
    const db = openDb();
    if (isForcedAttachmentDuplicate(db, txnId, bytes)) {
      return {
        ok: false,
        error: "This file is already attached to this transaction.",
      };
    }
  }

  // === Path 1: Zepto invoice PDF — synchronous parse + force-attach ===
  if (ext === ".pdf" && /^zepto_invoice_/i.test(cleanName)) {
    // Drop into a staging dir under .splitlens/ so a partial write can't
    // trigger the daemon's invoice watcher. Move into archive/ after the
    // ingest succeeds.
    const stagingDir = join(bankRoot, ".splitlens", "review-attach");
    mkdirSync(stagingDir, { recursive: true });
    const stagedPath = join(stagingDir, `${Date.now()}_${cleanName}`);
    writeFileSync(stagedPath, bytes);

    const db = openDb();
    const outcome = await ingestZeptoInvoice(stagedPath, db, {
      forceTransactionId: txnId,
    });
    if (outcome.kind !== "enriched") {
      // Move to unparsed/ so the user can retry from a familiar place
      const unparsedDir = join(bankRoot, "unparsed");
      mkdirSync(unparsedDir, { recursive: true });
      const dst = join(unparsedDir, cleanName);
      try {
        renameSync(stagedPath, dst);
      } catch {
        /* leave the staged file in place if move fails */
      }
      return {
        ok: false,
        error:
          outcome.kind === "parse_failed"
            ? outcome.reason
            : outcome.kind === "skipped_duplicate"
              ? "this PDF was already ingested earlier"
              : "no canonical match (force-attach failed unexpectedly)",
      };
    }
    // Success — move to archive/invoices/zepto/<name>
    const archiveDir = join(bankRoot, "archive", "invoices", "zepto");
    mkdirSync(archiveDir, { recursive: true });
    const archivedPath = join(archiveDir, cleanName);
    try {
      renameSync(stagedPath, archivedPath);
    } catch {
      /* file already gone or perms issue — the source row is still attached */
    }
    revalidatePath("/review");
    revalidatePath("/dashboard");
    return {
      ok: true,
      kind: "zepto_invoice",
      transactionId: outcome.transactionId,
      orderNo: outcome.invoice.orderNo,
      amount: outcome.invoice.amount,
      itemCount: outcome.invoice.items.length,
    };
  }

  // === Path 2: Image — sync OCR + force-attach ===
  const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".heic"]);
  if (IMG_EXT.has(ext)) {
    return await attachImage({ bankRoot, txnId, cleanName, ext, bytes });
  }

  // === Path 3: Other PDF — manual attachment (no parse) ===
  if (ext === ".pdf") {
    return await attachManual({
      bankRoot,
      txnId,
      cleanName,
      ext,
      bytes,
      mime: "application/pdf",
      reason:
        "Stored as a manual attachment — non-Zepto PDFs aren't parsed today.",
    });
  }

  return {
    ok: false,
    error: `unsupported file type "${ext}". Drop a PDF or an image (.png, .jpg, .heic).`,
  };
}

// ============================================================================
// Image path — OCR via @splitlens/ocr, force-attach with parsed items if a
// known parser matches, otherwise fall back to manual_attachment.
// ============================================================================

async function attachImage(args: {
  bankRoot: string;
  txnId: number;
  cleanName: string;
  ext: string;
  bytes: Buffer;
}): Promise<AttachBillResult> {
  const { bankRoot, txnId, cleanName, ext, bytes } = args;

  // Stage to a temp file under .splitlens/ so the daemon's screenshot watcher
  // can't see it mid-write. Move into archive/manual/<txnId>/ after success.
  const stagingDir = join(bankRoot, ".splitlens", "review-attach");
  mkdirSync(stagingDir, { recursive: true });
  const stagedPath = join(stagingDir, `${Date.now()}_${cleanName}`);
  writeFileSync(stagedPath, bytes);

  // OCR. If the Vision binary isn't installed we fall through to manual.
  let ocrLines: string[] | null = null;
  let ocrError: string | null = null;
  try {
    const ocr = await recognizeText(stagedPath);
    ocrLines = ocr.lines;
  } catch (e) {
    if (e instanceof VisionUnavailableError) {
      ocrError = "OCR binary not installed (run `pnpm --filter @splitlens/ocr build:swift`)";
    } else if (e instanceof VisionRuntimeError) {
      ocrError = `OCR failed: ${e.message}`;
    } else {
      ocrError = String(e);
    }
  }

  const parsed = ocrLines ? parseReceipt(ocrLines) : null;
  const sourceType = parsed ? `${parsed.merchant}_ocr` : "manual_attachment";

  // Move from staging → archive/manual/<txnId>/<name>
  const archivedPath = moveToArchive(bankRoot, txnId, cleanName, stagedPath);
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".heic"
        ? "image/heic"
        : "image/jpeg";

  const db = openDb();
  const outcome = writeForcedAttachment({
    db,
    transactionId: txnId,
    sourceType,
    sourceFile: archivedPath,
    fileBytes: bytes,
    sourceTxnId: parsed?.orderId ?? null,
    rawJson: parsed
      ? {
          merchant: parsed.merchant,
          amount: parsed.amount,
          orderId: parsed.orderId,
          items: parsed.items,
          rawLines: parsed.rawLines,
        }
      : {
          fileName: cleanName,
          mimeType: mime,
          fileSize: bytes.length,
          ocrLines: ocrLines ?? [],
          ocrError,
        },
  });

  if (outcome.kind === "duplicate") {
    // Reached only via a race (two concurrent attaches of the same file to
    // the same txn passed preflight independently). The file at archivedPath
    // is either the winner's copy (same path + same bytes) or the loser's;
    // either way it must NOT be unlinked — that would destroy the winner's
    // attachment. Leave the few KB on disk and surface the error.
    return {
      ok: false,
      error: "This file is already attached to this transaction.",
    };
  }
  if (outcome.kind === "txn_not_found") {
    return { ok: false, error: `transaction ${txnId} not found` };
  }
  if (outcome.kind === "failed") {
    return { ok: false, error: outcome.error.message };
  }

  revalidatePath("/review");
  revalidatePath("/dashboard");

  if (parsed) {
    return {
      ok: true,
      kind: "ocr_attached",
      transactionId: txnId,
      merchant: parsed.merchant,
      amount: parsed.amount,
      itemCount: parsed.items.length,
    };
  }
  return {
    ok: true,
    kind: "manual_attached",
    transactionId: txnId,
    fileName: cleanName,
    reason: ocrError
      ? `${ocrError} — stored as a manual attachment.`
      : "No merchant parser matched — stored as a manual attachment with raw OCR text searchable.",
  };
}

// ============================================================================
// Manual path — write the file under archive/manual/<txnId>/ and create a
// transaction_sources row with sourceType=manual_attachment. Used for
// non-Zepto PDFs (and any image whose OCR fell through).
// ============================================================================

async function attachManual(args: {
  bankRoot: string;
  txnId: number;
  cleanName: string;
  ext: string;
  bytes: Buffer;
  mime: string;
  reason: string;
}): Promise<AttachBillResult> {
  const { bankRoot, txnId, cleanName, bytes, mime, reason } = args;

  const archiveDir = join(bankRoot, "archive", "manual", String(txnId));
  mkdirSync(archiveDir, { recursive: true });
  const archivedPath = join(archiveDir, cleanName);
  writeFileSync(archivedPath, bytes);

  const db = openDb();
  const outcome = writeForcedAttachment({
    db,
    transactionId: txnId,
    sourceType: "manual_attachment",
    sourceFile: archivedPath,
    fileBytes: bytes,
    rawJson: {
      fileName: cleanName,
      mimeType: mime,
      fileSize: bytes.length,
    },
  });

  if (outcome.kind === "duplicate") {
    // Race-only path (see note in attachImage). Do NOT unlink — would
    // destroy the winner's archive copy.
    return {
      ok: false,
      error: "This file is already attached to this transaction.",
    };
  }
  if (outcome.kind === "txn_not_found") {
    return { ok: false, error: `transaction ${txnId} not found` };
  }
  if (outcome.kind === "failed") {
    return { ok: false, error: outcome.error.message };
  }

  revalidatePath("/review");
  revalidatePath("/dashboard");

  return {
    ok: true,
    kind: "manual_attached",
    transactionId: txnId,
    fileName: cleanName,
    reason,
  };
}

/** Move a staged file into archive/manual/<txnId>/<name> with directory creation. */
function moveToArchive(
  bankRoot: string,
  txnId: number,
  cleanName: string,
  stagedPath: string,
): string {
  const archiveDir = join(bankRoot, "archive", "manual", String(txnId));
  mkdirSync(archiveDir, { recursive: true });
  const archivedPath = join(archiveDir, cleanName);
  try {
    renameSync(stagedPath, archivedPath);
  } catch {
    // Cross-device fallback: copy + unlink
    copyFileSync(stagedPath, archivedPath);
    try {
      unlinkSync(stagedPath);
    } catch {
      /* leave */
    }
  }
  return archivedPath;
}

// ============================================================================
// Quick toggles — duplicated rather than re-exported because Next.js
// "use server" modules require each export to be a directly-defined async
// function. The bodies are tiny so this isn't a real duplication concern.
// ============================================================================

export async function markReviewed(
  txnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) return { ok: false, error: "invalid id" };
  const db = openDb();
  db.run(sql`
    UPDATE transactions
    SET reviewed = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${txnId}
  `);
  revalidatePath("/review");
  revalidatePath("/dashboard");
  revalidatePath("/reports", "layout");
  return { ok: true };
}

export async function unmarkReviewed(
  txnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) return { ok: false, error: "invalid id" };
  const db = openDb();
  db.run(sql`
    UPDATE transactions
    SET reviewed = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${txnId}
  `);
  revalidatePath("/review");
  revalidatePath("/dashboard");
  revalidatePath("/reports", "layout");
  return { ok: true };
}

// ============================================================================
// Custom categories — user-defined entries that extend the curated taxonomy.
// ============================================================================

const COLOR_PALETTE = new Set([
  "rose",
  "orange",
  "amber",
  "lime",
  "emerald",
  "teal",
  "sky",
  "indigo",
  "violet",
  "fuchsia",
  "pink",
  "blue",
  "cyan",
  "yellow",
  "purple",
  "red",
  "green",
]);

export interface CreateCategoryInput {
  /** Canonical id stored in transactions.category. */
  id: string;
  label: string;
  emoji: string;
  colorKey: string;
  hint?: string | null;
}

export async function createCustomCategory(
  input: CreateCategoryInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = input.id.trim();
  const label = input.label.trim();
  const emoji = input.emoji.trim();
  const colorKey = input.colorKey.trim();
  if (!id || !label || !emoji || !colorKey) {
    return { ok: false, error: "id, label, emoji and color are required" };
  }
  if (!COLOR_PALETTE.has(colorKey)) {
    return { ok: false, error: `unknown color: ${colorKey}` };
  }
  if (id.length > 64 || label.length > 64) {
    return { ok: false, error: "id and label must be ≤ 64 chars" };
  }
  // emoji can be a multi-codepoint glyph; just cap the byte budget.
  if (emoji.length > 16) {
    return { ok: false, error: "emoji must be a single glyph" };
  }

  const db = openDb();
  try {
    db.run(sql`
      INSERT INTO custom_categories (id, label, emoji, color_key, hint)
      VALUES (${id}, ${label}, ${emoji}, ${colorKey}, ${input.hint ?? null})
    `);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) {
      return { ok: false, error: `category "${id}" already exists` };
    }
    return { ok: false, error: msg };
  }
  revalidatePath("/review");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteCustomCategory(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "id required" };
  const db = openDb();
  db.run(sql`DELETE FROM custom_categories WHERE id = ${id}`);
  revalidatePath("/review");
  return { ok: true };
}

// ============================================================================
// Merchant labels — sticky "what is this charge really" annotations
// ============================================================================

export interface SaveMerchantLabelInput {
  counterparty: string;
  /**
   * INR amount (rounded). NULL = label applies to ALL amounts for this
   * counterparty (the fallback row). Per-amount labels take precedence over
   * the fallback at read time.
   */
  amountInr: number | null;
  /** User-friendly product name, e.g. "iCloud+ 200GB". */
  label: string;
  /** Optional category to surface in SmartSuggest when slot is empty. */
  categoryHint?: string | null;
}

/**
 * UPSERT a sticky merchant label. The (counterparty, amount_inr) pair is
 * unique — re-saving updates the existing row.
 *
 * Local to this device; no sync.
 */
export async function saveMerchantLabel(
  input: SaveMerchantLabelInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cp = input.counterparty?.trim();
  const label = input.label?.trim();
  if (!cp) return { ok: false, error: "counterparty required" };
  if (!label) return { ok: false, error: "label required" };
  if (label.length > 120) {
    return { ok: false, error: "label too long (max 120 chars)" };
  }
  const amount =
    input.amountInr == null ? null : Math.max(0, Math.round(input.amountInr));
  const categoryHint = input.categoryHint?.trim() || null;

  const db = openDb();
  // SQLite's ON CONFLICT requires a target — here it's the (counterparty,
  // amount_inr) unique index. amount_inr=NULL is its own slot since SQLite
  // treats NULL as distinct in unique indexes.
  db.run(sql`
    INSERT INTO merchant_labels (counterparty, amount_inr, label, category_hint, updated_at)
    VALUES (${cp}, ${amount}, ${label}, ${categoryHint}, CURRENT_TIMESTAMP)
    ON CONFLICT(counterparty, amount_inr) DO UPDATE SET
      label = excluded.label,
      category_hint = excluded.category_hint,
      updated_at = CURRENT_TIMESTAMP
  `);
  revalidatePath("/review");
  return { ok: true };
}

/**
 * Remove a sticky label. Useful when the user mislabels and wants to start
 * over (the UI doesn't expose this yet, but the action is here for the
 * future "manage labels" surface).
 */
export async function deleteMerchantLabel(
  counterparty: string,
  amountInr: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cp = counterparty?.trim();
  if (!cp) return { ok: false, error: "counterparty required" };
  const amount = amountInr == null ? null : Math.round(amountInr);
  const db = openDb();
  if (amount == null) {
    db.run(sql`
      DELETE FROM merchant_labels
      WHERE counterparty = ${cp} AND amount_inr IS NULL
    `);
  } else {
    db.run(sql`
      DELETE FROM merchant_labels
      WHERE counterparty = ${cp} AND amount_inr = ${amount}
    `);
  }
  revalidatePath("/review");
  return { ok: true };
}

// ============================================================================
// Merchant deep-dive — every transaction with this counterparty, plus the
// aggregates needed to render the takeover view from MerchantHistoryCard.
// Fetched on demand (lazy) when the user clicks the merchant card; not part
// of the bulk review payload.
// ============================================================================

export interface MerchantDetailTxn {
  id: number;
  /** ISO YYYY-MM-DD */
  txnDate: string;
  /** HH:MM, only present for CC parsers. */
  txnTime: string | null;
  /** Absolute INR (already abs in computeSuggestion convention). */
  amountInr: number;
  /** True for deposit/credit rows (refunds etc.); false for spend. */
  isCredit: boolean;
  category: string | null;
  personId: string | null;
  notes: string | null;
  narration: string | null;
  accountBank: string;
  accountType: string;
  accountLast4: string;
  reviewed: boolean;
}

export interface MerchantMonthlyBucket {
  /** "YYYY-MM" */
  yearMonth: string;
  totalInr: number;
  count: number;
}

export interface MerchantDowBucket {
  /** 0 = Sunday, 6 = Saturday. */
  dow: number;
  count: number;
  totalInr: number;
}

export interface MerchantHourBucket {
  /** 0-23 (local hour from txn_time HH:MM). */
  hour: number;
  count: number;
  totalInr: number;
}

export interface MerchantDetail {
  counterparty: string;
  totalSpentInr: number;
  count: number;
  /** Mean charge (rounded INR). */
  avgInr: number;
  medianInr: number;
  minInr: number;
  maxInr: number;
  /** ISO YYYY-MM-DD. */
  firstSeen: string;
  /** ISO YYYY-MM-DD. */
  lastSeen: string;
  /** Single largest charge (handy callout). */
  biggestInr: number;
  /** Date of the biggest single charge. */
  biggestDate: string;
  /** All same-counterparty rows, newest first, capped at 500. */
  txns: MerchantDetailTxn[];
  /** Bucketed monthly aggregates, oldest first, gaps filled with 0s. */
  monthly: MerchantMonthlyBucket[];
  /** Day-of-week aggregates (always present — every txn has a date). */
  dow: MerchantDowBucket[];
  /** Hour-of-day aggregates (CC only; empty when no time data). */
  hour: MerchantHourBucket[];
  /** True when txns array was truncated (caller can show a notice). */
  truncated: boolean;
}

const MERCHANT_DETAIL_CAP = 500;

export async function getMerchantDetail(
  counterparty: string,
): Promise<MerchantDetail | null> {
  const cp = counterparty?.trim();
  if (!cp) return null;

  const db = openDb();
  // Two-path scan, matching computeSuggestion in review-repo.ts:
  //   a) Stored counterparty matches (case-insensitive)
  //   b) Counterparty IS NULL but narration extraction yields the same
  //      name — handles the common case where ingestion didn't capture a
  //      counterparty but the rail's displayCounterparty fallback labels
  //      every row with the same inferred name.
  // Loose LIKE filter at SQL, then strict post-filter in JS using
  // extractCounterpartyFromNarration. Over-fetch by 2× so the post-filter
  // can drop noise without truncating real matches.
  const candidates = db.all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    withdrawal: number | null;
    deposit: number | null;
    counterparty: string | null;
    category: string | null;
    person_id: string | null;
    notes: string | null;
    narration: string | null;
    reviewed: number;
    bank: string;
    type: string;
    last4: string;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.withdrawal, t.deposit,
           t.counterparty,
           t.category, t.person_id, t.notes, t.narration, t.reviewed,
           a.bank, a.type, a.last4
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.counterparty = ${cp} COLLATE NOCASE
       OR (
         t.counterparty IS NULL
         AND LOWER(t.narration) LIKE ${"%" + cp.toLowerCase() + "%"}
       )
    ORDER BY t.txn_date DESC, t.id DESC
    LIMIT ${(MERCHANT_DETAIL_CAP + 1) * 2}
  `);
  const cpLower = cp.toLowerCase();
  const rows = candidates.filter((r) => {
    if (r.counterparty != null && r.counterparty.trim().length > 0) {
      return true;
    }
    const extracted = extractCounterpartyFromNarration(r.narration);
    return extracted != null && extracted.toLowerCase() === cpLower;
  });

  if (rows.length === 0) return null;

  const truncated = rows.length > MERCHANT_DETAIL_CAP;
  const sliced = truncated ? rows.slice(0, MERCHANT_DETAIL_CAP) : rows;

  const txns: MerchantDetailTxn[] = sliced.map((r) => {
    const isCredit = r.withdrawal == null && r.deposit != null;
    const amountInr = Math.abs(r.withdrawal ?? r.deposit ?? 0);
    return {
      id: r.id,
      txnDate: r.txn_date,
      txnTime: r.txn_time,
      amountInr,
      isCredit,
      category: r.category,
      personId: r.person_id,
      notes: r.notes,
      narration: r.narration,
      accountBank: r.bank,
      accountType: r.type,
      accountLast4: r.last4,
      reviewed: Boolean(r.reviewed),
    };
  });

  // ─── Aggregates ──────────────────────────────────────────────────────
  // Run over the (uncapped-ish) sliced array. We treat credits as 0 spend
  // for total/median/biggest — refunds shouldn't inflate "total spent at
  // Blinkit". Count still includes them so the visit count matches the
  // user's mental model.
  const spendAmounts: number[] = [];
  let total = 0;
  let biggest = 0;
  let biggestDate = txns[0]!.txnDate;
  let minSpend = Number.POSITIVE_INFINITY;

  const monthlyMap = new Map<string, { totalInr: number; count: number }>();
  const dowMap = new Map<number, { count: number; totalInr: number }>();
  const hourMap = new Map<number, { count: number; totalInr: number }>();

  for (const t of txns) {
    if (!t.isCredit) {
      total += t.amountInr;
      spendAmounts.push(t.amountInr);
      if (t.amountInr > biggest) {
        biggest = t.amountInr;
        biggestDate = t.txnDate;
      }
      if (t.amountInr < minSpend) minSpend = t.amountInr;
    }
    const ym = t.txnDate.slice(0, 7);
    const mb = monthlyMap.get(ym) ?? { totalInr: 0, count: 0 };
    mb.totalInr += t.isCredit ? 0 : t.amountInr;
    mb.count += 1;
    monthlyMap.set(ym, mb);

    const dow = dowOf(t.txnDate);
    if (dow != null) {
      const db = dowMap.get(dow) ?? { count: 0, totalInr: 0 };
      db.count += 1;
      db.totalInr += t.isCredit ? 0 : t.amountInr;
      dowMap.set(dow, db);
    }

    if (t.txnTime) {
      const h = parseHour(t.txnTime);
      if (h != null) {
        const hb = hourMap.get(h) ?? { count: 0, totalInr: 0 };
        hb.count += 1;
        hb.totalInr += t.isCredit ? 0 : t.amountInr;
        hourMap.set(h, hb);
      }
    }
  }

  const count = txns.length;
  const avg = spendAmounts.length === 0 ? 0 : Math.round(total / spendAmounts.length);
  const median = medianOf(spendAmounts);
  const min = minSpend === Number.POSITIVE_INFINITY ? 0 : minSpend;
  const max = biggest;

  // Build monthly array oldest→newest with zero-fill so the bar chart has
  // a continuous x-axis even for months with no charges.
  const firstYm = txns[txns.length - 1]!.txnDate.slice(0, 7);
  const lastYm = txns[0]!.txnDate.slice(0, 7);
  const monthly: MerchantMonthlyBucket[] = [];
  for (const ym of monthRange(firstYm, lastYm)) {
    const b = monthlyMap.get(ym) ?? { totalInr: 0, count: 0 };
    monthly.push({ yearMonth: ym, totalInr: b.totalInr, count: b.count });
  }

  // DOW: always emit 0..6 so the chart x-axis is stable.
  const dow: MerchantDowBucket[] = [];
  for (let d = 0; d < 7; d++) {
    const b = dowMap.get(d) ?? { count: 0, totalInr: 0 };
    dow.push({ dow: d, count: b.count, totalInr: b.totalInr });
  }

  // Hour: only emit when there's any data. Empty array signals "no time
  // info to plot" to the UI.
  const hour: MerchantHourBucket[] = [];
  if (hourMap.size > 0) {
    for (let h = 0; h < 24; h++) {
      const b = hourMap.get(h) ?? { count: 0, totalInr: 0 };
      hour.push({ hour: h, count: b.count, totalInr: b.totalInr });
    }
  }

  return {
    counterparty: cp,
    totalSpentInr: total,
    count,
    avgInr: avg,
    medianInr: median,
    minInr: min,
    maxInr: max,
    firstSeen: txns[txns.length - 1]!.txnDate,
    lastSeen: txns[0]!.txnDate,
    biggestInr: biggest,
    biggestDate,
    txns,
    monthly,
    dow,
    hour,
    truncated,
  };
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}

function dowOf(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  if (Number.isNaN(ms)) return null;
  return new Date(ms).getUTCDay();
}

function parseHour(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return h;
}

function monthRange(startYm: string, endYm: string): string[] {
  // Inclusive on both ends. Caller guarantees start ≤ end.
  const [sy, sm] = startYm.split("-").map(Number) as [number, number];
  const [ey, em] = endYm.split("-").map(Number) as [number, number];
  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    // Hard safety: 50 years' worth of months. Anything larger is a bug.
    if (out.length > 600) break;
  }
  return out;
}

// ============================================================================
// Per-merchant category rules — "always categorize Shilpa V as X"
// ============================================================================

/**
 * Persist a "this counterparty is always category X" rule AND bulk-apply
 * it to every existing un-reviewed transaction with the same counterparty.
 *
 *   1. UPSERT into merchant_category_rules (counterparty is the PK; later
 *      saves replace earlier ones so the user can change their mind).
 *   2. UPDATE transactions SET category = $cat, category_rule = 'merchant'
 *      WHERE counterparty = $cp AND reviewed = 0 — reviewed=1 rows are
 *      left alone (those are user-confirmed and trump any rule).
 *
 * Future ingestion consults merchant_category_rules and applies the
 * stored category to any newly-arriving row whose counterparty matches;
 * see packages/ingest/src/index.ts for the application point.
 *
 * Idempotent — calling with the same args twice is a no-op past the
 * first call's UPDATE.
 */
export async function applyMerchantCategoryRule(
  counterparty: string,
  category: string | null,
): Promise<{ ok: true; bulkUpdated: number } | { ok: false; error: string }> {
  const cp = counterparty.trim();
  if (!cp) return { ok: false, error: "counterparty required" };
  const cat = category == null ? null : category.trim();
  if (cat == null || cat === "") {
    // Treat clear-category as "remove the rule" — keeps the UI's
    // toggle-on-uncategorize affordance honest.
    openDb().run(
      sql`DELETE FROM merchant_category_rules WHERE counterparty = ${cp}`,
    );
    revalidatePath("/review");
    revalidatePath("/dashboard");
    return { ok: true, bulkUpdated: 0 };
  }

  const db = openDb();

  // 1. Persist the rule (UPSERT by counterparty PK).
  db.run(sql`
    INSERT INTO merchant_category_rules (counterparty, category, created_at, updated_at)
    VALUES (${cp}, ${cat}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(counterparty) DO UPDATE SET
      category = excluded.category,
      updated_at = CURRENT_TIMESTAMP
  `);

  // 2. Bulk-apply to all existing un-reviewed txns for this counterparty.
  // Skip already-correct rows so the affected-rows count is honest.
  // category_rule = 'merchant' records WHY this row has its category, so
  // the ingestion-time merger knows it came from the rule (not a SmartSuggest
  // accept) and can re-apply if the rule changes later.
  const result = db.run(sql`
    UPDATE transactions
    SET category = ${cat},
        category_rule = 'merchant',
        updated_at = CURRENT_TIMESTAMP
    WHERE counterparty = ${cp}
      AND reviewed = 0
      AND (category IS NULL OR category != ${cat})
  `);
  // better-sqlite3's Statement.run() returns { changes, lastInsertRowid }.
  // Drizzle's typing surfaces this as `unknown`, so we narrow at the boundary.
  const bulkUpdated =
    typeof (result as { changes?: number }).changes === "number"
      ? (result as { changes: number }).changes
      : 0;

  revalidatePath("/review");
  revalidatePath("/dashboard");
  return { ok: true, bulkUpdated };
}

/**
 * How many other un-reviewed txns would be affected by setting a rule
 * for this counterparty? Drives the "Apply to N other X txns" copy in
 * the InboxModal. Excludes the current row (passed in as `excludeId`)
 * since we always update it explicitly via the normal save path.
 */
export async function countOtherUnreviewedForMerchant(
  counterparty: string,
  excludeId: number,
): Promise<number> {
  const cp = counterparty.trim();
  if (!cp) return 0;
  const row = openDb().get<{ n: number }>(sql`
    SELECT count(*) AS n
    FROM transactions
    WHERE counterparty = ${cp}
      AND reviewed = 0
      AND id != ${excludeId}
  `);
  return row?.n ?? 0;
}

/**
 * Detect the most likely recurrence for a counterparty by analyzing
 * the actual spacing of its prior txns. Returns one of the recurrence
 * enum values, or null when there isn't enough signal.
 *
 * Heuristic:
 *   - Need at least 3 txns to claim any cadence.
 *   - Compute median gap (in days) between consecutive txns.
 *   - Map the median to a bucket if it's within tolerance:
 *       6-9 days   → weekly
 *       25-35 days → monthly
 *       80-100 days → quarterly
 *       340-380 days → yearly
 *   - Add an amount-stability check: if the median amount-variance
 *     across the same set is > 30%, downgrade confidence (return
 *     null) — a "monthly" Swiggy with wildly varying amounts is
 *     really just "frequent," not recurring.
 *
 * Single SQL pull + JS arithmetic. Cheap (one indexed query).
 */
export async function detectMerchantRecurrence(
  counterparty: string,
): Promise<
  "one_time" | "monthly" | "weekly" | "quarterly" | "yearly" | null
> {
  const cp = counterparty.trim();
  if (!cp) return null;

  const rows = openDb().all<{ txn_date: string; amount: number }>(sql`
    SELECT txn_date, COALESCE(withdrawal, deposit, 0) AS amount
    FROM transactions
    WHERE counterparty = ${cp}
    ORDER BY txn_date ASC
  `);
  if (rows.length < 3) return null;

  // Day gaps between consecutive txns.
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = new Date(rows[i - 1]!.txn_date + "T00:00:00Z").getTime();
    const b = new Date(rows[i]!.txn_date + "T00:00:00Z").getTime();
    const days = Math.round((b - a) / 86_400_000);
    if (days >= 0) gaps.push(days);
  }
  if (gaps.length < 2) return null;

  // Median gap — robust to outliers (one big break doesn't blow up
  // the mean for an otherwise-monthly merchant).
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 0;

  // Amount stability — coefficient of variation. If amounts vary
  // wildly, the merchant is "frequent" but not really recurring in
  // the budget sense.
  const amounts = rows.map((r) => Number(r.amount)).filter((n) => n > 0);
  if (amounts.length >= 3) {
    const mean = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const variance =
      amounts.reduce((s, n) => s + (n - mean) ** 2, 0) / amounts.length;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? std / mean : 0;
    // Allow more variation for weekly/monthly (food delivery,
    // groceries) than for fixed recurring (rent, subs). A coefficient
    // of variation > 0.7 means amounts swing too wildly to call this
    // recurring.
    if (cv > 0.7) return null;
  }

  if (median >= 6 && median <= 9) return "weekly";
  if (median >= 25 && median <= 35) return "monthly";
  if (median >= 80 && median <= 100) return "quarterly";
  if (median >= 340 && median <= 380) return "yearly";
  return null;
}

// ----------------------------------------------------------------------------
// Three-dimensional per-merchant rules (category + recurrence + share)
// ----------------------------------------------------------------------------

/**
 * A merchant rule patch — any subset of the three classification
 * dimensions a user might want to bind to a counterparty. Each
 * dimension is independently optional. Passing `undefined` for a key
 * means "leave any existing rule for this dimension alone"; passing
 * `null` means "clear the rule for this dimension".
 */
export interface MerchantRulePatch {
  category?: string | null;
  recurrence?:
    | "one_time"
    | "monthly"
    | "weekly"
    | "quarterly"
    | "yearly"
    | null;
  /** Person IDs to share with, excluding "me". Pass `null` to clear. */
  sharedWith?: string[] | null;
  /** Total split divisor (1 = just me). Omit to derive from sharedWith.length+1. */
  shareCount?: number | null;
}

/**
 * Apply a multi-dimensional rule for a single counterparty AND bulk-
 * update every un-reviewed sibling txn to match. This is the
 * generalized version of applyMerchantCategoryRule — same semantics
 * but the user can now bind any of category / recurrence / share in
 * one shot.
 *
 * Workflow per dimension:
 *   - Patch key absent (undefined): no-op for that dimension.
 *   - Patch key === null:
 *       · Delete any existing rule row for that dimension.
 *       · Do NOT clear the field on existing txns — clearing a rule
 *         means "stop enforcing", not "reset everything that was ever
 *         set". User-confirmed values (reviewed=1) are untouched
 *         anyway; un-reviewed values stay whatever the previous rule
 *         set them to.
 *   - Patch key with a value:
 *       · UPSERT the rule row.
 *       · UPDATE all un-reviewed txns for this counterparty to match.
 *
 * Returns the count of distinct rows affected so the UI can show "N
 * txns updated" feedback. Same row touched by multiple dimensions
 * counts once (we DISTINCT on id at the end).
 */
export async function applyMerchantRule(
  counterparty: string,
  patch: MerchantRulePatch,
): Promise<{ ok: true; rowsUpdated: number } | { ok: false; error: string }> {
  const cp = counterparty.trim();
  if (!cp) return { ok: false, error: "counterparty required" };

  const db = openDb();
  const touched = new Set<number>();

  // Helper that runs an UPDATE + records the affected ids.
  const recordUpdated = (
    where: ReturnType<typeof sql>,
    setFragments: ReturnType<typeof sql>[],
  ) => {
    if (setFragments.length === 0) return;
    setFragments.push(sql`updated_at = CURRENT_TIMESTAMP`);
    // We use a two-step approach to capture which rows were changed
    // (better-sqlite3's .changes is total count, not row IDs). Cheap
    // on a single counterparty's slice.
    const candidates = db.all<{ id: number }>(sql`
      SELECT id FROM transactions
      WHERE counterparty = ${cp} AND reviewed = 0 AND (${where})
    `);
    if (candidates.length === 0) return;
    db.run(sql`
      UPDATE transactions
      SET ${sql.join(setFragments, sql`, `)}
      WHERE counterparty = ${cp} AND reviewed = 0 AND (${where})
    `);
    for (const r of candidates) touched.add(r.id);
  };

  // --- Category ---
  if (patch.category !== undefined) {
    if (patch.category === null || patch.category.trim() === "") {
      db.run(sql`DELETE FROM merchant_category_rules WHERE counterparty = ${cp}`);
    } else {
      const cat = patch.category.trim();
      db.run(sql`
        INSERT INTO merchant_category_rules (counterparty, category, created_at, updated_at)
        VALUES (${cp}, ${cat}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(counterparty) DO UPDATE SET
          category = excluded.category,
          updated_at = CURRENT_TIMESTAMP
      `);
      recordUpdated(
        sql`(category IS NULL OR category != ${cat})`,
        [sql`category = ${cat}`, sql`category_rule = 'merchant'`],
      );
    }
  }

  // --- Recurrence ---
  if (patch.recurrence !== undefined) {
    if (patch.recurrence === null) {
      db.run(
        sql`DELETE FROM merchant_recurrence_rules WHERE counterparty = ${cp}`,
      );
    } else {
      const rec = patch.recurrence;
      db.run(sql`
        INSERT INTO merchant_recurrence_rules (counterparty, recurrence, created_at, updated_at)
        VALUES (${cp}, ${rec}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(counterparty) DO UPDATE SET
          recurrence = excluded.recurrence,
          updated_at = CURRENT_TIMESTAMP
      `);
      recordUpdated(
        sql`(recurrence IS NULL OR recurrence != ${rec})`,
        [sql`recurrence = ${rec}`],
      );
    }
  }

  // --- Share ---
  if (patch.sharedWith !== undefined || patch.shareCount !== undefined) {
    const isClear =
      (patch.sharedWith === null || patch.sharedWith?.length === 0) &&
      (patch.shareCount == null || patch.shareCount === 1);
    if (isClear) {
      db.run(sql`DELETE FROM merchant_share_rules WHERE counterparty = ${cp}`);
      recordUpdated(
        sql`(shared_with IS NOT NULL OR share_count > 1)`,
        [sql`shared_with = NULL`, sql`share_count = 1`],
      );
    } else {
      const arr = patch.sharedWith ?? [];
      const sharedJson = arr.length > 0 ? JSON.stringify(arr) : null;
      const count = patch.shareCount ?? arr.length + 1;
      db.run(sql`
        INSERT INTO merchant_share_rules (counterparty, shared_with, share_count, created_at, updated_at)
        VALUES (${cp}, ${sharedJson}, ${count}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(counterparty) DO UPDATE SET
          shared_with = excluded.shared_with,
          share_count = excluded.share_count,
          updated_at = CURRENT_TIMESTAMP
      `);
      recordUpdated(
        sql`(
          (shared_with IS NULL AND ${sharedJson} IS NOT NULL)
          OR (shared_with IS NOT NULL AND ${sharedJson} IS NULL)
          OR (shared_with != ${sharedJson})
          OR (share_count != ${count})
        )`,
        [
          sql`shared_with = ${sharedJson}`,
          sql`share_count = ${count}`,
        ],
      );
    }
  }

  revalidatePath("/review");
  revalidatePath("/dashboard");
  return { ok: true, rowsUpdated: touched.size };
}
