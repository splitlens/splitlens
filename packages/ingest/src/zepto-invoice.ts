/**
 * Zepto invoice (per-order GST PDF) ingestion orchestrator.
 *
 * Enrichment-style — unlike PhonePe / HDFC ingestion which create canonical
 * rows from a statement, this orchestrator ATTACHES to an existing canonical
 * row by matching on (date, amount). The invoice represents the order; the
 * canonical row is whatever bank or UPI source captured the actual money
 * movement (typically a HDFC UPI debit). The match policy mirrors the email
 * enrichment path: ±1 day, ±₹2.
 *
 * Outcomes:
 *   - `enriched`           — parsed + matched + transaction_sources row written
 *   - `skipped_duplicate`  — same PDF (by sourceHash) already ingested
 *   - `no_canonical_match` — parsed cleanly but no UPI debit fits the window
 *   - `parse_failed`       — the PDF didn't yield the header fields we need
 *
 * Idempotency: re-dropping the same PDF byte-identically returns
 * `skipped_duplicate`; re-dropping after a manual rerun still produces at
 * most one transaction_sources row thanks to the unique (statement_id,
 * source_row_idx) index.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";

import { parseZeptoInvoicePositional, type ZeptoInvoice } from "@splitlens/core";
import {
  accounts,
  statements,
  transactionSources,
  type SplitLensDb,
} from "@splitlens/db";

import { extractPagesPositional } from "./extract-pdf";

export type ZeptoInvoiceOutcome =
  | {
      kind: "enriched";
      sourceHash: string;
      invoice: ZeptoInvoice;
      transactionId: number;
    }
  | { kind: "skipped_duplicate"; sourceHash: string }
  | {
      kind: "no_canonical_match";
      sourceHash: string;
      invoice: ZeptoInvoice;
      /** Best-effort: how many txns landed within the date window but failed amount tolerance, etc. */
      nearMisses: number;
    }
  | { kind: "parse_failed"; sourceHash: string; reason: string };

export interface IngestZeptoInvoiceOptions {
  /** Date tolerance in days when matching to a canonical txn. Default ±1. */
  dateWindowDays?: number;
  /** Amount tolerance in INR. Default ±₹2 (matches the email path). */
  amountToleranceInr?: number;
}

export async function ingestZeptoInvoice(
  filePath: string,
  db: SplitLensDb,
  opts: IngestZeptoInvoiceOptions = {},
): Promise<ZeptoInvoiceOutcome> {
  const bytes = new Uint8Array(await readFile(filePath));
  const sourceHash = createHash("sha256").update(bytes).digest("hex");

  // Re-ingest guard. statements.uq_statement_source_hash is unique; if we've
  // seen this PDF before we short-circuit so we don't second-guess the
  // original match outcome (the original linker may have been right or
  // wrong, but re-running won't help).
  const existing = db
    .select({ id: statements.id })
    .from(statements)
    .where(sql`source_hash = ${sourceHash}`)
    .get();
  if (existing) return { kind: "skipped_duplicate", sourceHash };

  const pages = await extractPagesPositional(bytes);
  const parsed = parseZeptoInvoicePositional(pages);
  if (!parsed) {
    return {
      kind: "parse_failed",
      sourceHash,
      reason: "couldn't extract Order No / Date / Invoice Value from PDF",
    };
  }

  return writeZeptoInvoiceEnrichment({
    db,
    parsed,
    sourceHash,
    sourceFile: filePath,
    pageCount: pages.length,
    options: opts,
  });
}

export interface WriteZeptoInvoiceArgs {
  db: SplitLensDb;
  parsed: ZeptoInvoice;
  sourceHash: string;
  sourceFile: string;
  pageCount: number;
  options?: IngestZeptoInvoiceOptions;
}

/**
 * Pure-write half of the orchestrator — takes a parsed invoice and a DB,
 * resolves the canonical txn match, writes the transaction_sources row.
 *
 * Exposed separately so tests can drive it with synthetic ZeptoInvoice
 * objects (no PDF needed).
 */
