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
  /** CSV of person_ids who share this expense. Drives the Friends UI. */
  sharedWith: string[];
  /** Total people in the split (1 = not shared, 3 = 3-way split). */
  shareCount: number;
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
    shared_with: string | null;
    share_count: number;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.narration, t.counterparty, t.counterparty_kind,
           t.withdrawal, t.deposit, t.closing_balance, t.category, t.person_id,
           t.shared_with, t.share_count,
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
    sharedWith: r.shared_with
      ? r.shared_with.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    shareCount: r.share_count ?? 1,
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
// MONTHLY REPORT — the "review your spending" page
// ============================================================================
//
// Built around an ADHD-friendly review flow: every outgoing transaction in
// the chosen month is bucketed into one of four queues so the user can chunk
// the work:
//
//   1. house-shape  — bills/groceries/utilities ≥ ₹500, suggest split with flatmates
//   2. chase-up     — outgoing UPI to a registered friend with no return inflow
//                     within 14 days; suggest "ask for payback"
//   3. usual-split  — same counterparty has been shared with the same friends
//                     ≥2 times before; one-click accept the same split
//   4. other        — everything else outgoing, no auto-suggestion
//
// Already-reviewed and already-shared rows show up in a collapsed "done"
// section so progress is visible (and undo is one click).

export type ReviewBucket = "house" | "chase" | "usual" | "other" | "done";

export interface ReportTxn {
  id: number;
  txnDate: string;
  txnTime: string | null;
  counterparty: string | null;
  narration: string | null;
  counterpartyKind: string | null;
  withdrawal: number;
  category: string | null;
  personId: string | null;
  reviewed: boolean;
  /** Empty array when not yet shared; populated when the user has split it. */
  sharedWith: string[];
  shareCount: number;
  /** Account label e.g. "HDFC Savings XX2491". */
  accountLabel: string;
  /** Bucket assigned by the auto-classifier. */
  bucket: ReviewBucket;
  /** Pre-baked one-click suggestion, when applicable. */
  suggestion: {
    /** Friends to suggest splitting with. */
    personIds: string[];
    /** Human-readable reason ("Usually split with Rahul + Shivam", etc.). */
    reason: string;
  } | null;
}

export interface MonthlyReport {
  yearMonth: string;
  /** All months we have data for, sorted ASC. Used by the month picker. */
  availableMonths: string[];
  totalOut: number;
  totalIn: number;
  txnCount: number;
  reviewedCount: number;
  reviewedAmount: number;
  /** Per-bucket transaction lists, all sorted by date asc. */
  buckets: Record<ReviewBucket, ReportTxn[]>;
}

