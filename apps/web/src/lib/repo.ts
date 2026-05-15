/**
 * Server-side query layer over the canonical SQLite database.
 *
 * Runs in the Next.js Node runtime (Server Components / Route Handlers). The
 * web app is a read-only viewer over data the daemon has already ingested
 * into ~/Library/Application Support/splitlens/splitlens.sqlite. No browser
 * IndexedDB, no PGlite anymore.
 *
 * Every export here is a Drizzle query that runs server-side. Components
 * `await` them and receive plain JSON-serializable results.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { openDb, type SplitLensDb } from "@splitlens/db";
import { DEFAULT_PEOPLE } from "@splitlens/core";

// Open the SQLite handle lazily on first query — cheap (~1ms) so we can do
// it per-request and let process exit close the file naturally. Avoids the
// dev-mode "module-singleton leaks between HMR reloads" trap.
function db(): SplitLensDb {
  return openDb();
}

// ============================================================================
// Tile-strip stats at the top of the dashboard
// ============================================================================

export interface DashboardSummary {
  accountCount: number;
  statementCount: number;
  txnCount: number;
  totalOut: number;
  totalIn: number;
  net: number;
  /** Rows that have a wall-clock `txn_time` (i.e. enriched by PhonePe/CC). */
  txnsWithTime: number;
  /** Date of the earliest transaction we have on record. */
  earliestTxnDate: string | null;
  latestTxnDate: string | null;
  autopayPairs: number;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const rows = db()
    .all<{
      account_count: number;
      statement_count: number;
      txn_count: number;
      total_out: number | null;
      total_in: number | null;
      txns_with_time: number;
      earliest: string | null;
      latest: string | null;
      autopay_rows: number;
    }>(sql`
      SELECT
        (SELECT count(*) FROM accounts)                                 AS account_count,
        (SELECT count(*) FROM statements)                               AS statement_count,
        (SELECT count(*) FROM transactions)                             AS txn_count,
        (SELECT coalesce(sum(withdrawal), 0) FROM transactions)         AS total_out,
        (SELECT coalesce(sum(deposit), 0) FROM transactions)            AS total_in,
        (SELECT count(*) FROM transactions WHERE txn_time IS NOT NULL)  AS txns_with_time,
        (SELECT min(txn_date) FROM transactions)                        AS earliest,
        (SELECT max(txn_date) FROM transactions)                        AS latest,
        (SELECT count(*) FROM transactions WHERE linked_txn_id IS NOT NULL) AS autopay_rows
    `);
  const r = rows[0]!;
  return {
    accountCount: r.account_count,
    statementCount: r.statement_count,
    txnCount: r.txn_count,
    totalOut: Number(r.total_out ?? 0),
    totalIn: Number(r.total_in ?? 0),
    net: Number(r.total_in ?? 0) - Number(r.total_out ?? 0),
    txnsWithTime: r.txns_with_time,
    earliestTxnDate: r.earliest,
    latestTxnDate: r.latest,
    autopayPairs: Math.floor(r.autopay_rows / 2),
  };
}

// ============================================================================
// Per-account roll-ups
// ============================================================================

export interface AccountSummary {
  id: number;
  bank: string;
  type: string;
  last4: string;
  customerName: string | null;
  txnCount: number;
  totalOut: number;
  totalIn: number;
  net: number;
}

export async function getAccountsWithSummary(): Promise<AccountSummary[]> {
  const rows = db().all<{
    id: number;
    bank: string;
    type: string;
    last4: string;
    customer_name: string | null;
    txn_count: number;
    total_out: number | null;
    total_in: number | null;
  }>(sql`
    SELECT
      a.id, a.bank, a.type, a.last4, a.customer_name,
      count(t.id)                              AS txn_count,
      coalesce(sum(t.withdrawal), 0)           AS total_out,
      coalesce(sum(t.deposit), 0)              AS total_in
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id
    ORDER BY a.type, a.last4
  `);
  return rows.map((r) => ({
    id: r.id,
    bank: r.bank,
    type: r.type,
    last4: r.last4,
    customerName: r.customer_name,
    txnCount: r.txn_count,
    totalOut: Number(r.total_out ?? 0),
    totalIn: Number(r.total_in ?? 0),
    net: Number(r.total_in ?? 0) - Number(r.total_out ?? 0),
  }));
}