export function writeZeptoInvoiceEnrichment(
  args: WriteZeptoInvoiceArgs,
): ZeptoInvoiceOutcome {
  const { db, parsed, sourceHash, sourceFile, pageCount } = args;
  const opts = args.options ?? {};

  // Match policy: look for an outgoing canonical txn that (a) has "zepto" in
  // its narration or counterparty, (b) sits within ±dateWindowDays of the
  // invoice date, (c) within ±amountToleranceInr rupees of the invoice
  // total. We don't require a UTR match because the PDF doesn't carry one.
  const dateWindowDays = opts.dateWindowDays ?? 1;
  const amountTol = opts.amountToleranceInr ?? 2;
  const sinceIso = isoDatePlusDays(parsed.date, -dateWindowDays);
  const untilIso = isoDatePlusDays(parsed.date, dateWindowDays);

  const candidates = db.all<{
    id: number;
    account_id: number;
    withdrawal: number;
    txn_date: string;
  }>(sql`
    SELECT id, account_id, withdrawal, txn_date
    FROM transactions
    WHERE withdrawal IS NOT NULL
      AND withdrawal > 0
      AND txn_date >= ${sinceIso}
      AND txn_date <= ${untilIso}
      AND (
        LOWER(narration) LIKE '%zepto%'
        OR LOWER(counterparty) LIKE '%zepto%'
      )
  `);

  // Pick the best candidate: closest on amount, tiebreaker closest on date.
  let best: (typeof candidates)[number] | null = null;
  let bestAmtDiff = Infinity;
  let bestDateDiff = Infinity;
  let nearMisses = 0;
  for (const c of candidates) {
    const amtDiff = Math.abs(c.withdrawal - parsed.amount);
    if (amtDiff > amountTol) {
      nearMisses++;
      continue;
    }
    const dateDiff = Math.abs(
      (Date.parse(c.txn_date) - Date.parse(parsed.date)) / 86_400_000,
    );
    if (
      amtDiff < bestAmtDiff ||
      (amtDiff === bestAmtDiff && dateDiff < bestDateDiff)
    ) {
      best = c;
      bestAmtDiff = amtDiff;
      bestDateDiff = dateDiff;
    }
  }
  if (!best) {
    return {
      kind: "no_canonical_match",
      sourceHash,
      invoice: parsed,
      nearMisses,
    };
  }

  // Write — synthetic statement per file + one transaction_sources row.
  // The unique constraint on (statement_id, source_row_idx) makes this safe
  // even if two concurrent writers raced on the same PDF.
  try {
    db.transaction((tx) => {
      const accountExists = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(sql`id = ${best!.account_id}`)
        .get();
      if (!accountExists) {
        throw new Error(`account ${best!.account_id} not found`);
      }
      const inserted = tx
        .insert(statements)
        .values({
          accountId: best!.account_id,
          sourceFile,
          sourceHash,
          sourceType: "zepto_invoice",
          periodFrom: parsed.date,
          periodTo: parsed.date,
          pageCount,
          txnCount: 1,
        })
        .returning({ id: statements.id })
        .get();

      tx.insert(transactionSources)
        .values({
          transactionId: best!.id,
          sourceType: "zepto_invoice",
          statementId: inserted.id,
          sourceRowIdx: best!.id,
          sourceTxnId: parsed.orderNo,
          rawJson: JSON.stringify({
            orderNo: parsed.orderNo,
            invoiceNo: parsed.invoiceNo,
            date: parsed.date,
            amount: parsed.amount,
            items: parsed.items,
          }),
        })
        .run();
    });
  } catch (_err) {
    // Most likely: another writer attached to this same canonical row first.
    // We treat that as a duplicate — the PDF's contribution is already in DB.
    return { kind: "skipped_duplicate", sourceHash };
  }

  return {
    kind: "enriched",
    sourceHash,
    invoice: parsed,
    transactionId: best.id,
  };
}

function isoDatePlusDays(iso: string, days: number): string {
  const t = Date.parse(iso) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