/** ISO 'YYYY-MM' or `null` for "current month derived from latest txn date". */
export async function getMonthlyReport(yearMonth: string | null): Promise<MonthlyReport> {
  const months = db()
    .all<{ ym: string }>(sql`
      SELECT DISTINCT substr(txn_date, 1, 7) AS ym FROM transactions ORDER BY ym
    `)
    .map((r) => r.ym);

  const ym = yearMonth ?? months[months.length - 1] ?? new Date().toISOString().slice(0, 7);
  // Defensive — never let an arbitrary string into the SQL substr() match.
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return {
      yearMonth: ym,
      availableMonths: months,
      totalOut: 0,
      totalIn: 0,
      txnCount: 0,
      reviewedCount: 0,
      reviewedAmount: 0,
      buckets: { house: [], chase: [], usual: [], other: [], done: [] },
    };
  }

  // Top-of-month counters.
  const top = db().all<{
    n: number;
    out: number;
    in_: number;
    reviewed_n: number;
    reviewed_amt: number;
  }>(sql`
    SELECT
      count(*)                              AS n,
      coalesce(sum(withdrawal), 0)          AS out,
      coalesce(sum(deposit), 0)             AS in_,
      count(*) FILTER (WHERE reviewed = 1)  AS reviewed_n,
      coalesce(sum(withdrawal) FILTER (WHERE reviewed = 1), 0) AS reviewed_amt
    FROM transactions
    WHERE substr(txn_date, 1, 7) = ${ym}
  `)[0]!;

  // Every outgoing for the month.
  const rawTxns = db().all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    counterparty: string | null;
    narration: string | null;
    counterparty_kind: string | null;
    withdrawal: number | null;
    category: string | null;
    person_id: string | null;
    reviewed: number;
    shared_with: string | null;
    share_count: number;
    bank: string;
    type: string;
    last4: string;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.counterparty, t.narration,
           t.counterparty_kind, t.withdrawal, t.category, t.person_id,
           t.reviewed, t.shared_with, t.share_count,
           a.bank, a.type, a.last4
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE substr(t.txn_date, 1, 7) = ${ym}
      AND t.withdrawal IS NOT NULL
      AND t.withdrawal > 0
    ORDER BY t.txn_date ASC, coalesce(t.txn_time, '00:00') ASC, t.id ASC
  `);

  // Pre-compute "usually split with whom" by counterparty across ALL history.
  const usualByCounterparty = computeUsualSharing();
  // And: incoming UPI from each person within 14 days *of any outgoing*, used
  // for the chase-up detector.
  const incomingFromPerson = computeIncomingsByPersonByDate();
  // Flatmates from the registry, for house-shape suggestions.
  const flatmates = DEFAULT_PEOPLE.filter((p) => p.relationship === "flatmate").map((p) => p.id);

  const buckets: Record<ReviewBucket, ReportTxn[]> = {
    house: [],
    chase: [],
    usual: [],
    other: [],
    done: [],
  };

  for (const r of rawTxns) {
    const sharedWith = r.shared_with
      ? r.shared_with.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const isReviewed = Boolean(r.reviewed);
    const isShared = sharedWith.length > 0;
    const amount = Number(r.withdrawal ?? 0);

    const accountLabel = `${r.bank} ${r.type === "credit_card" ? "CC" : "Savings"} XX${r.last4}`;

    let bucket: ReviewBucket = "other";
    let suggestion: ReportTxn["suggestion"] = null;

    // Done = already reviewed OR already shared (the latter is implicitly settled).
    if (isReviewed || isShared) {
      bucket = "done";
    } else {
      const usual = r.counterparty ? usualByCounterparty.get(r.counterparty) : undefined;
      if (usual && usual.personIds.length > 0) {
        bucket = "usual";
        suggestion = {
          personIds: usual.personIds,
          reason: `Usually split with ${usual.displayNames.join(" + ")} (last ${usual.count}× with this merchant)`,
        };
      } else if (
        r.person_id &&
        amount >= 500 &&
        !hasMatchingReturnInflow(r.person_id, r.txn_date, amount, incomingFromPerson)
      ) {
        bucket = "chase";
        const friend = DEFAULT_PEOPLE.find((p) => p.id === r.person_id);
        suggestion = {
          personIds: r.person_id ? [r.person_id] : [],
          reason: `Paid ${friend?.displayName ?? r.person_id} — no return UPI in 14 days. Forgot to ask back?`,
        };
      } else if (isHouseShape(r.category, amount) && flatmates.length > 0) {
        bucket = "house";
        suggestion = {
          personIds: flatmates,
          reason: `Looks like a house expense — suggest split with flatmates (${flatmates
            .map((id) => DEFAULT_PEOPLE.find((p) => p.id === id)?.displayName?.split(" ")[0] ?? id)
            .join(" + ")})`,
        };
      } else {
        bucket = "other";
      }
    }

    buckets[bucket].push({
      id: r.id,
      txnDate: r.txn_date,
      txnTime: r.txn_time,
      counterparty: r.counterparty,
      narration: r.narration,
      counterpartyKind: r.counterparty_kind,
      withdrawal: amount,
      category: r.category,
      personId: r.person_id,
      reviewed: isReviewed,
      sharedWith,
      shareCount: r.share_count ?? 1,
      accountLabel,
      bucket,
      suggestion,
    });
  }

  return {
    yearMonth: ym,
    availableMonths: months,
    totalOut: Number(top.out ?? 0),
    totalIn: Number(top.in_ ?? 0),
    txnCount: top.n,
    reviewedCount: top.reviewed_n,
    reviewedAmount: Number(top.reviewed_amt ?? 0),
    buckets,
  };
}

/**
 * Categories that look like flatmate-shared house expenses. Conservative on
 * purpose — false positives waste the user's attention.
 */
function isHouseShape(category: string | null, amount: number): boolean {
  if (!category || amount < 500) return false;
  return (
    category.startsWith("Bills:Electricity") ||
    category.startsWith("Bills:Internet") ||
    category.startsWith("Bills:Mobile") ||
    category.startsWith("Bills:Rent") ||
    category.startsWith("Bills:Gas") ||
    category.startsWith("Food:Groceries") ||
    category.startsWith("Food:Quick Commerce") ||
    category.startsWith("Household:")
  );
}

interface UsualSharing {
  personIds: string[];
  displayNames: string[];
  count: number;
}

/**
 * Per-counterparty most-frequent shared_with set, across all history. If a
 * user has split Blinkit with [rahul, shivam] 5 times before, the next
 * Blinkit suggestion is the same trio. Min support = 2 to avoid one-offs.
 */
function computeUsualSharing(): Map<string, UsualSharing> {
  const rows = db().all<{ counterparty: string; shared_with: string; n: number }>(sql`
    SELECT counterparty, shared_with, count(*) AS n
    FROM transactions
    WHERE counterparty IS NOT NULL AND shared_with IS NOT NULL AND shared_with != ''
    GROUP BY counterparty, shared_with
  `);
  const byCounterparty = new Map<string, UsualSharing>();
  for (const r of rows) {
    if (r.n < 2) continue;
    const personIds = r.shared_with.split(",").map((s) => s.trim()).filter(Boolean);
    if (personIds.length === 0) continue;
    const existing = byCounterparty.get(r.counterparty);
    if (!existing || existing.count < r.n) {
      const displayNames = personIds.map(
        (id) =>
          DEFAULT_PEOPLE.find((p) => p.id === id)?.displayName?.split(" ")[0] ?? id,
      );
      byCounterparty.set(r.counterparty, { personIds, displayNames, count: r.n });
    }
  }
  return byCounterparty;
}

interface IncomingMap {
  /** Map of personId → array of [date, amount] tuples, sorted by date asc. */
  byPerson: Map<string, { date: string; amount: number }[]>;
}

function computeIncomingsByPersonByDate(): IncomingMap {
  const rows = db().all<{ person_id: string; date: string; amount: number }>(sql`
    SELECT person_id, txn_date AS date, deposit AS amount
    FROM transactions
    WHERE person_id IS NOT NULL AND deposit IS NOT NULL AND deposit > 0
    ORDER BY txn_date ASC
  `);
  const byPerson = new Map<string, { date: string; amount: number }[]>();
  for (const r of rows) {
    const arr = byPerson.get(r.person_id) ?? [];
    arr.push({ date: r.date, amount: Number(r.amount) });
    byPerson.set(r.person_id, arr);
  }
  return { byPerson };
}

/**
 * Heuristic: did this person return at least `amount × 0.8` to me within 14
 * days of `outgoingDate`? If yes, the chase-up is probably already settled.
 * The 80% threshold permits "rounded down" reimbursements (paid back ₹500
 * for a ₹520 expense).
 */
function hasMatchingReturnInflow(
  personId: string,
  outgoingDate: string,
  outgoingAmount: number,
  incoming: IncomingMap,
): boolean {
  const events = incoming.byPerson.get(personId) ?? [];
  const outDate = new Date(outgoingDate + "T00:00:00Z").getTime();
  const fourteenDays = 14 * 86400 * 1000;
  for (const e of events) {
    const eDate = new Date(e.date + "T00:00:00Z").getTime();
    if (eDate < outDate) continue;
    if (eDate - outDate > fourteenDays) break;
    if (e.amount >= outgoingAmount * 0.8) return true;
  }
  return false;
}

// ============================================================================
// FRIENDS — Splitwise-style settlement
// ============================================================================
//
// Two flows compose into a per-friend net balance:
//   1. Direct UPI: every outgoing to F adds to "F owes you"; every incoming
//      from F subtracts. This already works without any marking — straight
//      from person_id on the canonical ledger.
//   2. Shared expenses: when you mark a withdrawal as shared with N people
//      (yourself + N-1 friends), each of those friends owes you
//      withdrawal / share_count.
//
// Convention: positive net = friend owes you, negative = you owe them.

export interface FriendOverviewRow {
  personId: string;
  displayName: string;
  relationship: string;
  /** Number of canonical transactions where this person is the counterparty. */
  directTxnCount: number;
  /** Direct outgoing UPIs you've sent to them. */
  directOut: number;
  /** Direct incoming UPIs they've sent you. */
  directIn: number;
  /** Number of shared transactions where this person is in `shared_with`. */
  sharedTxnCount: number;
  /** Their share of all shared expenses you've marked: Σ(amount / share_count). */
  sharedOwed: number;
  /** Net: positive = they owe you, negative = you owe them. */
  net: number;
  lastTxnDate: string | null;
}

/**
 * One row per known person with the full settlement breakdown. Both flows
 * are aggregated in a single pass over the transactions table so the
 * dashboard's /friends view renders in one query.
 */
export async function getFriendsOverview(): Promise<FriendOverviewRow[]> {
  // Direct flows (per person_id).
  const directRows = db().all<{
    person_id: string;
    n: number;
    total_out: number | null;
    total_in: number | null;
    last_date: string | null;
  }>(sql`
    SELECT
      person_id,
      count(*)                              AS n,
      coalesce(sum(withdrawal), 0)          AS total_out,
      coalesce(sum(deposit), 0)             AS total_in,
      max(txn_date)                         AS last_date
    FROM transactions
    WHERE person_id IS NOT NULL
    GROUP BY person_id
  `);

  // Shared-expense flows. Each shared row contributes amount/share_count to
  // every person id in its `shared_with` CSV. We unroll this in code rather
  // than SQL since SQLite has no native string_split.
  const sharedRows = db().all<{
    id: number;
    withdrawal: number;
    share_count: number;
    shared_with: string;
  }>(sql`
    SELECT id, withdrawal, share_count, shared_with
    FROM transactions
    WHERE shared_with IS NOT NULL
      AND shared_with != ''
      AND withdrawal IS NOT NULL
      AND withdrawal > 0
      AND share_count > 1
  `);

  const sharedAgg = new Map<string, { count: number; total: number }>();
  for (const r of sharedRows) {
    const others = r.shared_with.split(",").map((s) => s.trim()).filter(Boolean);
    const perHead = r.withdrawal / r.share_count;
    for (const pid of others) {
      const cur = sharedAgg.get(pid) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += perHead;
      sharedAgg.set(pid, cur);
    }
  }

  // Merge by personId. Build a union of all person_ids seen in either flow.
  const allPids = new Set<string>([
    ...directRows.map((r) => r.person_id),
    ...sharedAgg.keys(),
  ]);
  const out: FriendOverviewRow[] = [];
  for (const pid of allPids) {
    const direct = directRows.find((r) => r.person_id === pid);
    const shared = sharedAgg.get(pid) ?? { count: 0, total: 0 };
    const person = DEFAULT_PEOPLE.find((p) => p.id === pid);
    const directOut = Number(direct?.total_out ?? 0);
    const directIn = Number(direct?.total_in ?? 0);
    out.push({
      personId: pid,
      displayName: person?.displayName ?? pid,
      relationship: person?.relationship ?? "other",
      directTxnCount: direct?.n ?? 0,
      directOut,
      directIn,
      sharedTxnCount: shared.count,
      sharedOwed: shared.total,
      // Owes-you = direct outgoing + their share - direct incoming.
      net: directOut + shared.total - directIn,
      lastTxnDate: direct?.last_date ?? null,
    });
  }
  // Show biggest absolute balances first so the most actionable rows are up top.
  return out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

export interface FriendDetail {
  person: FriendOverviewRow;
  /** Direct transactions (UPIs to/from this person, regardless of shared marker). */
  directTxns: DrillDownTxn[];
  /** Shared transactions where this person is in the shared_with CSV. */
  sharedTxns: (DrillDownTxn & { shareCount: number; sharedWith: string[]; perHead: number })[];
}

export async function getFriendDetail(personId: string): Promise<FriendDetail | null> {
  if (!/^[a-z][a-z0-9-]*$/i.test(personId)) return null;

  // Reuse the overview to get aggregates (one row).
  const all = await getFriendsOverview();
  const person = all.find((p) => p.personId === personId);
  if (!person) return null;

  // Direct txns (this person is counterparty).
  const direct = db().all<{
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
    WHERE t.person_id = ${personId}
    ORDER BY t.txn_date DESC, coalesce(t.txn_time, '00:00') DESC, t.id DESC
  `);

  // Shared txns. Match `shared_with` against this personId — we use LIKE
  // anchored against CSV boundaries to avoid 'rahul' matching 'rahul-d'.
  const likeNeedle = `%${personId}%`;
  const sharedRaw = db().all<{
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
    share_count: number;
    shared_with: string;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.counterparty, t.narration,
           t.counterparty_kind, t.withdrawal, t.deposit, t.category,
           a.bank, a.type, a.last4,
           t.share_count, t.shared_with
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.shared_with LIKE ${likeNeedle}
    ORDER BY t.txn_date DESC, coalesce(t.txn_time, '00:00') DESC, t.id DESC
  `);
  // Defensive in-code filter: confirm exact CSV membership.
  const sharedTxns = sharedRaw
    .map((r) => {
      const sharedWith = r.shared_with.split(",").map((s) => s.trim()).filter(Boolean);
      if (!sharedWith.includes(personId)) return null;
      const perHead = (r.withdrawal ?? 0) / r.share_count;
      return {
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
        shareCount: r.share_count,
        sharedWith,
        perHead,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Single batched lookup for item enrichment across both direct + shared
  // sets; cheaper than two separate joins.
  const allIds = [...direct.map((r) => r.id), ...sharedTxns.map((r) => r.id)];
  const itemMap = getItemEnrichmentsForTxns(allIds);
  return {
    person,
    directTxns: direct.map((r) => ({
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
      items: itemMap.get(r.id) ?? null,
    })),
    sharedTxns: sharedTxns.map((t) => ({
      ...t,
      items: itemMap.get(t.id) ?? null,
    })),
  };
}

/**
 * Candidates for splitting: high-spend "shareable-shape" transactions that
 * aren't already marked as shared. Used by /friends to nudge the user
 * toward marking up their backlog without them having to scroll the whole
 * recent list.
 *
 * Heuristic: outgoing, amount ≥ ₹500, category is in a "splittable" set
 * (food / travel / groceries), and shared_with is null/empty.
 */
export interface CandidateShare {
  id: number;
  txnDate: string;
  txnTime: string | null;
  counterparty: string | null;
  narration: string | null;
  amount: number;
  category: string | null;
  /** A hint built from amount + category: 'big-food', 'big-travel', etc. */
  hint: string;
}

export async function getCandidateShares(limit = 20): Promise<CandidateShare[]> {
  const rows = db().all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    counterparty: string | null;
    narration: string | null;
    withdrawal: number;
    category: string | null;
  }>(sql`
    SELECT id, txn_date, txn_time, counterparty, narration, withdrawal, category
    FROM transactions
    WHERE withdrawal IS NOT NULL
      AND withdrawal >= 500
      AND (shared_with IS NULL OR shared_with = '')
      AND category IS NOT NULL
      AND (
        category LIKE 'Food:%'
        OR category LIKE 'Travel:%'
        OR category LIKE 'Entertainment:%'
        OR category = 'Food:Quick Commerce'
      )
    ORDER BY withdrawal DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    txnDate: r.txn_date,
    txnTime: r.txn_time,
    counterparty: r.counterparty,
    narration: r.narration,
    amount: Number(r.withdrawal),
    category: r.category,
    hint: hintFor(r.category, Number(r.withdrawal)),
  }));
}

