/**
 * PhonePe statement ingestion orchestrator.
 *
 * Takes a path to a PhonePe `Transaction_Statement_*.pdf`, runs it through the
 * parser, and writes canonical transactions + per-source observations into the
 * SQLite database. Atomic per statement: a failure mid-write rolls back the
 * whole import.
 *
 * The DB write logic is factored out into `writePhonePeIngest` so tests can
 * supply hand-crafted parse results without needing real PDFs on disk.
 *
 * Matcher policy in this slice (P1b):
 *   - Lookup by UTR (`transactions.ref_no`) against the SAME account.
 *   - If a row is found, REUSE its id and only append a `transaction_sources`
 *     row — the canonical fields are left untouched (the merger that picks the
 *     best-quality field across sources lands in P1c with HDFC ingestion).
 *   - If no row is found, create a new canonical transaction. PhonePe is the
 *     sole source for now.
 *
 * Account inference: PhonePe doesn't tell us which bank the linked account
 * belongs to — only its masked last4. We default to `bank='HDFC',
 * type='savings'` since that's the user's only bank today; once HDFC
 * ingestion lands it will create the SAME (bank, type, last4) account row
 * (the UNIQUE returns the existing one) and the rows wire up correctly.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parsePhonePeText } from "@splitlens/core/parsers";
import {
  categorize,
  DEFAULT_RULES,
  identifyPerson,
  DEFAULT_PEOPLE,
} from "@splitlens/core";
import type { PhonePeParseResult, PhonePeRawTransaction } from "@splitlens/core";
import {
  accounts,
  statements,
  transactions,
  transactionSources,
  type SplitLensDb,
} from "@splitlens/db";
import { and, eq } from "drizzle-orm";

import { extractTextPages } from "./extract-pdf";
import { findCanonicalByRef } from "./matcher";
import { mergeIntoCanonical } from "./merger";

export interface IngestResult {
  status: "ingested" | "skipped_duplicate";
  sourceHash: string;
  statementId?: number;
  /** Number of parsed rows total (regardless of new vs matched). */
  txnCount?: number;
  /** Rows where we created a brand-new canonical transaction. */
  newTransactions?: number;
  /** Rows where we matched an existing canonical transaction by UTR and just attached a source. */
  matchedExisting?: number;
}

export interface IngestPhonePeOptions {
  password?: string;
  /** Bank to attribute to PhonePe-linked accounts. Defaults to 'HDFC'. */
  defaultBank?: string;
}

export async function ingestPhonePe(
  filePath: string,
  db: SplitLensDb,
  opts: IngestPhonePeOptions = {},
): Promise<IngestResult> {
  const bytes = new Uint8Array(await readFile(filePath));
  const sourceHash = createHash("sha256").update(bytes).digest("hex");

  const existing = db
    .select({ id: statements.id })
    .from(statements)
    .where(eq(statements.sourceHash, sourceHash))
    .get();
  if (existing) return { status: "skipped_duplicate", sourceHash };

  // Parse before opening the write transaction so a parser error doesn't
  // leave a partially-written DB.
  const pages = await extractTextPages(bytes, opts.password);
  const parsed = parsePhonePeText(pages);

  return writePhonePeIngest({
    db,
    parsed,
    sourceFile: filePath,
    sourceHash,
    pageCount: pages.length,
    defaultBank: opts.defaultBank,
  });
}

export interface WritePhonePeIngestArgs {
  db: SplitLensDb;
  parsed: PhonePeParseResult;
  sourceFile: string;
  sourceHash: string;
  pageCount: number;
  defaultBank?: string;
}

