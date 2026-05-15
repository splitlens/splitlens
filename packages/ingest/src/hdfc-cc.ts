/**
 * HDFC credit-card statement ingestion orchestrator.
 *
 * Atomic per statement, same shape as ingestHdfcSavings / ingestPhonePe.
 * Each CC row maps to its own canonical `transactions` row — there's no UTR-
 * based matching against other sources today because PhonePe debits the
 * linked savings account, not the credit card. The cross-account autopay
 * link to the savings statement is handled separately by `linkAutopayPairs`
 * which runs at the end of every ingest.
 *
 * Direction mapping on CC:
 *   - Purchases / charges → `withdrawal` (positive amount you owe later)
 *   - Payments (`isPayment=true`) → `deposit` (paid back, reduces card debt)
 *
 * CC-only fields (rewards, foreign currency, isInternational, isCharge) live
 * in `transaction_sources.raw_json` for full traceability without bloating
 * the canonical row.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parseHdfcCcText } from "@splitlens/core/parsers";
import {
  categorize,
  DEFAULT_RULES,
  identifyPerson,
  DEFAULT_PEOPLE,
} from "@splitlens/core";
import type { CcParseResult, CcRawTransaction } from "@splitlens/core";
import {
  accounts,
  statements,
  transactions,
  transactionSources,
  type SplitLensDb,
} from "@splitlens/db";
import { and, eq } from "drizzle-orm";

import { extractTextPages } from "./extract-pdf";
import { linkAutopayPairs } from "./autopay-linker";
import type { IngestResult } from "./phonepe";

export interface IngestHdfcCcOptions {
  password?: string;
}

export async function ingestHdfcCc(
  filePath: string,
  db: SplitLensDb,
  opts: IngestHdfcCcOptions = {},
): Promise<IngestResult & { linkedAutopayPairs?: number }> {
  const bytes = new Uint8Array(await readFile(filePath));
  const sourceHash = createHash("sha256").update(bytes).digest("hex");

  const existing = db
    .select({ id: statements.id })
    .from(statements)
    .where(eq(statements.sourceHash, sourceHash))
    .get();
  if (existing) return { status: "skipped_duplicate", sourceHash };

  const pages = await extractTextPages(bytes, opts.password);
  const parsed = parseHdfcCcText(pages);

  return writeHdfcCcIngest({
    db,
    parsed,
    sourceFile: filePath,
    sourceHash,
    pageCount: pages.length,
  });
}

export interface WriteHdfcCcIngestArgs {
  db: SplitLensDb;
  parsed: CcParseResult;
  sourceFile: string;
  sourceHash: string;
  pageCount: number;
}

export function writeHdfcCcIngest(
  args: WriteHdfcCcIngestArgs,
): IngestResult & { linkedAutopayPairs?: number } {
  const { db, parsed, sourceFile, sourceHash, pageCount } = args;
  if (!parsed.statement) {
    throw new Error("HDFC CC parser returned no statement metadata — refusing to ingest");
  }

  const { bank, cardLast4, customerName, periodFrom, periodTo } = parsed.statement;

  let newTransactions = 0;
  let statementId = 0;
  let linkedAutopayPairs = 0;

  db.transaction((tx) => {
    // 1. Ensure CC account row.
    const existingAccount = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.bank, bank),
          eq(accounts.type, "credit_card"),
          eq(accounts.last4, cardLast4),
        ),
      )
      .get();
    const accountId =
      existingAccount?.id ??
      tx
        .insert(accounts)
        .values({ bank, type: "credit_card", last4: cardLast4, customerName })
        .returning({ id: accounts.id })
        .get().id;

    // 2. Statement row.
    statementId = tx
      .insert(statements)
      .values({
        accountId,
        sourceFile,
        sourceHash,
        sourceType: "hdfc_cc",
        periodFrom,
        periodTo,
        pageCount,
        txnCount: parsed.transactions.length,
      })
      .returning({ id: statements.id })
      .get().id;

    // 3. Each CC row inserts as a new canonical txn — no cross-source UTR
    //    matching today. The CC parser is already de-duplicated by its own
    //    (statement_id, source_row_idx) UNIQUE on transaction_sources, so
    //    re-ingesting the same statement is safe.
    for (const t of parsed.transactions) {
      const txnId = tx
        .insert(transactions)
        .values(ccRowToCanonical(t, accountId))
        .returning({ id: transactions.id })
        .get().id;
      newTransactions++;

      tx.insert(transactionSources)
        .values({
          transactionId: txnId,
          sourceType: "hdfc_cc",
          statementId,
          sourceRowIdx: t.sourceRowIdx,
          sourceTxnId: null, // CC rows have no globally-unique id; description+date is identity
          rawJson: JSON.stringify(t),
        })
        .run();
    }

    // 4. After the CC rows land, try to pair AUTOPAY payments with their
    //    counterparts on the savings side. Symmetric — also picks up any
    //    savings autopay rows that ingested earlier without a matching CC.
    linkedAutopayPairs = linkAutopayPairs(tx).linkedPairs;
  });

  return {
    status: "ingested",
    sourceHash,
    statementId,
    txnCount: parsed.transactions.length,
    newTransactions,
    matchedExisting: 0,
    linkedAutopayPairs,
  };
}

function ccRowToCanonical(t: CcRawTransaction, accountId: number) {
  const { category, matchedRule } = categorize(t.description, DEFAULT_RULES);
  const person = identifyPerson(t.description, DEFAULT_PEOPLE);
  return {
    accountId,
    txnDate: t.txnDate,
    txnTime: t.txnTime, // CC statements include HH:MM for every row
    narration: t.description,
    // CC purchases / charges → withdrawal (money you owe).
    // CC payments → deposit (you paid the card off).
    withdrawal: t.isPayment ? null : t.amount,
    deposit: t.isPayment ? t.amount : null,
    category,
    categoryRule: matchedRule,
    personId: person?.personId ?? null,
  };
}