function hintFor(category: string | null, amount: number): string {
  if (!category) return "splittable";
  if (category.startsWith("Travel:")) return amount >= 5000 ? "trip-cost" : "transport";
  if (category.startsWith("Food:Quick Commerce")) return "groceries";
  if (category.startsWith("Food:")) return amount >= 1500 ? "group-meal" : "food";
  if (category.startsWith("Entertainment:")) return "outing";
  return "splittable";
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
  /**
   * Item-level breakdown from a Swiggy / Zomato receipt email, when this
   * transaction has one. Surfaced by the `enrich-items` CLI; null otherwise.
   */
  items?: ItemEnrichment | null;
}

/**
 * Shape of a Swiggy / Zomato item-enrichment block. Mirrors the
 * `transaction_sources.raw_json` payload that the email backfill writes,
 * narrowed to just the fields the UI cares about.
 */
export interface ItemEnrichment {
  /** Which extractor produced this — "swiggy" | "zomato". */
  extractorId: string;
  /** Order kind: "food_delivery" | "instamart" | "zomato_delivery" | "zomato_dining". */
  kind: string;
  /** Order id when known. */
  orderId: string | null;
  /** Restaurant or store name. */
  restaurant: string | null;
  /** Order total — usually within a rupee of the canonical withdrawal. */
  amount: number;
  /** Line items. Price is only present for Swiggy; Zomato emails don't break it down per line. */
  items: Array<{ qty: number; name: string; price?: number }>;
  /** One-line summary the extractor produced. */
  summary: string;
}

