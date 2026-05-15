"use server";

import "server-only";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { openDb } from "@splitlens/db";
import { DEFAULT_PEOPLE } from "@splitlens/core";
import { ingestZeptoInvoice } from "@splitlens/ingest";

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
      kind: "queued";
      reason: string;
      stagedPath: string;
    }
  | { ok: false; error: string };

/**
 * Server action used by the review-form dropzone. Receives a file from the
 * browser (as base64), figures out what kind of bill it is, and forces it
 * to attach to the specified txn (bypassing the daemon's auto-match heuristic
 * because the user has explicitly chosen this row).
 *
 * Today supported:
 *   - Zepto invoice PDFs (`zepto_invoice_*.pdf`) → ingestZeptoInvoice with
 *     forceTransactionId
 *
 * Anything else is staged into ~/Documents/bank/inbox/{invoices,screenshots}/
 * for the daemon to pick up asynchronously (we return `kind: "queued"` so
 * the UI can tell the user "I dropped it; refresh in a moment").
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

  // === Path 2: Anything else — stage into inbox/ and let the daemon decide ===
  // Images go to inbox/screenshots/; other PDFs go to inbox/invoices/ (the
  // daemon's classifier short-circuits on filename, so unsupported PDFs end
  // up in unparsed/ with a clear error log).
  const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".heic"]);
  const dropDir = IMG_EXT.has(ext)
    ? join(bankRoot, "inbox", "screenshots")
    : join(bankRoot, "inbox", "invoices");
  mkdirSync(dropDir, { recursive: true });
  const stagedPath = join(dropDir, cleanName);
  writeFileSync(stagedPath, bytes);
  return {
    ok: true,
    kind: "queued",
    reason: IMG_EXT.has(ext)
      ? `staged into ~/Documents/bank/inbox/screenshots/ — the daemon will OCR + match it within a few seconds. Refresh the page to see it appear.`
      : `staged into ~/Documents/bank/inbox/invoices/ — the daemon will process it. Note: today only Zepto invoices (zepto_invoice_*.pdf) match by content; other names land in unparsed/.`,
    stagedPath,
  };
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