// ============================================================================
// Top-of-mind people
// ============================================================================

export interface PeopleSummary {
  personId: string;
  displayName: string;
  relationship: string;
  txnCount: number;
  totalSent: number;
  totalReceived: number;
  /** Positive = you've sent net to them; negative = they've sent to you. */
  net: number;
  lastTxnDate: string | null;
}

export async function getPeopleSummary(): Promise<PeopleSummary[]> {
  const rows = db().all<{
    person_id: string;
    txn_count: number;
    total_sent: number | null;
    total_received: number | null;
    last_txn_date: string | null;
  }>(sql`
    SELECT
      person_id,
      count(*)                                AS txn_count,
      coalesce(sum(withdrawal), 0)            AS total_sent,
      coalesce(sum(deposit), 0)               AS total_received,
      max(txn_date)                           AS last_txn_date
    FROM transactions
    WHERE person_id IS NOT NULL
    GROUP BY person_id
    ORDER BY (coalesce(sum(withdrawal), 0) + coalesce(sum(deposit), 0)) DESC
  `);
  return rows.map((r) => {
    const person = DEFAULT_PEOPLE.find((p) => p.id === r.person_id);
    return {
      personId: r.person_id,
      displayName: person?.displayName ?? r.person_id,
      relationship: person?.relationship ?? "other",
      txnCount: r.txn_count,
      totalSent: Number(r.total_sent ?? 0),
      totalReceived: Number(r.total_received ?? 0),
      net: Number(r.total_sent ?? 0) - Number(r.total_received ?? 0),
      lastTxnDate: r.last_txn_date,
    };
  });
}

// ============================================================================
// Categorized spending
// ============================================================================

export interface CategorySummary {
  category: string;
  group: string;
  txnCount: number;
  totalOut: number;
  totalIn: number;
}