/**
 * Parse the raw_json blob written by an enrichment source (Swiggy / Zomato
 * email, or Zepto invoice PDF) back into the UI-facing ItemEnrichment
 * shape. Returns null when the blob doesn't look like one of ours.
 *
 * The source_type tells us which shape to expect:
 *   - swiggy_email / zomato_email → blob has {extractorId, kind, restaurant,
 *     orderId, amount, items[{qty, name, price?}], summary}
 *   - zepto_invoice → blob has {orderNo, invoiceNo, date, amount,
 *     items[{seq, name, qty, amount}]}
 */
function parseItemEnrichment(
  rawJson: string | null,
  sourceType: string,
): ItemEnrichment | null {
  if (!rawJson) return null;
  try {
    const obj = JSON.parse(rawJson) as Record<string, unknown>;
    if (sourceType === "zepto_invoice") {
      const items = Array.isArray(obj.items)
        ? (obj.items as Array<Record<string, unknown>>)
            .map((it) => ({
              qty: Number(it.qty ?? 1),
              name: String(it.name ?? ""),
              // The invoice's per-line `amount` IS the line total in INR.
              // The UI's ItemEnrichment uses `price` for the same notion.
              price: it.amount != null ? Number(it.amount) : undefined,
            }))
            .filter((it) => it.name.length > 0)
        : [];
      return {
        extractorId: "zepto_invoice",
        kind: "instamart", // closest analogue in the existing icon set
        orderId: obj.orderNo != null ? String(obj.orderNo) : null,
        restaurant: null,
        amount: Number(obj.amount ?? 0),
        items,
        summary: `Zepto order — ${items.length} item${items.length === 1 ? "" : "s"}`,
      };
    }
    // Email-receipt shape (swiggy_email / zomato_email)
    const items = Array.isArray(obj.items)
      ? (obj.items as Array<Record<string, unknown>>)
          .map((it) => ({
            qty: Number(it.qty ?? 1),
            name: String(it.name ?? ""),
            price: it.price != null ? Number(it.price) : undefined,
          }))
          .filter((it) => it.name.length > 0)
      : [];
    return {
      extractorId: String(obj.extractorId ?? ""),
      kind: String(obj.kind ?? ""),
      orderId: obj.orderId != null ? String(obj.orderId) : null,
      restaurant: obj.restaurant != null ? String(obj.restaurant) : null,
      amount: Number(obj.amount ?? 0),
      items,
      summary: String(obj.summary ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Pull email-derived item enrichment (if any) for every txn id in `ids`.
 * Returns a map for cheap join-in-memory by the caller. Empty map when
 * no rows match — never null.
 *
 * Picks one enrichment per txn even if multiple exist (Swiggy AND Zomato
 * matched somehow): the one with the lowest source row id, which is the
 * first to be ingested. In practice each txn has at most one.
 */
function getItemEnrichmentsForTxns(ids: number[]): Map<number, ItemEnrichment> {
  const out = new Map<number, ItemEnrichment>();
  if (ids.length === 0) return out;
  const rows = db().all<{
    transaction_id: number;
    source_type: string;
    raw_json: string;
  }>(sql`
    SELECT transaction_id, source_type, raw_json
    FROM transaction_sources
    WHERE source_type IN ('swiggy_email', 'zomato_email', 'zepto_invoice')
      AND transaction_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id ASC
  `);
  for (const r of rows) {
    if (out.has(r.transaction_id)) continue;
    const parsed = parseItemEnrichment(r.raw_json, r.source_type);
    if (parsed) out.set(r.transaction_id, parsed);
  }
  return out;
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
  const itemMap = getItemEnrichmentsForTxns(rows.map((r) => r.id));
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
    items: itemMap.get(r.id) ?? null,
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

// ============================================================================
// Merchant detail — two flavours
// ============================================================================
//
// The Merchant Detail surface backs two visual registers (see
// `docs/design/merchant-detail.md`):
//
//   - BUSINESS — keyed by `counterparty` (e.g. "Zepto"). Job is trend &
//     cleanup. KPI strip + 12-month bar chart + grouped txn list.
//   - PERSON   — keyed by `person_id` (e.g. "rahul-k"). Job is balance &
//     settle. Big balance hero + two-column ledger.
//
// Both pages need a 12-month bucket of activity so the page can recompute
// when the user scrubs the timeline window client-side. The trailing axis
// is anchored on the latest transaction in the entire ledger (not just
// the merchant's) so the "Sep '25" anchor is stable across merchants — it
// matches what the user just saw on the dashboard.

/** Last 12 calendar months keyed by 'YYYY-MM', oldest → newest. */
export interface MerchantMonthAxis {
  /** YYYY-MM */
  ym: string;
  /** Short month label, e.g. "Oct". */
  m: string;
  /** Two-digit year, e.g. 24 (for 2024). */
  y: number;
}

/** Build the 12-month axis anchored on the latest transaction in the DB. */
function buildMonthAxis(): MerchantMonthAxis[] {
  const row = db().get<{ latest: string | null }>(
    sql`SELECT max(txn_date) AS latest FROM transactions`,
  );
  const latest = row?.latest;
  // Anchor on the latest txn date (fall back to today if the DB is empty).
  const anchor = latest
    ? new Date(latest + "T00:00:00Z")
    : new Date();
  // Start at the first day of the anchor month, then walk back 11 months.
  const months: MerchantMonthAxis[] = [];
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - offset, 1));
    const year = d.getUTCFullYear();
    const monthIdx = d.getUTCMonth();
    months.push({
      ym: `${year}-${String(monthIdx + 1).padStart(2, "0")}`,
      m: monthLabels[monthIdx]!,
      y: year % 100,
    });
  }
  return months;
}

/** Per-month rollup for a single business merchant. */
export interface MerchantBusinessMonth extends MerchantMonthAxis {
  /** Total outflow this month at this merchant (positive rupees). */
  v: number;
  /** Transaction count this month. */
  n: number;
}

/** Per-month rollup for a single person counterparty. */
export interface MerchantPersonMonth extends MerchantMonthAxis {
  /** Negative — you paid them this month. */
  d: number;
  /** Positive — they paid you this month. */
  c: number;
}

/** One business txn row, denormalized for the merchant detail timeline. */
export interface MerchantBusinessTxn {
  id: number;
  txnDate: string;
  txnTime: string | null;
  /** Cleaned narration the UI shows on the top line (falls back to raw). */
  narration: string;
  /** Original bank narration kept around so the user can still see the noise. */
  rawNarration: string | null;
  category: string | null;
  /** Negative — amount paid out (rupees). */
  amount: number;
  account: string;
}

/** One person ledger row, denormalized for the two-column merchant view. */
export interface MerchantPersonTxn {
  id: number;
  txnDate: string;
  txnTime: string | null;
  /** Display note (cleaned). */
  note: string;
  /** Optional one-line subtitle (raw narration, share hint, etc.). */
  sub: string | null;
  /** Negative = you paid them; positive = they paid you. */
  amount: number;
  /** Index in the 12-month axis (0..11), so the client can filter by range. */
  monthIdx: number;
  /** Inline tag — pulled from category group (Rent / Bills / etc). */
  tag: string | null;
  /** True when the amount is unusually large vs the person's median txn. */
  hot: boolean;
}

export interface MerchantBusinessDetail {
  kind: "business";
  /** Counterparty key — also the page slug. */
  counterparty: string;
  /** Pretty merchant name (same as counterparty for now). */
  displayName: string;
  /** Top category for this merchant — drives "your other X" sibling card. */
  topCategory: string | null;
  /** Convenient shorthand for the icon — first letter, uppercased. */
  initials: string;
  /** First/last txn dates for the merchant — anchors the "since" copy. */
  firstSeen: string;
  lastSeen: string;
  /** Lifetime aggregates across the whole ledger. */
  lifetimeSum: number;
  lifetimeCount: number;
  /** 12 trailing months, oldest → newest. */
  months: MerchantBusinessMonth[];
  /** All txns for the merchant, newest → oldest. */
  txns: MerchantBusinessTxn[];
  /** Sibling merchants in the same top-level category (e.g. other groceries). */
  siblings: Array<{
    counterparty: string;
    displayName: string;
    initials: string;
    sum: number;
    count: number;
  }>;
}

export interface MerchantPersonDetail {
  kind: "person";
  /** person_id — also the page slug. */
  personId: string;
  displayName: string;
  relationship: string;
  initials: string;
  /** First/last txn dates with this person. */
  firstSeen: string;
  lastSeen: string;
  /** UPI handle most commonly observed for this person (best-effort). */
  upi: string | null;
  /** Lifetime totals. */
  lifetimeOut: number;
  lifetimeIn: number;
  /** 12 trailing months — oldest → newest. */
  months: MerchantPersonMonth[];
  /** Outgoing rows (you → them), newest → oldest. */
  debits: MerchantPersonTxn[];
  /** Incoming rows (them → you), newest → oldest. */
  credits: MerchantPersonTxn[];
  /** Other people you have transacted with via this person (shared groups). */
  groups: Array<{
    id: string;
    title: string;
    members: string[];
    splits: number;
  }>;
}

function categoryGroup(c: string | null): string {
  if (!c) return "Other";
  const parts = c.split(":");
  return parts[0] ?? c;
}

/** Map a category to a short inline ledger tag (Rent / Bills / Trip / …). */
function tagForCategory(c: string | null, note: string): string | null {
  const n = note.toLowerCase();
  if (n.includes("rent")) return "Rent";
  if (n.includes("trip") || n.includes("manali") || n.includes("goa")) return "Trip";
  if (!c) return null;
  if (c.startsWith("Utilities:")) return "Bills";
  if (c.startsWith("Housing:")) return "Rent";
  if (c.startsWith("Travel:")) return "Trip";
  if (c.startsWith("Food:")) return "Food";
  return null;
}

/** Clean a bank narration into a short display label. */
function cleanNarration(raw: string | null, counterparty: string | null): string {
  if (counterparty && counterparty.trim().length > 0) {
    // Prefer the merchant name + a stripped trailing ref if the raw has one.
    const refMatch = raw?.match(/\b(\d{6,})\b/);
    return refMatch ? `UPI · order #${refMatch[1]}` : `UPI · ${counterparty}`;
  }
  return (raw ?? "—").replace(/\s+/g, " ").trim();
}

export async function getMerchantBusinessDetail(
  counterparty: string,
): Promise<MerchantBusinessDetail | null> {
  // Counterparty is user-supplied; this is a SELECT so Drizzle parameterizes
  // it safely, but a length guard avoids absurd payloads.
  if (!counterparty || counterparty.length > 200) return null;

  const summary = db().get<{
    n: number;
    total_out: number | null;
    first: string | null;
    last: string | null;
    top_cat: string | null;
  }>(sql`
    SELECT
      count(*)                                 AS n,
      coalesce(sum(withdrawal), 0)             AS total_out,
      min(txn_date)                            AS first,
      max(txn_date)                            AS last,
      (SELECT category FROM transactions
        WHERE counterparty = ${counterparty} AND category IS NOT NULL
        GROUP BY category
        ORDER BY count(*) DESC LIMIT 1)        AS top_cat
    FROM transactions
    WHERE counterparty = ${counterparty}
  `);
  if (!summary || summary.n === 0 || !summary.first || !summary.last) {
    return null;
  }

  const monthAxis = buildMonthAxis();
  const monthRows = db().all<{ ym: string; n: number; total_out: number | null }>(sql`
    SELECT strftime('%Y-%m', txn_date) AS ym,
           count(*) AS n,
           coalesce(sum(withdrawal), 0) AS total_out
    FROM transactions
    WHERE counterparty = ${counterparty}
    GROUP BY ym
  `);
  const byYm = new Map(monthRows.map((r) => [r.ym, r]));
  const months: MerchantBusinessMonth[] = monthAxis.map((mo) => {
    const hit = byYm.get(mo.ym);
    return {
      ...mo,
      v: Math.round(Number(hit?.total_out ?? 0)),
      n: hit?.n ?? 0,
    };
  });

  const txnRows = db().all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    narration: string | null;
    category: string | null;
    withdrawal: number | null;
    bank: string;
    type: string;
    last4: string;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.narration, t.category, t.withdrawal,
           a.bank, a.type, a.last4
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.counterparty = ${counterparty}
      AND t.withdrawal IS NOT NULL
    ORDER BY t.txn_date DESC, coalesce(t.txn_time, '00:00') DESC, t.id DESC
  `);
  const txns: MerchantBusinessTxn[] = txnRows.map((r) => ({
    id: r.id,
    txnDate: r.txn_date,
    txnTime: r.txn_time,
    narration: cleanNarration(r.narration, counterparty),
    rawNarration: r.narration,
    category: r.category,
    amount: -Math.round(Number(r.withdrawal ?? 0)),
    account: `${r.bank} ···${r.last4}`,
  }));

  // Siblings — other counterparties in the same top-level category bucket,
  // keyed off lifetime spend. Cheap because the OOM is in the dozens.
  let siblings: MerchantBusinessDetail["siblings"] = [];
  if (summary.top_cat) {
    const group = categoryGroup(summary.top_cat);
    const sibRows = db().all<{
      counterparty: string;
      sum: number | null;
      n: number;
    }>(sql`
      SELECT counterparty,
             coalesce(sum(withdrawal), 0) AS sum,
             count(*) AS n
      FROM transactions
      WHERE counterparty IS NOT NULL
        AND counterparty != ${counterparty}
        AND category IS NOT NULL
        AND category LIKE ${group + ":%"}
        AND withdrawal IS NOT NULL
      GROUP BY counterparty
      ORDER BY sum DESC
      LIMIT 5
    `);
    siblings = sibRows.map((r) => ({
      counterparty: r.counterparty,
      displayName: r.counterparty,
      initials: (r.counterparty[0] ?? "·").toUpperCase(),
      sum: Math.round(Number(r.sum ?? 0)),
      count: r.n,
    }));
  }

  return {
    kind: "business",
    counterparty,
    displayName: counterparty,
    topCategory: summary.top_cat,
    initials: (counterparty[0] ?? "·").toUpperCase(),
    firstSeen: summary.first,
    lastSeen: summary.last,
    lifetimeSum: Math.round(Number(summary.total_out ?? 0)),
    lifetimeCount: summary.n,
    months,
    txns,
    siblings,
  };
}

export async function getMerchantPersonDetail(
  personId: string,
): Promise<MerchantPersonDetail | null> {
  if (!/^[a-z][a-z0-9-]*$/i.test(personId)) return null;

  const person = DEFAULT_PEOPLE.find((p) => p.id === personId);
  if (!person) return null;

  const summary = db().get<{
    n: number;
    out: number | null;
    in_: number | null;
    first: string | null;
    last: string | null;
    upi: string | null;
  }>(sql`
    SELECT
      count(*)                          AS n,
      coalesce(sum(withdrawal), 0)      AS "out",
      coalesce(sum(deposit), 0)         AS "in_",
      min(txn_date)                     AS first,
      max(txn_date)                     AS last,
      (SELECT counterparty FROM transactions
        WHERE person_id = ${personId} AND counterparty_kind = 'vpa'
        GROUP BY counterparty
        ORDER BY count(*) DESC LIMIT 1) AS upi
    FROM transactions
    WHERE person_id = ${personId}
  `);
  if (!summary || summary.n === 0 || !summary.first || !summary.last) {
    return null;
  }

  const monthAxis = buildMonthAxis();
  const monthRows = db().all<{ ym: string; d: number | null; c: number | null }>(sql`
    SELECT strftime('%Y-%m', txn_date) AS ym,
           coalesce(sum(withdrawal), 0) AS d,
           coalesce(sum(deposit), 0)    AS c
    FROM transactions
    WHERE person_id = ${personId}
    GROUP BY ym
  `);
  const byYm = new Map(monthRows.map((r) => [r.ym, r]));
  const months: MerchantPersonMonth[] = monthAxis.map((mo) => {
    const hit = byYm.get(mo.ym);
    return {
      ...mo,
      d: -Math.round(Number(hit?.d ?? 0)),
      c: Math.round(Number(hit?.c ?? 0)),
    };
  });
  const ymToIdx = new Map(monthAxis.map((mo, i) => [mo.ym, i]));

  const txnRows = db().all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    narration: string | null;
    category: string | null;
    withdrawal: number | null;
    deposit: number | null;
  }>(sql`
    SELECT id, txn_date, txn_time, narration, category, withdrawal, deposit
    FROM transactions
    WHERE person_id = ${personId}
    ORDER BY txn_date DESC, coalesce(txn_time, '00:00') DESC, id DESC
  `);

  // Hot threshold — anything ≥ 3× the median outgoing magnitude.
  const outgoingMags = txnRows
    .map((r) => Number(r.withdrawal ?? 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const median = outgoingMags.length === 0
    ? 0
    : outgoingMags[Math.floor(outgoingMags.length / 2)]!;
  const hotThreshold = median > 0 ? median * 3 : Number.POSITIVE_INFINITY;

  const debits: MerchantPersonTxn[] = [];
  const credits: MerchantPersonTxn[] = [];
  for (const r of txnRows) {
    const idx = ymToIdx.get(r.txn_date.slice(0, 7)) ?? -1;
    const note = cleanNarration(r.narration, person.displayName);
    if (r.withdrawal != null && r.withdrawal > 0) {
      debits.push({
        id: r.id,
        txnDate: r.txn_date,
        txnTime: r.txn_time,
        note,
        sub: r.narration && r.narration !== note ? r.narration : null,
        amount: -Math.round(Number(r.withdrawal)),
        monthIdx: idx,
        tag: tagForCategory(r.category, r.narration ?? ""),
        hot: Number(r.withdrawal) >= hotThreshold,
      });
    } else if (r.deposit != null && r.deposit > 0) {
      credits.push({
        id: r.id,
        txnDate: r.txn_date,
        txnTime: r.txn_time,
        note,
        sub: r.narration && r.narration !== note ? r.narration : null,
        amount: Math.round(Number(r.deposit)),
        monthIdx: idx,
        tag: tagForCategory(r.category, r.narration ?? ""),
        hot: false,
      });
    }
  }

  // Shared groups — derived from the shared_with CSV. Each unique set of
  // co-participants (including this person) becomes one "group".
  const sharedRows = db().all<{ shared_with: string; n: number }>(sql`
    SELECT shared_with, count(*) AS n
    FROM transactions
    WHERE shared_with IS NOT NULL
      AND shared_with != ''
      AND shared_with LIKE ${"%" + personId + "%"}
    GROUP BY shared_with
    ORDER BY n DESC
    LIMIT 4
  `);
  const groups: MerchantPersonDetail["groups"] = sharedRows
    .map((r) => {
      const ids = r.shared_with.split(",").map((s) => s.trim()).filter(Boolean);
      if (!ids.includes(personId)) return null;
      const members = ids.map((id) => {
        if (id === personId) return person.displayName;
        const p = DEFAULT_PEOPLE.find((q) => q.id === id);
        return p?.displayName ?? id;
      });
      return {
        id: ids.slice().sort().join("+"),
        title: members.slice(0, 3).join(" · ") + (members.length > 3 ? "…" : ""),
        members,
        splits: r.n,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  return {
    kind: "person",
    personId,
    displayName: person.displayName,
    relationship: person.relationship,
    initials: person.displayName
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase(),
    firstSeen: summary.first,
    lastSeen: summary.last,
    upi: summary.upi,
    lifetimeOut: Math.round(Number(summary.out ?? 0)),
    lifetimeIn: Math.round(Number(summary.in_ ?? 0)),
    months,
    debits,
    credits,
    groups,
  };
}

/**
 * Best-effort resolver for the /merchants/[id] route. Tries person_id first
 * (it's the narrow alphanumeric form), then falls back to a counterparty
 * lookup. Returns null when nothing matches so the route can 404.
 */
export async function resolveMerchant(
  id: string,
): Promise<MerchantBusinessDetail | MerchantPersonDetail | null> {
  if (/^[a-z][a-z0-9-]*$/i.test(id)) {
    const person = await getMerchantPersonDetail(id);
    if (person) return person;
  }
  return getMerchantBusinessDetail(id);
}
