"use server";

import "server-only";
import { copyFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { openDb } from "@splitlens/db";
import { DEFAULT_PEOPLE } from "@splitlens/core";
import { ingestZeptoInvoice, writeForcedAttachment } from "@splitlens/ingest";
import {
  parseReceipt,
  recognizeText,
  VisionRuntimeError,
  VisionUnavailableError,
} from "@splitlens/ocr";

// ============================================================================
// Field edits — counterparty / category / narration / notes / person
// ============================================================================

export interface TransactionEdits {
  counterparty?: string | null;
  category?: string | null;
  narration?: string | null;
  notes?: string | null;
  personId?: string | null;
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
    // Best-effort cleanup — we wrote to archive but the DB says already attached
    try {
      unlinkSync(archivedPath);
    } catch {
      /* leave it */
    }
    return {
      ok: false,
      error: "This file was already attached to a transaction earlier.",
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
    try {
      unlinkSync(archivedPath);
    } catch {
      /* leave it */
    }
    return {
      ok: false,
      error: "This file was already attached to a transaction earlier.",
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