export async function getSpendByCategory(
  opts: { excludeNonSpend?: boolean; limit?: number } = {},
): Promise<CategorySummary[]> {
  const limit = opts.limit ?? 25;
  // Defensive filter for the "Transfer:..." / "Investment:..." groups: those
  // are intra-account hops, not real spending.
  const filter = opts.excludeNonSpend
    ? sql`AND category IS NOT NULL AND category NOT LIKE 'Transfer:%' AND category NOT LIKE 'Investment:%'`
    : sql`AND category IS NOT NULL`;
  const rows = db().all<{
    category: string;
    txn_count: number;
    total_out: number | null;
    total_in: number | null;
  }>(sql`
    SELECT category, count(*) AS txn_count,
           coalesce(sum(withdrawal), 0) AS total_out,
           coalesce(sum(deposit), 0) AS total_in
    FROM transactions
    WHERE 1=1 ${filter}
    GROUP BY category
    ORDER BY total_out DESC, total_in DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    category: r.category,
    group: r.category.split(":")[0] ?? r.category,
    txnCount: r.txn_count,
    totalOut: Number(r.total_out ?? 0),
    totalIn: Number(r.total_in ?? 0),
  }));
}

// ============================================================================
// Recent transactions (the bottom-of-dashboard table)
// ============================================================================

export interface RecentTxn {
  id: number;
  txnDate: string;
  txnTime: string | null;
  narration: string | null;
  counterparty: string | null;
  counterpartyKind: string | null;
  withdrawal: number | null;
  deposit: number | null;
  closingBalance: number | null;
  category: string | null;
  personId: string | null;
  /** Number of distinct sources that observed this row (1+). 2+ = multi-source enriched. */
  sourceCount: number;
}

export async function getRecentTransactions(limit = 100): Promise<RecentTxn[]> {
  const rows = db().all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    narration: string | null;
    counterparty: string | null;
    counterparty_kind: string | null;
    withdrawal: number | null;
    deposit: number | null;
    closing_balance: number | null;
    category: string | null;
    person_id: string | null;
    source_count: number;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.narration, t.counterparty, t.counterparty_kind,
           t.withdrawal, t.deposit, t.closing_balance, t.category, t.person_id,
           (SELECT count(DISTINCT source_type) FROM transaction_sources WHERE transaction_id = t.id) AS source_count
    FROM transactions t
    ORDER BY t.txn_date DESC, coalesce(t.txn_time, '00:00') DESC, t.id DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    txnDate: r.txn_date,
    txnTime: r.txn_time,
    narration: r.narration,
    counterparty: r.counterparty,
    counterpartyKind: r.counterparty_kind,
    withdrawal: r.withdrawal,
    deposit: r.deposit,
    closingBalance: r.closing_balance,
    category: r.category,
    personId: r.person_id,
    sourceCount: r.source_count,
  }));
}

// ============================================================================
// NEW: Time-of-day × Day-of-week heatmap
// ============================================================================

export interface HeatmapCell {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  /** 0–23 */
  hour: number;
  totalSpend: number;
  txnCount: number;
}

export async function getTimeOfDayHeatmap(): Promise<HeatmapCell[]> {
  const rows = db().all<{ dow: number; hour: number; total: number; n: number }>(sql`
    SELECT
      cast(strftime('%w', txn_date) AS INTEGER) AS dow,
      cast(substr(txn_time, 1, 2) AS INTEGER)   AS hour,
      coalesce(sum(withdrawal), 0)              AS total,
      count(*)                                  AS n
    FROM transactions
    WHERE txn_time IS NOT NULL
      AND withdrawal IS NOT NULL
    GROUP BY dow, hour
  `);
  return rows.map((r) => ({
    dayOfWeek: r.dow,
    hour: r.hour,
    totalSpend: Number(r.total ?? 0),
    txnCount: r.n,
  }));
}

// ============================================================================
// NEW: Multi-year monthly spend trajectory
// ============================================================================

export interface MonthlySpendPoint {
  /** 'YYYY-MM' */
  yearMonth: string;
  totalOut: number;
  totalIn: number;
  txnCount: number;
}

export async function getMonthlyTrajectory(): Promise<MonthlySpendPoint[]> {
  const rows = db().all<{
    ym: string;
    total_out: number | null;
    total_in: number | null;
    n: number;
  }>(sql`
    SELECT substr(txn_date, 1, 7)            AS ym,
           coalesce(sum(withdrawal), 0)      AS total_out,
           coalesce(sum(deposit), 0)         AS total_in,
           count(*)                          AS n
    FROM transactions
    GROUP BY ym
    ORDER BY ym
  `);
  return rows.map((r) => ({
    yearMonth: r.ym,
    totalOut: Number(r.total_out ?? 0),
    totalIn: Number(r.total_in ?? 0),
    txnCount: r.n,
  }));
}

// ============================================================================
// NEW: GitHub-style daily spending calendar
// ============================================================================

export interface DailySpendPoint {
  txnDate: string;
  totalOut: number;
  txnCount: number;
}

export async function getDailySpend(): Promise<DailySpendPoint[]> {
  const rows = db().all<{ d: string; total: number; n: number }>(sql`
    SELECT txn_date AS d,
           coalesce(sum(withdrawal), 0) AS total,
           count(*) AS n
    FROM transactions
    WHERE withdrawal IS NOT NULL
    GROUP BY txn_date
    ORDER BY txn_date
  `);
  return rows.map((r) => ({
    txnDate: r.d,
    totalOut: Number(r.total ?? 0),
    txnCount: r.n,
  }));
}

// ============================================================================
// NEW: Per-day drill-down — used by the SpendingCalendar's click handler
// ============================================================================

export interface DrillDownTxn {
  id: number;
  txnDate: string;
  txnTime: string | null;
  counterparty: string | null;
  narration: string | null;
  counterpartyKind: string | null;
  withdrawal: number | null;
  deposit: number | null;
  category: string | null;
  accountBank: string;
  accountType: string;
  accountLast4: string;
}

export async function getTransactionsForDate(date: string): Promise<DrillDownTxn[]> {
  // Defensive — only accept a real ISO YYYY-MM-DD to avoid any SQL surprises.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const rows = db().all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    counterparty: string | null;
    narration: string | null;
    counterparty_kind: string | null;
    withdrawal: number | null;
    deposit: number | null;
    category: string | null;
    bank: string;
    type: string;
    last4: string;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.counterparty, t.narration,
           t.counterparty_kind, t.withdrawal, t.deposit, t.category,
           a.bank, a.type, a.last4
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.txn_date = ${date}
    ORDER BY coalesce(t.txn_time, '00:00') ASC, t.id ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    txnDate: r.txn_date,
    txnTime: r.txn_time,
    counterparty: r.counterparty,
    narration: r.narration,
    counterpartyKind: r.counterparty_kind,
    withdrawal: r.withdrawal,
    deposit: r.deposit,
    category: r.category,
    accountBank: r.bank,
    accountType: r.type,
    accountLast4: r.last4,
  }));
}

// ============================================================================
// NEW: Top counterparties (clean PhonePe-style names, with kind badge)
// ============================================================================

export interface TopCounterparty {
  counterparty: string;
  counterpartyKind: string;
  txnCount: number;
  totalOut: number;
  totalIn: number;
  net: number;
  firstSeen: string;
  lastSeen: string;
}

export async function getTopCounterparties(limit = 30): Promise<TopCounterparty[]> {
  const rows = db().all<{
    counterparty: string;
    kind: string | null;
    n: number;
    total_out: number | null;
    total_in: number | null;
    first: string;
    last: string;
  }>(sql`
    SELECT
      counterparty,
      counterparty_kind AS kind,
      count(*)                              AS n,
      coalesce(sum(withdrawal), 0)          AS total_out,
      coalesce(sum(deposit), 0)             AS total_in,
      min(txn_date)                         AS first,
      max(txn_date)                         AS last
    FROM transactions
    WHERE counterparty IS NOT NULL AND counterparty != ''
    GROUP BY counterparty, counterparty_kind
    ORDER BY (coalesce(sum(withdrawal), 0) + coalesce(sum(deposit), 0)) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    counterparty: r.counterparty,
    counterpartyKind: r.kind ?? "unknown",
    txnCount: r.n,
    totalOut: Number(r.total_out ?? 0),
    totalIn: Number(r.total_in ?? 0),
    net: Number(r.total_in ?? 0) - Number(r.total_out ?? 0),
    firstSeen: r.first,
    lastSeen: r.last,
  }));
}