/** Synchronous DB-only half of PhonePe ingestion. Atomic. */
export function writePhonePeIngest(args: WritePhonePeIngestArgs): IngestResult {
  const { db, parsed, sourceFile, sourceHash, pageCount } = args;
  const defaultBank = args.defaultBank ?? "HDFC";

  const last4s = new Set<string>();
  for (const t of parsed.transactions) {
    if (t.sourceAccountLast4) last4s.add(t.sourceAccountLast4);
  }

  let newTransactions = 0;
  let matchedExisting = 0;
  let statementId = 0;

  db.transaction((tx) => {
    // 1. Ensure an account row for each referenced last4.
    const accountIdByLast4 = new Map<string, number>();
    for (const last4 of last4s) {
      const existingAccount = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.bank, defaultBank),
            eq(accounts.type, "savings"),
            eq(accounts.last4, last4),
          ),
        )
        .get();
      const id =
        existingAccount?.id ??
        tx
          .insert(accounts)
          .values({ bank: defaultBank, type: "savings", last4 })
          .returning({ id: accounts.id })
          .get().id;
      accountIdByLast4.set(last4, id);
    }

    // 2. Statement row — one per ingested file.
    statementId = tx
      .insert(statements)
      .values({
        accountId: pickStatementAccountId(parsed.transactions, accountIdByLast4),
        sourceFile,
        sourceHash,
        sourceType: "phonepe",
        periodFrom: parsed.statement?.periodFrom,
        periodTo: parsed.statement?.periodTo,
        pageCount,
        txnCount: parsed.transactions.length,
      })
      .returning({ id: statements.id })
      .get().id;

    // 3. Per-transaction: match-by-UTR-or-insert + always append a source row.
    for (const t of parsed.transactions) {
      const accountId = t.sourceAccountLast4
        ? accountIdByLast4.get(t.sourceAccountLast4)
        : undefined;
      if (accountId === undefined) {
        throw new Error(
          `PhonePe row at idx=${t.sourceRowIdx} has no linked account; wallet-only ingestion not supported yet`,
        );
      }

      const matchedId = findCanonicalByRef(tx, accountId, t.utr);

      const txnId =
        matchedId ??
        tx
          .insert(transactions)
          .values(phonepeRowToCanonical(t, accountId))
          .returning({ id: transactions.id })
          .get().id;

      if (matchedId) {
        matchedExisting++;
        // PhonePe contributes time-of-day, clean counterparty, and kind.
        // The merger fills these in iff the existing canonical has them NULL.
        // Re-derive category/person on the rich synthetic narration so a
        // PhonePe-second ingest can still backfill an HDFC-first row.
        const synthNarration = `UPI-${t.counterparty}-${t.kind}-${t.utr}`;
        const { category, matchedRule } = categorize(synthNarration, DEFAULT_RULES);
        const person = identifyPerson(synthNarration, DEFAULT_PEOPLE);
        mergeIntoCanonical(tx, matchedId, {
          txnTime: t.txnTime,
          counterparty: t.counterparty,
          counterpartyKind: t.kind,
          refNo: t.utr,
          category,
          categoryRule: matchedRule,
          personId: person?.personId ?? null,
        });
      } else {
        newTransactions++;
      }

      tx.insert(transactionSources)
        .values({
          transactionId: txnId,
          sourceType: "phonepe",
          statementId,
          sourceRowIdx: t.sourceRowIdx,
          sourceTxnId: t.transactionId,
          rawJson: JSON.stringify(t),
        })
        .run();
    }
  });

  return {
    status: "ingested",
    sourceHash,
    statementId,
    txnCount: parsed.transactions.length,
    newTransactions,
    matchedExisting,
  };
}

/**
 * Pick the account for the statement-level FK. Almost always there's exactly
 * one linked account; when the parser saw multiple, use the most-referenced.
 */
function pickStatementAccountId(
  rows: PhonePeRawTransaction[],
  accountIdByLast4: Map<string, number>,
): number {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.sourceAccountLast4) continue;
    counts.set(r.sourceAccountLast4, (counts.get(r.sourceAccountLast4) ?? 0) + 1);
  }
  let bestLast4: string | undefined;
  let bestCount = -1;
  for (const [last4, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestLast4 = last4;
    }
  }
  const id = bestLast4 ? accountIdByLast4.get(bestLast4) : undefined;
  if (id === undefined) {
    throw new Error("PhonePe statement has no linked bank account rows — cannot attribute");
  }
  return id;
}

function phonepeRowToCanonical(t: PhonePeRawTransaction, accountId: number) {
  // Categorize against the cleanest text we have. PhonePe gives us the
  // counterparty separately, but most rules patterns key off the broader
  // bank-narration shape — so feed a synthetic "narration" that mirrors what
  // an HDFC UPI row would look like for the same counterparty. The rules
  // engine tolerates both shapes; this combined form gets the best coverage.
  const synthNarration = `UPI-${t.counterparty}-${t.kind}-${t.utr}`;
  const { category, matchedRule } = categorize(synthNarration, DEFAULT_RULES);
  const person = identifyPerson(synthNarration, DEFAULT_PEOPLE);
  return {
    accountId,
    txnDate: t.txnDate,
    txnTime: t.txnTime,
    withdrawal: t.direction === "out" ? t.amount : null,
    deposit: t.direction === "in" ? t.amount : null,
    refNo: t.utr,
    counterparty: t.counterparty,
    counterpartyKind: t.kind,
    category,
    categoryRule: matchedRule,
    personId: person?.personId ?? null,
  };
}
