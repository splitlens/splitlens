/**
 * Repository layer: typed queries against the local PGlite DB.
 *
 * NOTE on the implementation: we use raw SQL via `db.execute(sql\`...\`)` rather
 * than Drizzle's chainable query builder. The chainable builder ties query
 * objects to a specific drizzle-orm virtual instance; pnpm resolves the same
 * version of drizzle-orm twice (once in @splitlens/db without PGlite peer,
 * once in apps/web with it) which causes type incompatibility despite identical
 * runtime behavior. Raw SQL sidesteps that — we lose builder type-safety in
 * exchange for shipping. Schema in @splitlens/db is still the source of truth.
 */
"use client";

import { sql } from "drizzle-orm";
import type {
  ParsedStatement,
  RawTransaction,
  CcStatement,
  CcRawTransaction,
} from "@splitlens/core";
import { categorize, DEFAULT_RULES, identifyPerson, DEFAULT_PEOPLE } from "@splitlens/core";
import { getDb } from "./db";

export interface SaveResult {
  accountId: number;
  statementId: number;
  /** Inserted as new rows. */
  inserted: number;
  /** Skipped because the same statement was re-uploaded (idempotent re-import). */
  skippedSameStatement: number;
  /** Skipped because the transaction already exists from a DIFFERENT statement
   * (cross-statement dedup, e.g., monthly statement vs full-year statement
   * covering the same period). This is the smart dedup the user asked for. */
  skippedDuplicate: number;
  /** Total skipped (sum of the two). */
  skipped: number;
}

/**
 * Compute a deterministic identity for a transaction so we can dedupe across
 * statements (e.g., a monthly statement + a year-long statement that overlap).
 *
 * Identity = bank's ref_no when available (UPI/NEFT references are globally
 * unique). Otherwise fall back to (date, amount-sign, amount, narration prefix).
 */
function computeContentHash(t: {
  txnDate: string;
  refNo?: string | null;
  withdrawal: number | null;
  deposit: number | null;
  narration: string;
}): string {
  // Strong signal: bank-provided ref number (UPI/NEFT). Strip leading zeros.
  const ref = (t.refNo ?? "").replace(/^0+/, "").trim();
  if (ref.length >= 6) {
    // ref_no alone is enough for HDFC; pair with date as belt-and-suspenders.
    return `r:${t.txnDate}:${ref}`;
  }
  // Fallback: date + signed amount + first 50 chars of narration (collapsed whitespace)
  const amount =
    t.withdrawal != null ? `-${t.withdrawal}` : t.deposit != null ? `+${t.deposit}` : "0";
  const narr = t.narration.replace(/\s+/g, " ").trim().slice(0, 50);
  return `f:${t.txnDate}:${amount}:${narr}`;
}

// ---- Write paths ----

export async function saveSavingsResult(
  fileName: string,
  stmt: ParsedStatement,
  txns: RawTransaction[],
): Promise<SaveResult> {
  const accountId = await upsertAccount({
    bank: stmt.bank,
    type: "savings",
    last4: stmt.accountLast4,
    customerName: stmt.customerName ?? null,
  });
  const statementId = await upsertStatement({
    accountId,
    sourceFile: fileName,
    periodFrom: stmt.periodFrom ?? null,
    periodTo: stmt.periodTo ?? null,
    txnCount: txns.length,
  });

  const result = await bulkInsertTxns(
    accountId,
    statementId,
    txns.map((t) => ({
      txnDate: t.txnDate,
      valueDate: t.valueDate ?? null,
      narration: t.narration,
      refNo: t.refNo ?? null,
      withdrawal: t.withdrawal,
      deposit: t.deposit,
      closingBalance: t.closingBalance ?? null,
      sourceRowIdx: t.sourceRowIdx,
    })),
  );
  return {
    accountId,
    statementId,
    inserted: result.inserted,
    skippedSameStatement: result.skippedSameStatement,
    skippedDuplicate: result.skippedDuplicate,
    skipped: result.skippedSameStatement + result.skippedDuplicate,
  };
}