// ============================================================================
// NEW: Autopay link pairs (savings ↔ CC autopay payments)
// ============================================================================

export interface AutopayPair {
  pairId: string;
  txnDate: string;
  amount: number;
  fromAccount: string;
  toAccount: string;
}

export async function getAutopayPairs(): Promise<AutopayPair[]> {
  const rows = db().all<{
    s_id: number;
    c_id: number;
    s_date: string;
    s_amount: number;
    s_last4: string;
    c_last4: string;
  }>(sql`
    SELECT s.id AS s_id, c.id AS c_id, s.txn_date AS s_date,
           s.withdrawal AS s_amount, sa.last4 AS s_last4, ca.last4 AS c_last4
    FROM transactions s
    JOIN transactions c ON c.id = s.linked_txn_id
    JOIN accounts sa ON sa.id = s.account_id
    JOIN accounts ca ON ca.id = c.account_id
    WHERE sa.type = 'savings' AND ca.type = 'credit_card'
    ORDER BY s.txn_date DESC
  `);
  return rows.map((r) => ({
    pairId: `${r.s_id}-${r.c_id}`,
    txnDate: r.s_date,
    amount: Number(r.s_amount ?? 0),
    fromAccount: `XX${r.s_last4}`,
    toAccount: `XX${r.c_last4}`,
  }));
}

// ============================================================================
// NEW: Category tree (top-level group → subcategory → spend)
// ============================================================================

export interface CategoryTreeLeaf {
  group: string;
  subcategory: string;
  totalOut: number;
  txnCount: number;
}

export async function getCategoryTree(): Promise<CategoryTreeLeaf[]> {
  const rows = db().all<{
    category: string;
    total_out: number | null;
    n: number;
  }>(sql`
    SELECT category, coalesce(sum(withdrawal), 0) AS total_out, count(*) AS n
    FROM transactions
    WHERE category IS NOT NULL
      AND category NOT LIKE 'Transfer:%'
      AND category NOT LIKE 'Investment:%'
      AND withdrawal IS NOT NULL
    GROUP BY category
    HAVING total_out > 0
  `);
  return rows.map((r) => {
    const [group, sub] = r.category.split(":");
    return {
      group: group ?? r.category,
      subcategory: sub ?? group ?? r.category,
      totalOut: Number(r.total_out ?? 0),
      txnCount: r.n,
    };
  });
}
