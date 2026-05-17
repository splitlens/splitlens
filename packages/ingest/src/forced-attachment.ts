/**
 * Generic "force-attach a file as a transaction_sources row" helper.
 *
 * Used by the /review page's bill-attach flow — the user has explicitly
 * picked which canonical txn the file belongs to, so we bypass the
 * daemon's auto-match heuristic and just write the source row directly.
 *
 * Different from `writeZeptoInvoiceEnrichment` because:
 *   - It doesn't care about the file's shape (could be a screenshot,
 *     an OCR'd PNG, a PDF we couldn't parse, a manual upload).
 *   - It accepts an arbitrary `rawJson` payload — the caller fills in
 *     whatever structured data they extracted (parsed items, OCR text,
 *     plain filename) and the UI's source-card formatter picks the
 *     right rendering based on `sourceType`.
 *
 * Returns a discriminated outcome so the caller can branch on
 * duplicate / missing-account / success without try/catch.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import {
  accounts,
  statements,
  transactionSources,
  type SplitLensDb,
} from "@splitlens/db";

export type ForcedAttachmentOutcome =
  | { kind: "attached"; transactionId: number; sourceHash: string; statementId: number }
  | { kind: "duplicate"; transactionId: number; sourceHash: string }
  | { kind: "txn_not_found"; transactionId: number }
  | { kind: "failed"; error: Error };

export interface WriteForcedAttachmentArgs {
  db: SplitLensDb;
  /** Canonical txn the file should attach to. Caller has already chosen this. */
  transactionId: number;
  /** Drives the source-card icon + formatter on the review page. */
  sourceType: string;
  /** Absolute path of the archived file. */
  sourceFile: string;
  /**
   * Stable hash of the file bytes; enforces idempotency via uq_statement_source_hash.
   * When provided, callers are responsible for scoping it per-txn (see
   * `scopedForcedAttachmentHash`). When omitted, this function derives the
   * per-txn-scoped hash from `fileBytes` itself.
   */
  sourceHash?: string;
  /** Raw bytes — used to compute sourceHash when none is provided. */
  fileBytes?: Uint8Array | Buffer;
  /** Arbitrary structured payload to store. UI's per-source formatter decodes it. */
  rawJson: Record<string, unknown>;
  /** Optional identifier the source has (order id, msg id, …). Stored on the row. */
  sourceTxnId?: string | null;
}

/**
 * Per-txn-scoped attachment hash. Globally-unique on `statements.source_hash`
 * but lets the same file bytes attach to different txns — e.g. one Swiggy
 * receipt that pairs with both the original charge and a separate refund row.
 *
 * Re-dropping the same file on the same txn still collides → caught as a
 * duplicate (intended no-op).
 */
export function scopedForcedAttachmentHash(
  fileBytes: Uint8Array | Buffer,
  transactionId: number,
): string {
  const raw = createHash("sha256").update(fileBytes).digest("hex");
  return `${raw}:txn:${transactionId}`;
}

/**
 * Preflight dedup check. Use BEFORE archiving the file to disk so we don't
 * overwrite-then-unlink an earlier successful attachment when the user
 * re-drops the same file on the same txn. Returns true iff there is already
 * a (file, txn) attachment with these bytes.
 *
 * Also catches pre-scoping legacy rows (un-salted hash) that already point
 * to this same txn — so the bug-fix is safe for databases that pre-date this
 * change. Cross-txn legacy hashes are intentionally NOT matched: the whole
 * point of scoping is to allow cross-txn attaches.
 */
export function isForcedAttachmentDuplicate(
  db: SplitLensDb,
  transactionId: number,
  fileBytes: Uint8Array | Buffer,
): boolean {
  const rawHash = createHash("sha256").update(fileBytes).digest("hex");
  const scopedHash = `${rawHash}:txn:${transactionId}`;
  const scopedHit = db.get<{ id: number }>(sql`
    SELECT id FROM statements WHERE source_hash = ${scopedHash}
  `);
  if (scopedHit) return true;
  // Legacy un-salted row for this same txn? (Only same-txn matters — cross-txn
  // raw-hash matches are the bug we're fixing.)
  const legacyHit = db.get<{ id: number }>(sql`
    SELECT s.id
    FROM statements s
    JOIN transaction_sources ts ON ts.statement_id = s.id
    WHERE s.source_hash = ${rawHash}
      AND ts.transaction_id = ${transactionId}
    LIMIT 1
  `);
  return legacyHit != null;
}

/**
 * Write the statement + transaction_sources rows for a force-attached
 * file. Runs inside a single SQL transaction so partial inserts can't
 * leak.
 */
export function writeForcedAttachment(
  args: WriteForcedAttachmentArgs,
): ForcedAttachmentOutcome {
  const { db, transactionId, sourceType, sourceFile, rawJson } = args;
  const sourceHash =
    args.sourceHash ??
    (args.fileBytes
      ? scopedForcedAttachmentHash(args.fileBytes, transactionId)
      : null);
  if (!sourceHash) {
    return {
      kind: "failed",
      error: new Error("writeForcedAttachment: sourceHash or fileBytes required"),
    };
  }

  // Re-attach guard: same (file, txn) collides on the per-txn-scoped hash.
  // Callers should preflight with `isForcedAttachmentDuplicate` before
  // archiving the file to disk; this internal check is defence-in-depth for
  // concurrent writers.
  const existing = db
    .select({ id: statements.id })
    .from(statements)
    .where(sql`source_hash = ${sourceHash}`)
    .get();
  if (existing) {
    return { kind: "duplicate", transactionId, sourceHash };
  }

  // Find the canonical txn's account so the synthetic statement has a
  // valid account_id (FK constraint).
  const txn = db.get<{ id: number; account_id: number }>(sql`
    SELECT id, account_id FROM transactions WHERE id = ${transactionId}
  `);
  if (!txn) {
    return { kind: "txn_not_found", transactionId };
  }

  try {
    let statementId = 0;
    db.transaction((tx) => {
      // Defensive: account exists?
      const accExists = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(sql`id = ${txn.account_id}`)
        .get();
      if (!accExists) {
        throw new Error(`account ${txn.account_id} not found`);
      }
      const inserted = tx
        .insert(statements)
        .values({
          accountId: txn.account_id,
          sourceFile,
          sourceHash,
          sourceType,
          periodFrom: null,
          periodTo: null,
          pageCount: null,
          txnCount: 1,
        })
        .returning({ id: statements.id })
        .get();
      statementId = inserted.id;

      tx.insert(transactionSources)
        .values({
          transactionId,
          sourceType,
          statementId,
          sourceRowIdx: transactionId,
          sourceTxnId: args.sourceTxnId ?? null,
          rawJson: JSON.stringify(rawJson),
        })
        .run();
    });
    return { kind: "attached", transactionId, sourceHash, statementId };
  } catch (err) {
    return { kind: "failed", error: err as Error };
  }
}