export async function saveCcResult(
  fileName: string,
  stmt: CcStatement,
  txns: CcRawTransaction[],
): Promise<SaveResult> {
  const accountId = await upsertAccount({
    bank: stmt.bank,
    type: "credit_card",
    last4: stmt.cardLast4,
    customerName: stmt.customerName ?? null,
  });
  const statementId = await upsertStatement({
    accountId,
    sourceFile: fileName,
    periodFrom: stmt.periodFrom ?? null,
    periodTo: stmt.periodTo ?? null,
    txnCount: txns.length,
  });

  const result = await bulkInsertTxns(
    accountId,
    statementId,
    txns.map((t) => ({
      txnDate: t.txnDate,
      valueDate: null,
      narration: t.foreignAmount ? `${t.description} (${t.foreignAmount})` : t.description,
      refNo: null,
      withdrawal: t.isPayment ? null : t.amount,
      deposit: t.isPayment ? t.amount : null,
      closingBalance: null,
      sourceRowIdx: t.sourceRowIdx,
    })),
  );
  return {
    accountId,
    statementId,
    inserted: result.inserted,
    skippedSameStatement: result.skippedSameStatement,
    skippedDuplicate: result.skippedDuplicate,
    skipped: result.skippedSameStatement + result.skippedDuplicate,
  };
}

// ---- Read queries ----

