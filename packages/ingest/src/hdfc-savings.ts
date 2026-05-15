/**
 * HDFC savings statement ingestion orchestrator.
 *
 * Atomic per-statement, same shape as ingestPhonePe. Matching by UTR via
 * `findCanonicalByRef`; merging via `mergeIntoCanonical`. The HDFC source's
 * unique contributions are: verbatim `narration`, `closingBalance`,
 * `valueDate`. PhonePe contributes time-of-day + clean counterparty + kind;
 * the merger ensures whichever statement is ingested second fills the gaps
 * left by the first.
 *
 * UTR normalization: HDFC's `refNo` is a zero-padded 12-digit UTR for UPI
 * rows (e.g. "0000095596237777" → "095596237777"). For UPIRET refunds the
 * UTR is embedded in the narration. For NEFT/CC/etc. there is no UTR, and
 * the matcher returns null — those rows always insert new canonical txns.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parseHdfcSavingsPages } from "@splitlens/core/parsers";
import type { ParseResult, RawTransaction } from "@splitlens/core";
import {
  accounts,
  statements,
  transactions,
  transactionSources,
  type SplitLensDb,
} from "@splitlens/db";
import { and, eq, sql } from "drizzle-orm";

import { extractPagesPositional } from "./extract-pdf";
import { findCanonicalByRef } from "./matcher";
import { mergeIntoCanonical } from "./merger";
import { linkAutopayPairs } from "./autopay-linker";
import type { IngestResult } from "./phonepe";

export interface IngestHdfcSavingsOptions {
  password?: string;
}

export async function ingestHdfcSavings(
  filePath: string,
  db: SplitLensDb,
  opts: IngestHdfcSavingsOptions = {},
): Promise<IngestResult> {
  const bytes = new Uint8Array(await readFile(filePath));
  const sourceHash = createHash("sha256").update(bytes).digest("hex");

  const existing = db
    .select({ id: statements.id })
    .from(statements)
    .where(eq(statements.sourceHash, sourceHash))
    .get();
  if (existing) return { status: "skipped_duplicate", sourceHash };

  const pages = await extractPagesPositional(bytes, opts.password);
  const parsed = parseHdfcSavingsPages(pages);

  return writeHdfcSavingsIngest({
    db,
    parsed,
    sourceFile: filePath,
    sourceHash,
    pageCount: pages.length,
  }) as IngestResult & { linkedAutopayPairs?: number };
}

export interface WriteHdfcSavingsIngestArgs {
  db: SplitLensDb;
  parsed: ParseResult;
  sourceFile: string;
  sourceHash: string;
  pageCount: number;
}

export function writeHdfcSavingsIngest(
  args: WriteHdfcSavingsIngestArgs,
): IngestResult & { linkedAutopayPairs?: number } {
  const { db, parsed, sourceFile, sourceHash, pageCount } = args;
  if (!parsed.statement) {
    throw new Error("HDFC savings parser returned no statement metadata — refusing to ingest");
  }

  const { bank, accountType, accountLast4, periodFrom, periodTo, customerName } = parsed.statement;

  let newTransactions = 0;
  let matchedExisting = 0;
  let statementId = 0;
  let linkedAutopayPairs = 0;

  db.transaction((tx) => {
    // 1. Ensure account (existing PhonePe ingest may have created it).
    const existingAccount = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.bank, bank),
          eq(accounts.type, accountType),
          eq(accounts.last4, accountLast4),
        ),
      )
      .get();
    let accountId: number;
    if (existingAccount) {
      accountId = existingAccount.id;
      // PhonePe-created account rows have customer_name=null because PhonePe
      // doesn't expose it. HDFC does — backfill once.
      if (customerName) {
        tx.update(accounts)
          .set({ customerName })
          .where(and(eq(accounts.id, accountId), sql`${accounts.customerName} IS NULL`))
          .run();
      }
    } else {
      accountId = tx
        .insert(accounts)
        .values({ bank, type: accountType, last4: accountLast4, customerName })
        .returning({ id: accounts.id })
        .get().id;
    }

    // 2. Statement row.
    statementId = tx
      .insert(statements)
      .values({
        accountId,
        sourceFile,
        sourceHash,
        sourceType: "hdfc_savings",
        periodFrom,
        periodTo,
        pageCount,
        txnCount: parsed.transactions.length,
      })
      .returning({ id: statements.id })
      .get().id;

    // 3. Per-transaction: normalize UTR → match → insert-or-merge → append source.
    for (const t of parsed.transactions) {
      const canonicalRef = canonicalRefForHdfc(t);
      const matchedId = findCanonicalByRef(tx, accountId, canonicalRef);

      const txnId =
        matchedId ??
        tx
          .insert(transactions)
          .values(hdfcRowToCanonical(t, accountId, canonicalRef))
          .returning({ id: transactions.id })
          .get().id;

      if (matchedId) {
        matchedExisting++;
        mergeIntoCanonical(tx, matchedId, {
          narration: t.narration,
          valueDate: t.valueDate ?? null,
          closingBalance: t.closingBalance ?? null,
          refNo: canonicalRef,
        });
      } else {
        newTransactions++;
      }

      tx.insert(transactionSources)
        .values({
          transactionId: txnId,
          sourceType: "hdfc_savings",
          statementId,
          sourceRowIdx: t.sourceRowIdx,
          sourceTxnId: canonicalRef ?? t.refNo ?? null,
          rawJson: JSON.stringify(t),
        })
        .run();
    }

    // After savings rows land, try to pair AUTOPAY debits with CC payment
    // counterparts. Idempotent — only operates on unlinked rows.
    linkedAutopayPairs = linkAutopayPairs(tx).linkedPairs;
  });

  return {
    status: "ingested",
    sourceHash,
    statementId,
    txnCount: parsed.transactions.length,
    newTransactions,
    matchedExisting,
    linkedAutopayPairs,
  };
}

/**
 * Reduce an HDFC savings row to its canonical reference for cross-source
 * matching. Only the 12-digit UPI UTR is a valid cross-source join key
 * (PhonePe / GPay / Cred all carry it). Bank-internal references like NEFT
 * `CHASN…`, CC autopay sequence numbers, or zero-padded internal IDs are NOT
 * cross-source identifiers and must NOT be stored in `ref_no` — otherwise the
 * matcher merges unrelated rows that happen to share an internal HDFC ref.
 *
 * Returns null for:
 *   - UPIRET refunds (the embedded UTR is the ORIGINAL payment's UTR, which
 *     would falsely match the original debit row)
 *   - NEFT credits, CC autopay debits, INTEREST PAID, IMPS — these have no
 *     cross-source identifier
 *
 * The bank-internal refs are still preserved in `transaction_sources.raw_json`
 * and surfaced as `transaction_sources.source_txn_id` for display.
 */
export function canonicalRefForHdfc(t: RawTransaction): string | null {
  // Standard UPI debit/credit: narration starts with "UPI-" (NOT "UPIRET-")
  // and refNo is "0000…<12digits>". Take the trailing 12 digits —
  // `replace(/^0+/, "")` would clip a legitimate leading-zero UTR.
  if (
    t.narration.startsWith("UPI-") &&
    !t.narration.startsWith("UPIRET-") &&
    t.refNo &&
    /^0+\d{12}$/.test(t.refNo)
  ) {
    return t.refNo.slice(-12);
  }
  return null;
}

function hdfcRowToCanonical(t: RawTransaction, accountId: number, canonicalRef: string | null) {
  return {
    accountId,
    txnDate: t.txnDate,
    valueDate: t.valueDate ?? null,
    narration: t.narration,
    refNo: canonicalRef,
    withdrawal: t.withdrawal,
    deposit: t.deposit,
    closingBalance: t.closingBalance ?? null,
  };
}