export interface DashboardSummary {
  accountCount: number;
  statementCount: number;
  txnCount: number;
  totalOut: number;
  totalIn: number;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const db = await getDb();
  const result = await db.execute<{
    account_count: number;
    statement_count: number;
    txn_count: number;
    total_out: number;
    total_in: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM accounts)              AS account_count,
      (SELECT COUNT(*)::int FROM statements)            AS statement_count,
      (SELECT COUNT(*)::int FROM transactions)          AS txn_count,
      COALESCE((SELECT SUM(withdrawal) FROM transactions), 0)::real AS total_out,
      COALESCE((SELECT SUM(deposit)    FROM transactions), 0)::real AS total_in
  `);
  const row = result.rows?.[0];
  return {
    accountCount: row?.account_count ?? 0,
    statementCount: row?.statement_count ?? 0,
    txnCount: row?.txn_count ?? 0,
    totalOut: Number(row?.total_out ?? 0),
    totalIn: Number(row?.total_in ?? 0),
  };
}

export interface AccountSummary {
  id: number;
  bank: string;
  type: string;
  last4: string;
  customerName: string | null;
  txnCount: number;
  totalOut: number;
  totalIn: number;
}

export async function getAccountsWithSummary(): Promise<AccountSummary[]> {
  const db = await getDb();
  const result = await db.execute<{
    id: number;
    bank: string;
    type: string;
    last4: string;
    customer_name: string | null;
    txn_count: number;
    total_out: number;
    total_in: number;
  }>(sql`
    SELECT
      a.id, a.bank, a.type, a.last4, a.customer_name,
      COUNT(t.id)::int                       AS txn_count,
      COALESCE(SUM(t.withdrawal), 0)::real   AS total_out,
      COALESCE(SUM(t.deposit), 0)::real      AS total_in
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id
    ORDER BY a.bank, a.type, a.last4
  `);
  return (result.rows ?? []).map((r) => ({
    id: r.id,
    bank: r.bank,
    type: r.type,
    last4: r.last4,
    customerName: r.customer_name,
    txnCount: r.txn_count,
    totalOut: Number(r.total_out),
    totalIn: Number(r.total_in),
  }));
}

export interface CategorySummary {
  category: string;
  /** Top-level group ("Bills", "Food", etc.) — derived from "Group:Sub" by splitting on first ':'. */
  group: string;
  txnCount: number;
  totalOut: number;
  totalIn: number;
}

/**
 * Per-category aggregation. Excludes Investment + Transfer groups by default
 * because they're not "real" spend (moving money between your own accounts /
 * to investment vehicles).
 */
export async function getSpendByCategory(
  opts: { excludeNonSpend?: boolean } = {},
): Promise<CategorySummary[]> {
  const db = await getDb();
  const excludeFilter = opts.excludeNonSpend
    ? sql`AND COALESCE(category, 'Uncategorized') NOT LIKE 'Investment:%' AND COALESCE(category, 'Uncategorized') NOT LIKE 'Transfer:%'`
    : sql``;
  const result = await db.execute<{
    category: string;
    txn_count: number;
    total_out: number;
    total_in: number;
  }>(sql`
    SELECT
      COALESCE(category, 'Uncategorized') AS category,
      COUNT(*)::int                           AS txn_count,
      COALESCE(SUM(withdrawal), 0)::real      AS total_out,
      COALESCE(SUM(deposit), 0)::real         AS total_in
    FROM transactions
    WHERE 1=1 ${excludeFilter}
    GROUP BY COALESCE(category, 'Uncategorized')
    ORDER BY total_out DESC, total_in DESC
  `);
  return (result.rows ?? []).map((r) => ({
    category: r.category,
    group: (r.category.split(":")[0] ?? r.category) as string,
    txnCount: r.txn_count,
    totalOut: Number(r.total_out),
    totalIn: Number(r.total_in),
  }));
}

export interface PeopleSummary {
  personId: string;
  displayName: string;
  relationship: string;
  txnCount: number;
  /** Money YOU sent to this person. */
  totalSent: number;
  /** Money received from this person. */
  totalReceived: number;
  /** Net = totalSent - totalReceived. Positive = they owe you, negative = you owe them. */
  net: number;
  /** Most recent txn date (ISO). */
  lastTxnDate: string | null;
}

/**
 * Per-person aggregation. Joins the persisted person_id back to the in-code
 * registry to enrich with displayName + relationship (denormalized lookup,
 * cheap because the registry is small).
 */
export async function getPeopleSummary(): Promise<PeopleSummary[]> {
  const db = await getDb();
  const result = await db.execute<{
    person_id: string;
    txn_count: number;
    total_sent: number;
    total_received: number;
    last_txn_date: string;
  }>(sql`
    SELECT
      person_id,
      COUNT(*)::int                          AS txn_count,
      COALESCE(SUM(withdrawal), 0)::real     AS total_sent,
      COALESCE(SUM(deposit), 0)::real        AS total_received,
      MAX(txn_date)                          AS last_txn_date
    FROM transactions
    WHERE person_id IS NOT NULL
    GROUP BY person_id
    ORDER BY (COALESCE(SUM(withdrawal), 0) + COALESCE(SUM(deposit), 0)) DESC
  `);
  return (result.rows ?? []).map((r) => {
    const person = DEFAULT_PEOPLE.find((p) => p.id === r.person_id);
    return {
      personId: r.person_id,
      displayName: person?.displayName ?? r.person_id,
      relationship: person?.relationship ?? "other",
      txnCount: r.txn_count,
      totalSent: Number(r.total_sent),
      totalReceived: Number(r.total_received),
      net: Number(r.total_sent) - Number(r.total_received),
      lastTxnDate: r.last_txn_date ?? null,
    };
  });
}

export interface MonthlyBucket {
  /** YYYY-MM */
  month: string;
  txnCount: number;
  totalOut: number;
  totalIn: number;
  /** net = totalIn - totalOut. Positive = saved, negative = bled. */
  net: number;
}

/**
 * Per-month totals for the trend chart. Excludes Investment + Transfer (same
 * "real spend" definition as getSpendByCategory). Ordered oldest → newest.
 */
export async function getMonthlySpend(): Promise<MonthlyBucket[]> {
  const db = await getDb();
  const result = await db.execute<{
    month: string;
    txn_count: number;
    total_out: number;
    total_in: number;
  }>(sql`
    SELECT
      SUBSTRING(txn_date FROM 1 FOR 7) AS month,
      COUNT(*)::int                       AS txn_count,
      COALESCE(SUM(withdrawal), 0)::real  AS total_out,
      COALESCE(SUM(deposit), 0)::real     AS total_in
    FROM transactions
    WHERE COALESCE(category, 'Uncategorized') NOT LIKE 'Investment:%'
      AND COALESCE(category, 'Uncategorized') NOT LIKE 'Transfer:%'
    GROUP BY SUBSTRING(txn_date FROM 1 FOR 7)
    ORDER BY month ASC
  `);
  return (result.rows ?? []).map((r) => {
    const totalOut = Number(r.total_out);
    const totalIn = Number(r.total_in);
    return {
      month: r.month,
      txnCount: r.txn_count,
      totalOut,
      totalIn,
      net: totalIn - totalOut,
    };
  });
}

export interface CategoryByMonth {
  /** YYYY-MM */
  month: string;
  /** Top-level group ("Bills", "Food", …) */
  group: string;
  totalOut: number;
}

/**
 * Group-level spend pivoted by month. Powers the stacked-bar / heatmap view
 * in the monthly report.
 */
export async function getCategorySpendByMonth(): Promise<CategoryByMonth[]> {
  const db = await getDb();
  const result = await db.execute<{
    month: string;
    grp: string;
    total_out: number;
  }>(sql`
    SELECT
      SUBSTRING(txn_date FROM 1 FOR 7) AS month,
      SPLIT_PART(COALESCE(category, 'Uncategorized'), ':', 1) AS grp,
      COALESCE(SUM(withdrawal), 0)::real AS total_out
    FROM transactions
    WHERE COALESCE(category, 'Uncategorized') NOT LIKE 'Investment:%'
      AND COALESCE(category, 'Uncategorized') NOT LIKE 'Transfer:%'
      AND withdrawal IS NOT NULL AND withdrawal > 0
    GROUP BY month, grp
    ORDER BY month ASC, total_out DESC
  `);
  return (result.rows ?? []).map((r) => ({
    month: r.month,
    group: r.grp,
    totalOut: Number(r.total_out),
  }));
}

export interface RecentTxn {
  txnDate: string;
  narration: string;
  withdrawal: number | null;
  deposit: number | null;
  closingBalance: number | null;
  category: string | null;
  personId: string | null;
}

export async function getRecentTransactions(limit = 100): Promise<RecentTxn[]> {
  const db = await getDb();
  const result = await db.execute<{
    txn_date: string;
    narration: string;
    withdrawal: number | null;
    deposit: number | null;
    closing_balance: number | null;
    category: string | null;
    person_id: string | null;
  }>(sql`
    SELECT txn_date, narration, withdrawal, deposit, closing_balance, category, person_id
    FROM transactions
    ORDER BY txn_date DESC, id DESC
    LIMIT ${limit}
  `);
  return (result.rows ?? []).map((r) => ({
    txnDate: r.txn_date,
    narration: r.narration,
    withdrawal: r.withdrawal,
    deposit: r.deposit,
    closingBalance: r.closing_balance,
    category: r.category,
    personId: r.person_id,
  }));
}

// ---- Internal helpers (raw SQL, type-erased) ----

interface UpsertAccountInput {
  bank: string;
  type: string;
  last4: string;
  customerName: string | null;
}

async function upsertAccount(input: UpsertAccountInput): Promise<number> {
  const db = await getDb();
  // Single-statement upsert returning id
  const result = await db.execute<{ id: number }>(sql`
    INSERT INTO accounts (bank, type, last4, customer_name)
    VALUES (${input.bank}, ${input.type}, ${input.last4}, ${input.customerName})
    ON CONFLICT (bank, type, last4) DO UPDATE SET
      customer_name = COALESCE(EXCLUDED.customer_name, accounts.customer_name)
    RETURNING id
  `);
  const id = result.rows?.[0]?.id;
  if (id == null) throw new Error("upsertAccount: no id returned");
  return id;
}

interface UpsertStatementInput {
  accountId: number;
  sourceFile: string;
  periodFrom: string | null;
  periodTo: string | null;
  txnCount: number;
}

async function upsertStatement(input: UpsertStatementInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute<{ id: number }>(sql`
    INSERT INTO statements (account_id, source_file, period_from, period_to, txn_count)
    VALUES (${input.accountId}, ${input.sourceFile}, ${input.periodFrom}, ${input.periodTo}, ${input.txnCount})
    ON CONFLICT (source_file) DO UPDATE SET
      txn_count = EXCLUDED.txn_count
    RETURNING id
  `);
  const id = result.rows?.[0]?.id;
  if (id == null) throw new Error("upsertStatement: no id returned");
  return id;
}

interface InsertTxnInput {
  txnDate: string;
  valueDate: string | null;
  narration: string;
  refNo: string | null;
  withdrawal: number | null;
  deposit: number | null;
  closingBalance: number | null;
  sourceRowIdx: number;
}

/**
 * Apply the default rule set to a narration. Returns the matched category +
 * the rule pattern that matched (for traceability — lets the user understand
 * "why was this tagged as X?").
 *
 * If the user has already tagged a transaction (category column non-null in
 * a re-import scenario), we DON'T re-categorize on insert; the upsert path
 * handles that separately.
 */
function autoCategory(narration: string): { category: string; categoryRule: string | null } {
  const result = categorize(narration, DEFAULT_RULES);
  return { category: result.category, categoryRule: result.matchedRule };
}

/** Identify a known person from the narration. Returns null when unknown. */
function autoPerson(narration: string): string | null {
  const m = identifyPerson(narration, DEFAULT_PEOPLE);
  return m?.personId ?? null;
}

async function bulkInsertTxns(
  accountId: number,
  statementId: number,
  rows: InsertTxnInput[],
): Promise<{ inserted: number; skippedSameStatement: number; skippedDuplicate: number }> {
  const db = await getDb();
  if (rows.length === 0) return { inserted: 0, skippedSameStatement: 0, skippedDuplicate: 0 };

  let inserted = 0;
  let skippedSameStatement = 0;
  let skippedDuplicate = 0;

  await db.execute(sql`BEGIN`);
  try {
    for (const r of rows) {
      const contentHash = computeContentHash({
        txnDate: r.txnDate,
        refNo: r.refNo,
        withdrawal: r.withdrawal,
        deposit: r.deposit,
        narration: r.narration,
      });

      // Two layers of dedup, distinguished for the user:
      //   1. (statement_id, source_row_idx) — re-uploading the SAME PDF
      //   2. (account_id, content_hash)     — same txn from a DIFFERENT PDF
      // Postgres ON CONFLICT can target only one constraint per statement,
      // so we check the cross-statement dedup first, then attempt the insert.
      const existing = await db.execute<{ id: number; statement_id: number }>(sql`
        SELECT id, statement_id FROM transactions
        WHERE account_id = ${accountId} AND content_hash = ${contentHash}
        LIMIT 1
      `);
      if ((existing.rows?.length ?? 0) > 0) {
        const sameStatement = existing.rows![0]!.statement_id === statementId;
        if (sameStatement) skippedSameStatement++;
        else skippedDuplicate++;
        continue;
      }

      const { category, categoryRule } = autoCategory(r.narration);
      const personId = autoPerson(r.narration);
      const result = await db.execute<{ id: number }>(sql`
        INSERT INTO transactions (
          account_id, statement_id, txn_date, value_date, narration, ref_no,
          withdrawal, deposit, closing_balance, source_row_idx, content_hash,
          category, category_rule, person_id
        ) VALUES (
          ${accountId}, ${statementId}, ${r.txnDate}, ${r.valueDate}, ${r.narration},
          ${r.refNo}, ${r.withdrawal}, ${r.deposit}, ${r.closingBalance}, ${r.sourceRowIdx},
          ${contentHash}, ${category}, ${categoryRule}, ${personId}
        )
        ON CONFLICT (statement_id, source_row_idx) DO NOTHING
        RETURNING id
      `);
      if ((result.rows?.length ?? 0) > 0) inserted++;
      else skippedSameStatement++;
    }
    await db.execute(sql`COMMIT`);
  } catch (err) {
    await db.execute(sql`ROLLBACK`);
    throw err;
  }
  return { inserted, skippedSameStatement, skippedDuplicate };
}
