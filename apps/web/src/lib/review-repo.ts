/**
 * Repo functions for the `/review` page — the dedicated form-driven review
 * surface. Lives in its own module to keep the main repo.ts focused; the
 * queries here all carry the cost of a per-transaction join against
 * transaction_sources, which is overkill for the dashboard's bulk lists.
 *
 * Three primary callers:
 *   - listTransactionsForReview  → sidebar list (filtered, paginated)
 *   - getTransactionForReview    → main panel (everything about one row)
 *   - getReviewFilterMeta        → filter dropdown options (categories etc.)
 */
import "server-only";
import { sql } from "drizzle-orm";
import { openDb } from "@splitlens/db";
import {
  summarizeMerchant,
  getPriceHint,
  isOnlineMerchant,
  istLocalToUtcMs,
  matchLocation,
  type MerchantHistory,
  type MerchantTxnLite,
  type HintConfidence,
  type LocationCandidate,
  type LocationMatch,
} from "@splitlens/core";
import { extractCounterpartyFromNarration } from "./narration";
import { deriveSelection, MONTH_SHORT } from "./review-time";

let _db: ReturnType<typeof openDb> | null = null;
function db() {
  if (!_db) _db = openDb();
  return _db;
}

// ============================================================================
// Filter + list — sidebar
// ============================================================================

export interface ReviewListFilter {
  /** ISO YYYY-MM-DD lower bound, inclusive. */
  from?: string | null;
  /** ISO YYYY-MM-DD upper bound, inclusive. */
  to?: string | null;
  /** Exact category match. Null/undefined = any. */
  category?: string | null;
  /** When true, exclude rows where reviewed=1. */
  unreviewedOnly?: boolean;
  /** Match transactions linked to this person id. */
  personId?: string | null;
  /** Match transactions on this account. */
  accountId?: number | null;
  /** Free-text search over counterparty + narration (case-insensitive). */
  q?: string | null;
  /** Page size for the sidebar. Default 200; max 500. */
  limit?: number;
  /** Pagination offset. */
  offset?: number;
  /**
   * Sort order in the sidebar list.
   *   - "desc" (default) — newest first (the dashboard convention)
   *   - "asc"            — oldest first, useful for chronological review
   *   - null / undefined — falls back to "desc"
   */
  sort?: "asc" | "desc" | null;
  /**
   * Time-of-day bucket: "morning" (06-12), "afternoon" (12-17),
   * "evening" (17-21), "night" (21-06). Filters rows by `txn_time`.
   * Null/undefined = any time. Rows with NULL `txn_time` are excluded when
   * a bucket is set.
   */
  timeOfDay?: "morning" | "afternoon" | "evening" | "night" | null;
  /**
   * Personal vs shared filter. Drives the donut click on the at-a-glance
   * panel. 'personal' → share_count = 1; 'shared' → share_count > 1.
   */
  shareStatus?: "personal" | "shared" | null;
  /**
   * Coarse recurrence class. 'one_time' matches NULL + 'one_time' rows;
   * 'recurring' matches any non-NULL recurrence other than 'one_time'.
   * Granular recurrence filter (e.g. only Monthly) lives elsewhere in
   * future — this is the donut-click filter.
   */
  recurrenceClass?: "one_time" | "recurring" | null;
}

export interface ReviewListRow {
  id: number;
  txnDate: string;
  txnTime: string | null;
  /** Positive amount; use direction to decide sign. */
  amount: number;
  direction: "debit" | "credit";
  counterparty: string | null;
  narration: string | null;
  category: string | null;
  reviewed: boolean;
  /** 0/1/2+ — how many extractors have observed this row. */
  sourceCount: number;
  /** True if at least one source is a bill/invoice/receipt (zepto_invoice / swiggy_email / zomato_email / *_ocr). */
  hasReceipt: boolean;
}

export interface ReviewListResult {
  rows: ReviewListRow[];
  /** Total rows matching the filter (ignoring limit/offset). */
  totalMatching: number;
  /** Of `totalMatching`, how many are not reviewed yet. */
  totalUnreviewed: number;
  /** Overall ledger size — handy for the progress bar (% reviewed). */
  ledgerTotal: number;
  ledgerReviewed: number;
  /**
   * Sum of `withdrawal` across the whole filter (NOT just `rows`). The
   * row list is capped at `limit`, so callers must use these for any
   * "total outflow / inflow" headline. The TimelineSummaryHero counters
   * read directly from here.
   */
  totalDebit: number;
  /** Sum of `deposit` across the whole filter. */
  totalCredit: number;
  /**
   * Pre-bucketed chart data for the TimelineSummaryHero, aggregated
   * across the WHOLE filter (not capped). Granularity is derived from
   * the date range:
   *   from == to            →  hour-of-day buckets (00..23)
   *   same year & month     →  day-of-month buckets (1..lastDay)
   *   same year             →  month buckets (Jan..Dec of that year)
   *   else / no date filter →  recent year-month buckets (≤ 24)
   */
  chartBuckets: ChartBucket[];
  /** Tells the client how to label/render the X-axis. */
  chartGranularity: "hour" | "day" | "month" | "yearmonth";
  /**
   * "At a glance" section for the main /review page. Populated only when
   * the filter resolves to a single calendar month — i.e. when the user
   * has drilled into one month via the time navigator. Null at all other
   * zoom levels (the page hides the section then).
   */
  monthDimensions: {
    monthKey: string;
    aggregates: MonthDimensionAggregates;
    categories: MonthCategoryRow[];
  } | null;
}

export interface ChartBucket {
  /** Stable key — matches the format expected by the granularity. */
  key: string;
  /** Display label under the bar. */
  label: string;
  debit: number;
  credit: number;
  count: number;
}

/**
 * The sidebar's data source. Composable filters, fast (single SQL + 1 count
 * query). `hasReceipt` is computed inline rather than via a sub-query in
 * each row because SQLite's planner handles a single EXISTS join cheaper.
 */
export async function listTransactionsForReview(
  filter: ReviewListFilter = {},
): Promise<ReviewListResult> {
  const limit = Math.min(filter.limit ?? 200, 500);
  const offset = Math.max(filter.offset ?? 0, 0);

  // SQL fragments — built compositionally so empty filters become no-ops.
  const where: ReturnType<typeof sql>[] = [];
  if (filter.from) where.push(sql`t.txn_date >= ${filter.from}`);
  if (filter.to) where.push(sql`t.txn_date <= ${filter.to}`);
  if (filter.category) where.push(sql`t.category = ${filter.category}`);
  if (filter.unreviewedOnly) where.push(sql`t.reviewed = 0`);
  if (filter.personId) where.push(sql`t.person_id = ${filter.personId}`);
  if (filter.accountId != null) where.push(sql`t.account_id = ${filter.accountId}`);
  if (filter.shareStatus === "personal") {
    where.push(sql`(t.share_count IS NULL OR t.share_count = 1)`);
  } else if (filter.shareStatus === "shared") {
    where.push(sql`t.share_count > 1`);
  }
  if (filter.recurrenceClass === "one_time") {
    where.push(sql`(t.recurrence IS NULL OR t.recurrence = 'one_time')`);
  } else if (filter.recurrenceClass === "recurring") {
    where.push(sql`t.recurrence IS NOT NULL AND t.recurrence != 'one_time'`);
  }
  if (filter.q && filter.q.trim()) {
    const needle = `%${filter.q.trim().toLowerCase()}%`;
    where.push(sql`(LOWER(coalesce(t.counterparty,'')) LIKE ${needle} OR LOWER(coalesce(t.narration,'')) LIKE ${needle})`);
  }
  if (filter.timeOfDay) {
    // SQLite's lexicographic comparison works on HH:MM strings since they're
    // fixed-width. "Night" wraps midnight, so it's a UNION of two windows.
    if (filter.timeOfDay === "morning") {
      where.push(sql`t.txn_time IS NOT NULL AND t.txn_time >= '06:00' AND t.txn_time < '12:00'`);
    } else if (filter.timeOfDay === "afternoon") {
      where.push(sql`t.txn_time IS NOT NULL AND t.txn_time >= '12:00' AND t.txn_time < '17:00'`);
    } else if (filter.timeOfDay === "evening") {
      where.push(sql`t.txn_time IS NOT NULL AND t.txn_time >= '17:00' AND t.txn_time < '21:00'`);
    } else if (filter.timeOfDay === "night") {
      where.push(sql`t.txn_time IS NOT NULL AND (t.txn_time >= '21:00' OR t.txn_time < '06:00')`);
    }
  }
  const whereSql =
    where.length === 0
      ? sql``
      : sql`WHERE ${sql.join(where, sql` AND `)}`;

  const orderSql =
    filter.sort === "asc"
      ? sql`ORDER BY t.txn_date ASC, coalesce(t.txn_time, '00:00') ASC, t.id ASC`
      : sql`ORDER BY t.txn_date DESC, coalesce(t.txn_time, '00:00') DESC, t.id DESC`;

  const rows = db().all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    withdrawal: number | null;
    deposit: number | null;
    counterparty: string | null;
    narration: string | null;
    category: string | null;
    reviewed: number;
    source_count: number;
    has_receipt: number;
  }>(sql`
    SELECT t.id, t.txn_date, t.txn_time, t.withdrawal, t.deposit,
           t.counterparty, t.narration, t.category, t.reviewed,
           (SELECT count(DISTINCT source_type) FROM transaction_sources WHERE transaction_id = t.id) AS source_count,
           EXISTS (
             SELECT 1 FROM transaction_sources s
             WHERE s.transaction_id = t.id
               AND s.source_type IN ('zepto_invoice', 'swiggy_email', 'zomato_email',
                                     'zepto_ocr', 'blinkit_ocr', 'instamart_ocr')
           ) AS has_receipt
    FROM transactions t
    ${whereSql}
    ${orderSql}
    LIMIT ${limit} OFFSET ${offset}
  `);

  const totals = db().get<{ total: number; unreviewed: number }>(sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE t.reviewed = 0) AS unreviewed
    FROM transactions t
    ${whereSql}
  `);

  const ledger = db().get<{ total: number; reviewed: number }>(sql`
    SELECT count(*) AS total, count(*) FILTER (WHERE reviewed = 1) AS reviewed
    FROM transactions
  `);

  // Server-side totals across the whole filter (not capped by the row
  // limit). Without this the TimelineSummaryHero counters were summing
  // the truncated row window, so a year with 1,342 txns capped at 200
  // would show a tiny inflow.
  const sums = db().get<{ debit: number; credit: number }>(sql`
    SELECT
      COALESCE(SUM(t.withdrawal), 0) AS debit,
      COALESCE(SUM(t.deposit), 0) AS credit
    FROM transactions t
    ${whereSql}
  `);

  // Granularity-aware chart bucketing. Same logic that the old client-side
  // hook used, but here we have access to the full filter rather than the
  // 200-row slice.
  const { chartBuckets, chartGranularity } = computeChartBuckets(
    filter,
    whereSql,
  );

  // "At a glance" panel — populated only when the filter resolves to a
  // single calendar month. We detect that via the same granularity check
  // the chart uses, then run the same aggregate queries we used to run
  // per-txn (now hoisted to the list level so the panel can live on the
  // main page instead of inside the txn drawer).
  const monthDimensions =
    chartGranularity === "day" && filter.from && filter.to
      ? computeMonthDimensions(filter.from, filter.to)
      : null;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      txnDate: r.txn_date,
      txnTime: r.txn_time,
      amount: r.withdrawal ?? r.deposit ?? 0,
      direction: r.withdrawal != null ? ("debit" as const) : ("credit" as const),
      counterparty: r.counterparty,
      narration: r.narration,
      category: r.category,
      reviewed: Boolean(r.reviewed),
      sourceCount: r.source_count,
      hasReceipt: Boolean(r.has_receipt),
    })),
    totalMatching: totals?.total ?? 0,
    totalUnreviewed: totals?.unreviewed ?? 0,
    ledgerTotal: ledger?.total ?? 0,
    ledgerReviewed: ledger?.reviewed ?? 0,
    totalDebit: sums?.debit ?? 0,
    totalCredit: sums?.credit ?? 0,
    chartBuckets,
    chartGranularity,
    monthDimensions,
  };
}

/**
 * Compute the personal/shared, one-time/recurring, and top-categories
 * aggregates for the calendar month bounded by [monthFrom, monthTo]. Used
 * by the main /review page's "at a glance" panel when the user is viewing
 * a single month.
 */
function computeMonthDimensions(
  monthFrom: string,
  monthTo: string,
): NonNullable<ReviewListResult["monthDimensions"]> {
  const monthKey = monthFrom.slice(0, 7);

  const aggRow = db().get<{
    total: number;
    shared: number;
    recurring: number;
  }>(sql`
    SELECT
      COALESCE(SUM(withdrawal), 0) AS total,
      COALESCE(SUM(CASE WHEN share_count > 1 THEN withdrawal ELSE 0 END), 0) AS shared,
      COALESCE(SUM(CASE WHEN recurrence IS NOT NULL AND recurrence != 'one_time' THEN withdrawal ELSE 0 END), 0) AS recurring
    FROM transactions
    WHERE txn_date >= ${monthFrom}
      AND txn_date <= ${monthTo}
      AND withdrawal IS NOT NULL
      AND withdrawal > 0
  `);
  const aggregates: MonthDimensionAggregates = {
    total: aggRow?.total ?? 0,
    personal: (aggRow?.total ?? 0) - (aggRow?.shared ?? 0),
    shared: aggRow?.shared ?? 0,
    oneTime: (aggRow?.total ?? 0) - (aggRow?.recurring ?? 0),
    recurring: aggRow?.recurring ?? 0,
  };

  const catRows = db().all<{ category: string | null; debit: number; n: number }>(sql`
    SELECT
      category,
      COALESCE(SUM(withdrawal), 0) AS debit,
      COUNT(*) AS n
    FROM transactions
    WHERE txn_date >= ${monthFrom}
      AND txn_date <= ${monthTo}
      AND withdrawal IS NOT NULL
      AND withdrawal > 0
    GROUP BY category
    ORDER BY debit DESC
  `);
  const categories: MonthCategoryRow[] = catRows.map((r) => ({
    category: r.category,
    debit: r.debit,
    count: r.n,
  }));

  return { monthKey, aggregates, categories };
}

// ============================================================================
// Chart bucket computation — granularity is derived from `from` and `to`.
// One SUM/COUNT/GROUP BY query per chart. Returns an axis with every bucket
// materialized (including zero-debit ones) so the X-axis is continuous.
// ============================================================================

function granularityOf(filter: ReviewListFilter): ReviewListResult["chartGranularity"] {
  const { from, to } = filter;
  if (from && to && from === to) return "hour";
  if (from && to) {
    if (from.slice(0, 7) === to.slice(0, 7)) return "day";
    if (from.slice(0, 4) === to.slice(0, 4)) return "month";
  }
  return "yearmonth";
}

function computeChartBuckets(
  filter: ReviewListFilter,
  whereSql: ReturnType<typeof sql>,
): { chartBuckets: ChartBucket[]; chartGranularity: ReviewListResult["chartGranularity"] } {
  const gran = granularityOf(filter);

  // Bucket expression for SQLite. txn_time is "HH:MM" so we take the first
  // two chars for hour-of-day. txn_date is "YYYY-MM-DD".
  let bucketExpr: ReturnType<typeof sql>;
  if (gran === "hour") bucketExpr = sql`substr(t.txn_time, 1, 2)`;
  else if (gran === "day") bucketExpr = sql`substr(t.txn_date, 9, 2)`;
  else if (gran === "month") bucketExpr = sql`substr(t.txn_date, 6, 2)`;
  else bucketExpr = sql`substr(t.txn_date, 1, 7)`;

  const aggRows = db().all<{
    bucket: string | null;
    debit: number;
    credit: number;
    n: number;
  }>(sql`
    SELECT
      ${bucketExpr} AS bucket,
      COALESCE(SUM(t.withdrawal), 0) AS debit,
      COALESCE(SUM(t.deposit), 0) AS credit,
      COUNT(*) AS n
    FROM transactions t
    ${whereSql}
    GROUP BY bucket
  `);
  const byBucket = new Map<string, { debit: number; credit: number; n: number }>();
  for (const r of aggRows) {
    if (r.bucket == null) continue;
    byBucket.set(r.bucket, { debit: r.debit, credit: r.credit, n: r.n });
  }

  const out: ChartBucket[] = [];

  if (gran === "hour") {
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, "0");
      const v = byBucket.get(key);
      out.push({
        key: `h-${key}`,
        label: key,
        debit: v?.debit ?? 0,
        credit: v?.credit ?? 0,
        count: v?.n ?? 0,
      });
    }
  } else if (gran === "day") {
    const [yy, mm] = (filter.from ?? "").split("-").map(Number);
    const lastDay = yy && mm ? new Date(Date.UTC(yy, mm, 0)).getUTCDate() : 31;
    for (let d = 1; d <= lastDay; d++) {
      const key = String(d).padStart(2, "0");
      const v = byBucket.get(key);
      out.push({
        key: `d-${key}`,
        label: String(d),
        debit: v?.debit ?? 0,
        credit: v?.credit ?? 0,
        count: v?.n ?? 0,
      });
    }
  } else if (gran === "month") {
    for (let m = 1; m <= 12; m++) {
      const key = String(m).padStart(2, "0");
      const v = byBucket.get(key);
      out.push({
        key: `m-${key}`,
        label: MONTH_SHORT[m - 1]!,
        debit: v?.debit ?? 0,
        credit: v?.credit ?? 0,
        count: v?.n ?? 0,
      });
    }
  } else {
    // yearmonth — pick the most recent 12 months that have data; if there's
    // a date range, use it; otherwise use the natural data range.
    const allKeys = Array.from(byBucket.keys()).sort();
    const lastKeys = allKeys.slice(-12);
    for (const key of lastKeys) {
      const v = byBucket.get(key)!;
      const [, m] = key.split("-").map(Number);
      out.push({
        key,
        label: m ? MONTH_SHORT[m - 1]! : key,
        debit: v.debit,
        credit: v.credit,
        count: v.n,
      });
    }
  }

  return { chartBuckets: out, chartGranularity: gran };
}

// ============================================================================
// Detail — main panel
// ============================================================================

export interface ReviewSource {
  /** transaction_sources row id. */
  id: number;
  sourceType: string;
  /** Pretty-printed extractor / parser identifier, when raw_json has one. */
  extractorId: string | null;
  /** Best-effort human label ("Zepto invoice — 2 items"). */
  summary: string;
  /** When known (e.g. for invoices we have the order PDF on disk). */
  archivePath: string | null;
  ingestedAt: string | null;
  /** Decoded raw_json — kept opaque; UI can pick fields it knows about. */
  rawJson: Record<string, unknown>;
}

/**
 * Category breakdown for the calendar month containing the txn. Powers the
 * "context bar" under the category picker — shows the user where this txn
 * sits relative to the rest of the month's spend. Sorted by debit desc.
 */
export interface MonthCategoryRow {
  /** May be null when the category is unset. */
  category: string | null;
  /** Sum of withdrawals on this category in the month. */
  debit: number;
  /** Number of debit txns in this category in the month. */
  count: number;
}

/**
 * What we know — or can plausibly guess — about the product behind this
 * charge. `source` tells the UI how confidently to assert: `user_label` is
 * "the user told us once, remember forever"; `price_kb` is "the static
 * merchant + price-point KB had a match" (a hint, not a fact).
 */
export interface ReviewProductHint {
  label: string;
  source: "user_label" | "price_kb";
  confidence: HintConfidence;
  /** Optional category suggestion that came with the hint. */
  categoryHint: string | null;
}

/**
 * Smart-suggestion output. Drawer renders "💡 Last 3 txns with this
 * counterparty were Household · Monthly" when these come back non-null.
 * `confidence` is a 0-1 hint we currently use only to gate UI emphasis.
 *
 * v2 also carries `merchantHistory` (lifetime aggregation across all
 * same-counterparty rows) and `productHint` (user label OR static price-KB
 * lookup). Both are nullable — counterparty might be blank, history might
 * be empty.
 */
export interface ReviewSuggestion {
  category: string | null;
  recurrence: string | null;
  reason: string;
  confidence: number;
  merchantHistory: MerchantHistory | null;
  productHint: ReviewProductHint | null;
  /**
   * Counterparty actually used to compute merchantHistory / productHint.
   * Falls back to a narration-extracted name when the DB column is null,
   * so the merchant rails still render for rows where ingestion didn't
   * capture a clean counterparty. May differ in case/punctuation from the
   * stored counterparty — the merchant lookup itself is case-insensitive.
   */
  effectiveCounterparty: string | null;
}

/**
 * Inferred location for a transaction, derived from imported Google Maps
 * Timeline data. NULL when:
 *   - the txn has no time component (date-only rows)
 *   - the counterparty is online (Apple / Netflix / payment processors)
 *   - no candidate falls within the matching window
 *
 * `staleAgeDays` tells the UI when the user's location data ends before
 * the txn time — typically because they haven't re-imported in a while.
 * UI uses this to surface a "your timeline ends [date] — fresh export?" nudge.
 */
export interface ReviewInferredLocation extends LocationMatch {
  /** Days between the most recent location record and the txn time. 0 when fresh. */
  staleAgeDays: number;
}

/**
 * Monthly aggregate across the three categorization dimensions, used to
 * power the small donut + bar visualizations in the drawer.
 */
export interface MonthDimensionAggregates {
  /** Total debits across the month. */
  total: number;
  /** Personal vs shared (debit-weighted). */
  personal: number;
  shared: number;
  /** One-time vs recurring breakdown. NULL recurrence counts as one_time. */
  oneTime: number;
  recurring: number;
}

export interface ReviewTransactionDetail {
  id: number;
  txnDate: string;
  txnTime: string | null;
  valueDate: string | null;
  withdrawal: number | null;
  deposit: number | null;
  refNo: string | null;
  narration: string | null;
  counterparty: string | null;
  counterpartyKind: string | null;
  personId: string | null;
  category: string | null;
  categoryRule: string | null;
  sharedWith: string[];
  shareCount: number;
  recurrence: string | null;
  notes: string | null;
  reviewed: boolean;
  linkedTxnId: number | null;
  account: { id: number; bank: string; type: string; last4: string };
  sources: ReviewSource[];
  /** If a transaction_sources row links to a separate physical file, the file's location. */
  attachedFiles: Array<{ sourceType: string; path: string }>;
  /** Auto-suggestion (rules + counterparty history). Null when no signal. */
  suggestion: ReviewSuggestion | null;
  /**
   * Best-guess physical location for this transaction, drawn from imported
   * Google Maps Timeline data. NULL when no inference is possible or the
   * counterparty is online.
   */
  inferredLocation: ReviewInferredLocation | null;
}

export async function getTransactionForReview(
  id: number,
): Promise<ReviewTransactionDetail | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const t = db().get<{
    id: number;
    account_id: number;
    txn_date: string;
    txn_time: string | null;
    value_date: string | null;
    withdrawal: number | null;
    deposit: number | null;
    ref_no: string | null;
    narration: string | null;
    counterparty: string | null;
    counterparty_kind: string | null;
    person_id: string | null;
    category: string | null;
    category_rule: string | null;
    shared_with: string | null;
    share_count: number;
    recurrence: string | null;
    notes: string | null;
    reviewed: number;
    linked_txn_id: number | null;
    bank: string;
    type: string;
    last4: string;
  }>(sql`
    SELECT t.id, t.account_id, t.txn_date, t.txn_time, t.value_date,
           t.withdrawal, t.deposit, t.ref_no, t.narration,
           t.counterparty, t.counterparty_kind, t.person_id,
           t.category, t.category_rule, t.shared_with, t.share_count,
           t.recurrence,
           t.notes, t.reviewed, t.linked_txn_id,
           a.bank, a.type, a.last4
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.id = ${id}
  `);
  if (!t) return null;

  const sources = db().all<{
    id: number;
    source_type: string;
    raw_json: string;
    ingested_at: string | null;
    statement_source_file: string | null;
  }>(sql`
    SELECT ts.id, ts.source_type, ts.raw_json, ts.ingested_at,
           st.source_file AS statement_source_file
    FROM transaction_sources ts
    JOIN statements st ON st.id = ts.statement_id
    WHERE ts.transaction_id = ${id}
    ORDER BY ts.id ASC
  `);

  const decoded: ReviewSource[] = sources.map((s) => {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(s.raw_json) as Record<string, unknown>;
    } catch {
      raw = {};
    }
    return {
      id: s.id,
      sourceType: s.source_type,
      extractorId: typeof raw.extractorId === "string" ? raw.extractorId : null,
      summary: summarizeSource(s.source_type, raw),
      archivePath: archivePathFor(s.source_type, s.statement_source_file),
      ingestedAt: s.ingested_at,
      rawJson: raw,
    };
  });

  const attachedFiles = decoded
    .filter((s) => s.archivePath != null)
    .map((s) => ({ sourceType: s.sourceType, path: s.archivePath as string }));

  // Smart suggestion — combines:
  //   1. Merchant history (lifetime aggregation of same-counterparty rows)
  //   2. Product hint (user_label > static price KB)
  //   3. Category + recurrence vote from past reviewed rows (legacy)
  // History + hint always populate when there's a counterparty; the vote
  // logic only fires on unreviewed rows with empty slots.
  const suggestion = computeSuggestion({
    txnId: t.id,
    counterparty: t.counterparty,
    narration: t.narration,
    category: t.category,
    recurrence: t.recurrence,
    reviewed: Boolean(t.reviewed),
    amountInr: t.withdrawal ?? t.deposit ?? 0,
  });

  // Location inference — gated by (a) having a txn_time, (b) the counterparty
  // not looking like a pure-online merchant, and (c) at least one location
  // candidate within the matching window. Always computed (even for
  // reviewed rows) so the user can see where past charges happened too.
  const inferredLocation = computeInferredLocation({
    counterparty: t.counterparty,
    txnDate: t.txn_date,
    txnTime: t.txn_time,
  });

  return {
    id: t.id,
    txnDate: t.txn_date,
    txnTime: t.txn_time,
    valueDate: t.value_date,
    withdrawal: t.withdrawal,
    deposit: t.deposit,
    refNo: t.ref_no,
    narration: t.narration,
    counterparty: t.counterparty,
    counterpartyKind: t.counterparty_kind,
    personId: t.person_id,
    category: t.category,
    categoryRule: t.category_rule,
    sharedWith: t.shared_with
      ? t.shared_with.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    shareCount: t.share_count ?? 1,
    recurrence: t.recurrence,
    notes: t.notes,
    reviewed: Boolean(t.reviewed),
    linkedTxnId: t.linked_txn_id,
    account: { id: t.account_id, bank: t.bank, type: t.type, last4: t.last4 },
    sources: decoded,
    attachedFiles,
    suggestion,
    inferredLocation,
  };
}

/**
 * Compute the full SmartSuggest output: merchant history + product hint +
 * category/recurrence vote from past reviewed rows.
 *
 * History + hint are always computed when a counterparty exists, so the
 * right-pane "Merchant history" panel renders for reviewed rows too. The
 * legacy category/recurrence vote only fires for unreviewed rows with at
 * least one empty slot — same gating as before.
 *
 * Returns null only when no useful information can be surfaced at all (no
 * counterparty AND no fallback signal).
 */
function computeSuggestion(input: {
  txnId: number;
  counterparty: string | null;
  narration: string | null;
  category: string | null;
  recurrence: string | null;
  reviewed: boolean;
  amountInr: number;
}): ReviewSuggestion | null {
  // Prefer the stored counterparty. When ingestion left it null (common
  // for some HDFC savings narrations), fall back to extracting a clean
  // name from the narration — the same logic that powers the inline
  // "Suggested: <name>" pill. This is what lets the merchant rails show
  // up for rows the user hasn't named yet but where the merchant is
  // unambiguous from narration ("APPLE MEDIA SERVICES", "BLINKIT", etc).
  const stored = input.counterparty?.trim();
  const cp =
    stored && stored.length > 0
      ? stored
      : extractCounterpartyFromNarration(input.narration);
  if (!cp) return null;

  // ─── Merchant history (all same-counterparty rows) ───────────────────
  // Two paths feed this:
  //   a) Stored counterparty matches (case-insensitive — so an inferred
  //      title-case "Apple Media Services" aggregates with rows stored
  //      as "APPLE MEDIA SERVICES").
  //   b) Counterparty IS NULL in DB but the narration extracts to the
  //      same name. Common for HDFC savings rows where ingestion didn't
  //      capture a clean counterparty — every row that the rail labels
  //      via displayCounterparty() should also count here.
  //
  // The LIKE filter is intentionally loose (substring on narration); we
  // then post-filter in JS by re-running the same extraction the rail
  // uses, so the loose substring doesn't over-match. Pre-cap at 500
  // candidates to bound the JS-side filter cost; post-filter cap at 200
  // matches the historic limit downstream code expects.
  const candidates = db().all<{
    id: number;
    txn_date: string;
    withdrawal: number | null;
    deposit: number | null;
    counterparty: string | null;
    narration: string | null;
  }>(sql`
    SELECT id, txn_date, withdrawal, deposit, counterparty, narration
    FROM transactions
    WHERE counterparty = ${cp} COLLATE NOCASE
       OR (
         counterparty IS NULL
         AND LOWER(narration) LIKE ${"%" + cp.toLowerCase() + "%"}
       )
    ORDER BY txn_date DESC, id DESC
    LIMIT 500
  `);
  const cpLower = cp.toLowerCase();
  const matched = candidates.filter((r) => {
    // Stored counterparty path: SQL already case-folded the match.
    if (r.counterparty != null && r.counterparty.trim().length > 0) {
      return true;
    }
    // Null-counterparty path: confirm narration extraction agrees.
    const extracted = extractCounterpartyFromNarration(r.narration);
    return extracted != null && extracted.toLowerCase() === cpLower;
  });
  const merchantRows: MerchantTxnLite[] = matched.slice(0, 200).map((r) => ({
    id: r.id,
    date: r.txn_date,
    amountInr: Math.abs(r.withdrawal ?? r.deposit ?? 0),
  }));
  const merchantHistory = summarizeMerchant(merchantRows, input.txnId);

  // ─── Product hint (user_label > static price KB) ─────────────────────
  const userLabel = lookupMerchantLabel(cp, input.amountInr);
  const cadenceKind = merchantHistory?.cadence.kind ?? "one_time";
  const kbHint = getPriceHint(cp, input.amountInr, cadenceKind);
  let productHint: ReviewProductHint | null = null;
  if (userLabel) {
    productHint = {
      label: userLabel.label,
      source: "user_label",
      confidence: "high",
      categoryHint: userLabel.categoryHint,
    };
  } else if (kbHint) {
    productHint = {
      label: kbHint.label,
      source: "price_kb",
      confidence: kbHint.confidence,
      categoryHint: kbHint.categoryHint,
    };
  }

  // ─── Category + recurrence vote (existing behaviour, unchanged) ──────
  let votedCategory: string | null = null;
  let votedRecurrence: string | null = null;
  let voteReason = "";
  let voteConfidence = 0;

  if (!input.reviewed && (!input.category || !input.recurrence)) {
    const past = db().all<{ category: string | null; recurrence: string | null }>(sql`
      SELECT category, recurrence
      FROM transactions
      WHERE counterparty = ${cp}
        AND id != ${input.txnId}
        AND reviewed = 1
      ORDER BY txn_date DESC, id DESC
      LIMIT 5
    `);
    if (past.length > 0) {
      const catVotes = new Map<string, number>();
      const recVotes = new Map<string, number>();
      for (const r of past) {
        if (r.category) catVotes.set(r.category, (catVotes.get(r.category) ?? 0) + 1);
        if (r.recurrence)
          recVotes.set(r.recurrence, (recVotes.get(r.recurrence) ?? 0) + 1);
      }
      const top = (m: Map<string, number>): { value: string; n: number } | null => {
        let best: { value: string; n: number } | null = null;
        for (const [v, n] of m) {
          if (!best || n > best.n) best = { value: v, n };
        }
        return best;
      };
      const cat = !input.category ? top(catVotes) : null;
      const rec = !input.recurrence ? top(recVotes) : null;
      if (cat) votedCategory = cat.value;
      if (rec) votedRecurrence = rec.value;
      if (cat || rec) {
        voteReason = `From ${past.length} reviewed txn${past.length === 1 ? "" : "s"} with this counterparty`;
        voteConfidence = Math.min(1, past.length / 5);
      }
    }
  }

  // If unreviewed AND no recurrence set AND we detected a confident cadence,
  // surface it as the suggested recurrence too. The product-hint pipeline
  // already gives us category coverage via categoryHint.
  if (
    !input.reviewed &&
    !input.recurrence &&
    !votedRecurrence &&
    merchantHistory &&
    merchantHistory.cadence.confidence !== "low" &&
    merchantHistory.cadence.kind !== "one_time" &&
    merchantHistory.cadence.kind !== "irregular"
  ) {
    votedRecurrence = merchantHistory.cadence.kind;
  }
  if (
    !input.reviewed &&
    !input.category &&
    !votedCategory &&
    productHint?.categoryHint
  ) {
    votedCategory = productHint.categoryHint;
  }

  // Reason text — prefer the product hint headline, fall back to the
  // vote-history reason, fall back to plain history.
  let reason = voteReason;
  if (!reason && productHint) {
    reason =
      productHint.source === "user_label"
        ? `Labelled ${productHint.label}`
        : `Likely ${productHint.label}`;
  }
  if (!reason && merchantHistory) {
    reason =
      merchantHistory.count > 1
        ? `${merchantHistory.count} charges with ${cp}`
        : `First charge with ${cp}`;
  }

  // Bail only if there's literally nothing to show.
  if (
    !votedCategory &&
    !votedRecurrence &&
    !productHint &&
    !merchantHistory
  ) {
    return null;
  }

  return {
    category: votedCategory,
    recurrence: votedRecurrence,
    reason,
    confidence: voteConfidence,
    merchantHistory,
    productHint,
    effectiveCounterparty: cp,
  };
}

/**
 * Resolve a sticky user label for (counterparty, amount). Per-amount label
 * wins over the NULL-amount fallback when both exist.
 */
function lookupMerchantLabel(
  counterparty: string,
  amountInr: number,
): { label: string; categoryHint: string | null } | null {
  const amountRound = Math.round(amountInr);
  const exact = db().get<{ label: string; category_hint: string | null }>(sql`
    SELECT label, category_hint
    FROM merchant_labels
    WHERE counterparty = ${counterparty} AND amount_inr = ${amountRound}
    LIMIT 1
  `);
  if (exact) return { label: exact.label, categoryHint: exact.category_hint };
  const fallback = db().get<{ label: string; category_hint: string | null }>(sql`
    SELECT label, category_hint
    FROM merchant_labels
    WHERE counterparty = ${counterparty} AND amount_inr IS NULL
    LIMIT 1
  `);
  if (fallback)
    return { label: fallback.label, categoryHint: fallback.category_hint };
  return null;
}

/**
 * Look up the user's `is_online` override for a counterparty across all
 * amount rows (per-amount and the NULL fallback). Returns the first
 * non-null override found, or null when none exist.
 */
function lookupIsOnlineOverride(counterparty: string): boolean | null {
  const row = db().get<{ is_online: number | null }>(sql`
    SELECT is_online
    FROM merchant_labels
    WHERE counterparty = ${counterparty} AND is_online IS NOT NULL
    ORDER BY (amount_inr IS NULL) ASC  -- prefer per-amount over fallback
    LIMIT 1
  `);
  if (!row || row.is_online == null) return null;
  return row.is_online === 1;
}

/**
 * Compute the location-inference result for a transaction. Pulled out of
 * `getTransactionForReview` so the dependency on `@splitlens/core/location`
 * is contained in one spot.
 *
 * Gating:
 *   - No txn_time → cannot match; skip.
 *   - Online-merchant counterparty → skip (false matches are worse than blanks).
 *   - No candidate within ±60min of txn → skip.
 *
 * Reads up to ±60 min of candidates from `location_records` and hands them
 * to the pure matcher. The matcher enforces its own ±15 min tolerance
 * inside that window — the wider DB pull is a single index scan, so the
 * cost is negligible and we get free room for tuning.
 */
function computeInferredLocation(input: {
  counterparty: string | null;
  txnDate: string;
  txnTime: string | null;
}): ReviewInferredLocation | null {
  if (!input.txnTime) return null;

  const cp = input.counterparty?.trim() ?? "";
  const override = cp ? lookupIsOnlineOverride(cp) : null;
  if (isOnlineMerchant(cp, override)) return null;

  const txnUtcMs = istLocalToUtcMs(input.txnDate, input.txnTime);
  if (txnUtcMs == null) return null;

  // Fetch candidates within ±60 min OR any semantic stay whose window
  // covers the txn time. The first half is the raw-ping bucket; the
  // second covers stays that may span hours.
  const windowMs = 60 * 60 * 1000;
  const lowIso = new Date(txnUtcMs - windowMs).toISOString();
  const highIso = new Date(txnUtcMs + windowMs).toISOString();
  const txnIso = new Date(txnUtcMs).toISOString();

  const rows = db().all<{
    timestamp_utc: string;
    window_end_utc: string | null;
    lat: number;
    lng: number;
    accuracy_m: number | null;
    place_name: string | null;
    place_id: string | null;
    place_category: string | null;
    source_kind: string;
  }>(sql`
    SELECT timestamp_utc, window_end_utc, lat, lng, accuracy_m,
           place_name, place_id, place_category, source_kind
    FROM location_records
    WHERE (source_kind = 'takeout_raw'
            AND timestamp_utc BETWEEN ${lowIso} AND ${highIso})
       OR (source_kind = 'takeout_semantic'
            AND timestamp_utc <= ${txnIso}
            AND window_end_utc >= ${txnIso})
  `);

  if (rows.length === 0) {
    return null;
  }

  const candidates: LocationCandidate[] = rows.map((r) => {
    if (r.source_kind === "takeout_semantic" && r.window_end_utc) {
      return {
        kind: "semantic" as const,
        startUtcMs: Date.parse(r.timestamp_utc),
        endUtcMs: Date.parse(r.window_end_utc),
        lat: r.lat,
        lng: r.lng,
        placeName: r.place_name,
        placeId: r.place_id,
        placeCategory: r.place_category,
      };
    }
    return {
      kind: "raw" as const,
      timestampUtcMs: Date.parse(r.timestamp_utc),
      lat: r.lat,
      lng: r.lng,
      accuracyM: r.accuracy_m,
    };
  });

  const match = matchLocation(txnUtcMs, candidates);
  if (!match) return null;

  // Staleness — how recent is the user's most recent location data
  // overall? Used by UI to surface "your timeline ends [date]" copy when
  // the txn is much newer than anything imported.
  const newest = db().get<{ max_ts: string | null }>(sql`
    SELECT MAX(coalesce(window_end_utc, timestamp_utc)) AS max_ts
    FROM location_records
  `);
  let staleAgeDays = 0;
  if (newest?.max_ts) {
    const newestMs = Date.parse(newest.max_ts);
    if (Number.isFinite(newestMs) && txnUtcMs > newestMs) {
      staleAgeDays = Math.round((txnUtcMs - newestMs) / (24 * 60 * 60 * 1000));
    }
  }

  return { ...match, staleAgeDays };
}

function summarizeSource(sourceType: string, raw: Record<string, unknown>): string {
  switch (sourceType) {
    case "zepto_invoice": {
      const items = Array.isArray(raw.items) ? raw.items.length : 0;
      return `Zepto invoice · order ${raw.orderNo ?? "?"} · ${items} item${items === 1 ? "" : "s"}`;
    }
    case "swiggy_email":
      return `Swiggy email · ${raw.restaurant ?? "order"}`;
    case "zomato_email":
      return `Zomato email · ${raw.restaurant ?? "order"}`;
    case "zepto_ocr":
      return `Zepto screenshot · ${raw.orderId ?? "?"}`;
    case "blinkit_ocr":
      return `Blinkit screenshot · ${raw.orderId ?? "?"}`;
    case "instamart_ocr":
      return `Instamart screenshot · ${raw.orderId ?? "?"}`;
    case "phonepe":
      return `PhonePe statement row`;
    case "hdfc_savings":
      return `HDFC savings statement row`;
    case "hdfc_cc":
      return `HDFC credit card statement row`;
    default:
      return sourceType;
  }
}

/**
 * Only bill-like sources have a meaningful single-file archive path. PDF
 * statements aggregate many txns into one file so we don't surface that
 * file at the per-txn level.
 */
function archivePathFor(
  sourceType: string,
  statementSourceFile: string | null,
): string | null {
  if (!statementSourceFile) return null;
  const BILL_SOURCES = new Set([
    "zepto_invoice",
    "zepto_ocr",
    "blinkit_ocr",
    "instamart_ocr",
    "manual_attachment",
  ]);
  if (!BILL_SOURCES.has(sourceType)) return null;
  return statementSourceFile;
}

// ============================================================================
// Filter dropdown options
// ============================================================================

export interface ReviewFilterMeta {
  categories: Array<{ category: string; count: number }>;
  accounts: Array<{ id: number; bank: string; type: string; last4: string; count: number }>;
}

export async function getReviewFilterMeta(): Promise<ReviewFilterMeta> {
  const cats = db().all<{ category: string; n: number }>(sql`
    SELECT category, count(*) AS n
    FROM transactions
    WHERE category IS NOT NULL AND category != ''
    GROUP BY category
    ORDER BY n DESC, category ASC
  `);
  const accs = db().all<{
    id: number;
    bank: string;
    type: string;
    last4: string;
    n: number;
  }>(sql`
    SELECT a.id, a.bank, a.type, a.last4, count(t.id) AS n
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id
    ORDER BY n DESC
  `);
  return {
    categories: cats.map((c) => ({ category: c.category, count: c.n })),
    accounts: accs.map((a) => ({
      id: a.id,
      bank: a.bank,
      type: a.type,
      last4: a.last4,
      count: a.n,
    })),
  };
}

// ============================================================================
// Next-unreviewed helper
// ============================================================================

/**
 * Given the current txn id, find the next unreviewed txn id within the same
 * filter. Used by the "Save + Next" action to auto-advance. Returns null
 * when nothing more is unreviewed under the filter.
 */
export async function findNextUnreviewedAfter(
  currentId: number,
  filter: ReviewListFilter = {},
): Promise<number | null> {
  const where: ReturnType<typeof sql>[] = [sql`t.reviewed = 0`, sql`t.id != ${currentId}`];
  if (filter.from) where.push(sql`t.txn_date >= ${filter.from}`);
  if (filter.to) where.push(sql`t.txn_date <= ${filter.to}`);
  if (filter.category) where.push(sql`t.category = ${filter.category}`);
  if (filter.personId) where.push(sql`t.person_id = ${filter.personId}`);
  if (filter.accountId != null) where.push(sql`t.account_id = ${filter.accountId}`);
  const next = db().get<{ id: number }>(sql`
    SELECT t.id FROM transactions t
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY t.txn_date DESC, coalesce(t.txn_time, '00:00') DESC, t.id DESC
    LIMIT 1
  `);
  return next?.id ?? null;
}

// ============================================================================
// Time navigator buckets — year / month / day chips
// ============================================================================

export interface TimeBuckets {
  /** All years that have at least one matching txn. Sorted ascending. */
  years: Array<{ year: number; count: number }>;
  /** Months within the selected year (1-12). Empty when no year is selected. */
  months: Array<{ year: number; month: number; count: number }>;
  /**
   * Every month that has at least one matching txn, sorted ascending
   * (oldest → newest). The Review List's scrubber strip renders this and
   * lets the user scroll horizontally through all of history. Naming kept
   * for back-compat; "recent" is no longer literal.
   */
  recentMonths: Array<{
    year: number;
    month: number;
    count: number;
    unreviewed: number;
  }>;
  /** Days within the selected year+month. Empty when no month is selected. */
  days: Array<{ year: number; month: number; day: number; count: number }>;
  /** Time-of-day buckets within the selected day. Empty when no day is selected. */
  timeOfDay: Array<{
    bucket: "morning" | "afternoon" | "evening" | "night";
    count: number;
  }>;
  /** Currently-selected year/month/day, derived from filter.from/to. */
  selectedYear: number | null;
  selectedMonth: number | null;
  selectedDay: number | null;
}

/**
 * Returns hierarchical date counts for the TimeNavigator strip.
 *
 * The "selection" is implicit in the filter's from/to range:
 *   from=2026-01-01 + to=2026-12-31  → year 2026 selected
 *   from=2026-05-01 + to=2026-05-31  → year 2026, month May selected
 *   from=2026-05-14 + to=2026-05-14  → year 2026, month May, day 14 selected
 *   anything else                    → nothing selected; only `years` is filled
 *
 * Other filter fields (category, account, person, q, unreviewedOnly) DO
 * apply to the counts — so picking "Food:Restaurant" + drilling into May
 * shows you how many food txns there were each day. Time-of-day filter is
 * intentionally NOT applied to its own bucket counts (you'd want to see
 * "morning had 3, afternoon had 7" regardless of which bucket you're in).
 */
export async function getTimeBuckets(
  filter: ReviewListFilter = {},
): Promise<TimeBuckets> {
  const baseWhere: ReturnType<typeof sql>[] = [];
  if (filter.category) baseWhere.push(sql`t.category = ${filter.category}`);
  if (filter.personId) baseWhere.push(sql`t.person_id = ${filter.personId}`);
  if (filter.accountId != null) baseWhere.push(sql`t.account_id = ${filter.accountId}`);
  if (filter.unreviewedOnly) baseWhere.push(sql`t.reviewed = 0`);
  if (filter.q && filter.q.trim()) {
    const needle = `%${filter.q.trim().toLowerCase()}%`;
    baseWhere.push(
      sql`(LOWER(coalesce(t.counterparty,'')) LIKE ${needle} OR LOWER(coalesce(t.narration,'')) LIKE ${needle})`,
    );
  }
  const baseWhereSql =
    baseWhere.length === 0 ? sql`` : sql`AND ${sql.join(baseWhere, sql` AND `)}`;

  // Years — always show every year with any matching txn.
  const yearRows = db().all<{ year: string; n: number }>(sql`
    SELECT substr(t.txn_date, 1, 4) AS year, count(*) AS n
    FROM transactions t
    WHERE t.txn_date IS NOT NULL ${baseWhereSql}
    GROUP BY year
    ORDER BY year ASC
  `);

  // Every month with matching txns. The scrubber strip is horizontally
  // scrollable client-side, so we return all of history (not just the
  // most recent 12) and let the user scroll through them. Result is
  // ascending — oldest → newest — so the strip reads left-to-right
  // chronologically with the latest month landing on the right edge.
  const recentMonthRows = db().all<{
    ym: string;
    n: number;
    unreviewed: number;
  }>(sql`
    SELECT substr(t.txn_date, 1, 7) AS ym,
           count(*) AS n,
           count(*) FILTER (WHERE t.reviewed = 0) AS unreviewed
    FROM transactions t
    WHERE t.txn_date IS NOT NULL ${baseWhereSql}
    GROUP BY ym
    ORDER BY ym ASC
  `);
  const recentMonths = recentMonthRows.map((r) => {
    const [y, m] = r.ym.split("-");
    return {
      year: Number(y),
      month: Number(m),
      count: r.n,
      unreviewed: r.unreviewed,
    };
  });

  // Selection derivation from from/to.
  const { selectedYear, selectedMonth, selectedDay } = deriveSelection(
    filter.from,
    filter.to,
  );

  // Months — only when a year is selected.
  let monthRows: Array<{ ym: string; n: number }> = [];
  if (selectedYear != null) {
    const yearPrefix = `${selectedYear}-`;
    monthRows = db().all<{ ym: string; n: number }>(sql`
      SELECT substr(t.txn_date, 1, 7) AS ym, count(*) AS n
      FROM transactions t
      WHERE substr(t.txn_date, 1, 4) = ${String(selectedYear)} ${baseWhereSql}
      GROUP BY ym
      ORDER BY ym ASC
    `);
    void yearPrefix;
  }

  // Days — only when a month is selected.
  let dayRows: Array<{ ymd: string; n: number }> = [];
  if (selectedYear != null && selectedMonth != null) {
    const monthPrefix = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
    dayRows = db().all<{ ymd: string; n: number }>(sql`
      SELECT t.txn_date AS ymd, count(*) AS n
      FROM transactions t
      WHERE substr(t.txn_date, 1, 7) = ${monthPrefix} ${baseWhereSql}
      GROUP BY ymd
      ORDER BY ymd ASC
    `);
  }

  // Time-of-day — only when a single day is selected.
  let timeOfDayCounts: Array<{
    bucket: "morning" | "afternoon" | "evening" | "night";
    count: number;
  }> = [];
  if (selectedYear != null && selectedMonth != null && selectedDay != null) {
    const isoDay = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
    const r = db().get<{
      morning: number;
      afternoon: number;
      evening: number;
      night: number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE t.txn_time IS NOT NULL AND t.txn_time >= '06:00' AND t.txn_time < '12:00') AS morning,
        count(*) FILTER (WHERE t.txn_time IS NOT NULL AND t.txn_time >= '12:00' AND t.txn_time < '17:00') AS afternoon,
        count(*) FILTER (WHERE t.txn_time IS NOT NULL AND t.txn_time >= '17:00' AND t.txn_time < '21:00') AS evening,
        count(*) FILTER (WHERE t.txn_time IS NOT NULL AND (t.txn_time >= '21:00' OR t.txn_time < '06:00')) AS night
      FROM transactions t
      WHERE t.txn_date = ${isoDay} ${baseWhereSql}
    `);
    if (r) {
      timeOfDayCounts = (
        [
          ["morning", r.morning],
          ["afternoon", r.afternoon],
          ["evening", r.evening],
          ["night", r.night],
        ] as const
      ).map(([bucket, count]) => ({ bucket, count }));
    }
  }

  return {
    years: yearRows.map((r) => ({ year: Number(r.year), count: r.n })),
    months: monthRows.map((r) => {
      const [y, m] = r.ym.split("-");
      return { year: Number(y), month: Number(m), count: r.n };
    }),
    recentMonths,
    days: dayRows.map((r) => {
      const [y, m, d] = r.ymd.split("-");
      return { year: Number(y), month: Number(m), day: Number(d), count: r.n };
    }),
    timeOfDay: timeOfDayCounts,
    selectedYear,
    selectedMonth,
    selectedDay,
  };
}

// `deriveSelection` + `rangeForSelection` live in ./review-time so the
// client-side TimeNavigator can import them too (this file is server-only).

// ============================================================================
// Custom categories — user-defined entries that extend the curated taxonomy.
// Stored in their own table so they survive a schema rebuild / re-ingest.
// ============================================================================

export interface CustomCategoryRow {
  id: string;
  label: string;
  emoji: string;
  /** Palette key from CATEGORY_COLOR_PALETTE (in taxonomy.ts). */
  colorKey: string;
  hint: string | null;
  createdAt: string | null;
}

export async function listCustomCategories(): Promise<CustomCategoryRow[]> {
  const rows = db().all<{
    id: string;
    label: string;
    emoji: string;
    color_key: string;
    hint: string | null;
    created_at: string | null;
  }>(sql`
    SELECT id, label, emoji, color_key, hint, created_at
    FROM custom_categories
    ORDER BY label COLLATE NOCASE ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    emoji: r.emoji,
    colorKey: r.color_key,
    hint: r.hint,
    createdAt: r.created_at,
  }));
}

// ============================================================================
// /review · By-merchant rich rows
// ============================================================================

/**
 * One row in the by-merchant view. Carries everything the rich row needs —
 * the in-filter aggregates that the row's columns display, plus lifetime
 * context (sparkline + lifetime count) that lets the row tell a story
 * beyond the active filter.
 *
 * The `slug` field is the canonical /merchants/[id] route segment, ready
 * to drop into an href: person rows use `personId`, businesses use the
 * counterparty string.
 */
export interface MerchantAggregate {
  /** /merchants/[slug] target. */
  slug: string;
  /** Counterparty string from the transactions table. */
  counterparty: string;
  /** Type discriminator — drives avatar tone + click target. */
  kind: "person" | "business";
  /** Person id when kind === "person", else null. */
  personId: string | null;
  /** Display label (currently the counterparty as-is). */
  displayName: string;
  /** 1–2 char initials for the avatar tile. */
  initials: string;
  /** Most common category for this merchant inside the filter (mode). */
  category: string | null;
  /** True if any txn for this merchant carries a non-one_time recurrence. */
  recurring: boolean;
  /** A representative raw narration to show under the normalized name. */
  rawNarrationSample: string | null;
  /** Txns for this merchant inside the filter. */
  countInFilter: number;
  /** Withdrawal sum inside the filter. */
  sumDebitInFilter: number;
  /** Deposit sum inside the filter. */
  sumCreditInFilter: number;
  /** Most recent txn date inside the filter (YYYY-MM-DD). */
  lastSeenInFilter: string;
  /** Total lifetime txn count across all transactions. */
  lifetimeCount: number;
  /** 12 buckets of monthly counts, oldest → newest, for the trailing 12
   *  months ending in the current month. Drives the row's sparkline. */
  sparkline: number[];
  /** Indices of bars that should render highlighted (> 1.5× the 12-mo
   *  mean). Empty if no month stands out. */
  sparkHighlights: number[];
}

/**
 * Per-merchant aggregates for the by-merchant view of `/review`.
 *
 * Honors the same `ReviewListFilter` as `listTransactionsForReview` so the
 * rows in the by-merchant view always agree with the rows in the by-date
 * view. Sorted by combined absolute flow (debit + credit) descending —
 * biggest-impact merchants first.
 *
 * Two SQL passes:
 *   1. Group by counterparty + kind + person_id inside the filter, picking
 *      up count/sum/last_seen plus a sample narration and category.
 *   2. For every merchant we found, fetch lifetime count + monthly bucket
 *      counts for the last 12 months in a single grouped query.
 *
 * Both passes scan the same table, so the cost is roughly two GROUP BYs
 * over the txn ledger — fine for the local-first dataset size.
 */
export async function getMerchantListAggregates(
  filter: ReviewListFilter = {},
): Promise<MerchantAggregate[]> {
  const where: ReturnType<typeof sql>[] = [
    sql`t.counterparty IS NOT NULL AND t.counterparty != ''`,
  ];
  if (filter.from) where.push(sql`t.txn_date >= ${filter.from}`);
  if (filter.to) where.push(sql`t.txn_date <= ${filter.to}`);
  if (filter.category) where.push(sql`t.category = ${filter.category}`);
  if (filter.unreviewedOnly) where.push(sql`t.reviewed = 0`);
  if (filter.personId) where.push(sql`t.person_id = ${filter.personId}`);
  if (filter.accountId != null) where.push(sql`t.account_id = ${filter.accountId}`);
  if (filter.shareStatus === "personal") {
    where.push(sql`(t.share_count IS NULL OR t.share_count = 1)`);
  } else if (filter.shareStatus === "shared") {
    where.push(sql`t.share_count > 1`);
  }
  if (filter.recurrenceClass === "one_time") {
    where.push(sql`(t.recurrence IS NULL OR t.recurrence = 'one_time')`);
  } else if (filter.recurrenceClass === "recurring") {
    where.push(sql`t.recurrence IS NOT NULL AND t.recurrence != 'one_time'`);
  }
  if (filter.q && filter.q.trim()) {
    const needle = `%${filter.q.trim().toLowerCase()}%`;
    where.push(
      sql`(LOWER(coalesce(t.counterparty,'')) LIKE ${needle} OR LOWER(coalesce(t.narration,'')) LIKE ${needle})`,
    );
  }
  if (filter.timeOfDay === "morning") {
    where.push(sql`t.txn_time IS NOT NULL AND t.txn_time >= '06:00' AND t.txn_time < '12:00'`);
  } else if (filter.timeOfDay === "afternoon") {
    where.push(sql`t.txn_time IS NOT NULL AND t.txn_time >= '12:00' AND t.txn_time < '17:00'`);
  } else if (filter.timeOfDay === "evening") {
    where.push(sql`t.txn_time IS NOT NULL AND t.txn_time >= '17:00' AND t.txn_time < '21:00'`);
  } else if (filter.timeOfDay === "night") {
    where.push(
      sql`t.txn_time IS NOT NULL AND (t.txn_time >= '21:00' OR t.txn_time < '06:00')`,
    );
  }
  const whereSql = sql`WHERE ${sql.join(where, sql` AND `)}`;

  // Pass 1 — one row per merchant inside the filter.
  // For category and raw narration we pick a single representative value
  // per merchant. The "most-common category" is derived in JS from a
  // separate small per-merchant×category query below — keeps the SQL
  // portable across SQLite/PGlite (no window functions, no FILTER+
  // ARGMAX). For the raw narration sample we settle for the most recent
  // one, which matches what the design renders ("RAW NARRATION" line
  // under the merchant name).
  const inFilter = db().all<{
    counterparty: string;
    kind: string | null;
    person_id: string | null;
    n: number;
    sum_debit: number;
    sum_credit: number;
    last_seen: string;
    sample_narration: string | null;
    any_recurring: number;
  }>(sql`
    SELECT
      t.counterparty                           AS counterparty,
      t.counterparty_kind                      AS kind,
      t.person_id                              AS person_id,
      count(*)                                 AS n,
      COALESCE(SUM(t.withdrawal), 0)           AS sum_debit,
      COALESCE(SUM(t.deposit), 0)              AS sum_credit,
      MAX(t.txn_date)                          AS last_seen,
      (SELECT t2.narration
         FROM transactions t2
         WHERE t2.counterparty = t.counterparty
           AND t2.narration IS NOT NULL
         ORDER BY t2.txn_date DESC, t2.id DESC
         LIMIT 1)                              AS sample_narration,
      MAX(CASE WHEN t.recurrence IS NOT NULL AND t.recurrence != 'one_time'
               THEN 1 ELSE 0 END)              AS any_recurring
    FROM transactions t
    ${whereSql}
    GROUP BY t.counterparty, t.counterparty_kind, t.person_id
  `);

  if (inFilter.length === 0) return [];

  const names = inFilter.map((r) => r.counterparty);

  // Pass 2a — most common category per merchant. Counts per (merchant,
  // category) inside the filter; JS picks the top per merchant.
  const catRows = db().all<{
    counterparty: string;
    category: string | null;
    n: number;
  }>(sql`
    SELECT t.counterparty AS counterparty,
           t.category     AS category,
           count(*)       AS n
    FROM transactions t
    ${whereSql}
      AND t.counterparty IN (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})
    GROUP BY t.counterparty, t.category
  `);
  const topCategory = new Map<string, string | null>();
  {
    // For each merchant, keep the category with the highest count. Skip
    // null categories unless they're literally all we have.
    const bestNonNull = new Map<string, { cat: string; n: number }>();
    const bestAny = new Map<string, { cat: string | null; n: number }>();
    for (const r of catRows) {
      const prevAny = bestAny.get(r.counterparty);
      if (!prevAny || r.n > prevAny.n) {
        bestAny.set(r.counterparty, { cat: r.category, n: r.n });
      }
      if (r.category != null) {
        const prevNN = bestNonNull.get(r.counterparty);
        if (!prevNN || r.n > prevNN.n) {
          bestNonNull.set(r.counterparty, { cat: r.category, n: r.n });
        }
      }
    }
    for (const m of names) {
      const nn = bestNonNull.get(m);
      const any = bestAny.get(m);
      topCategory.set(m, nn?.cat ?? any?.cat ?? null);
    }
  }

  // Pass 2b — lifetime count and 12-month sparkline buckets. Single query
  // grouped by (counterparty, year-month); JS bins into 12 trailing
  // months ending in the current month.
  const now = new Date();
  const axis: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    axis.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  const oldestYm = axis[0];
  const monthlyRows = db().all<{
    counterparty: string;
    ym: string;
    n: number;
  }>(sql`
    SELECT t.counterparty            AS counterparty,
           substr(t.txn_date, 1, 7)  AS ym,
           count(*)                  AS n
    FROM transactions t
    WHERE t.counterparty IN (${sql.join(
      names.map((n) => sql`${n}`),
      sql`, `,
    )})
      AND t.txn_date >= ${oldestYm + "-01"}
    GROUP BY t.counterparty, substr(t.txn_date, 1, 7)
  `);
  const lifetimeRows = db().all<{ counterparty: string; n: number }>(sql`
    SELECT t.counterparty AS counterparty, count(*) AS n
    FROM transactions t
    WHERE t.counterparty IN (${sql.join(
      names.map((n) => sql`${n}`),
      sql`, `,
    )})
    GROUP BY t.counterparty
  `);
  const lifetimeByMerchant = new Map<string, number>();
  for (const r of lifetimeRows) {
    lifetimeByMerchant.set(r.counterparty, Number(r.n));
  }
  const sparkByMerchant = new Map<string, number[]>();
  for (const r of monthlyRows) {
    const arr = sparkByMerchant.get(r.counterparty) ?? new Array(12).fill(0);
    const idx = axis.indexOf(r.ym);
    if (idx >= 0) arr[idx] = Number(r.n);
    sparkByMerchant.set(r.counterparty, arr);
  }

  // Assemble + sort.
  const out: MerchantAggregate[] = inFilter.map((r) => {
    const kind: MerchantAggregate["kind"] =
      r.kind === "person" || r.person_id ? "person" : "business";
    const slug =
      kind === "person" && r.person_id ? r.person_id : r.counterparty;
    const spark = sparkByMerchant.get(r.counterparty) ?? new Array(12).fill(0);
    const mean = spark.reduce((s, n) => s + n, 0) / 12;
    const hot = mean > 0 ? spark.map((n, i) => (n > mean * 1.5 ? i : -1)).filter((i) => i >= 0) : [];
    return {
      slug,
      counterparty: r.counterparty,
      kind,
      personId: kind === "person" ? r.person_id : null,
      displayName: r.counterparty,
      initials: initialsFor(r.counterparty),
      category: topCategory.get(r.counterparty) ?? null,
      recurring: Number(r.any_recurring) > 0,
      rawNarrationSample: r.sample_narration,
      countInFilter: Number(r.n),
      sumDebitInFilter: Number(r.sum_debit),
      sumCreditInFilter: Number(r.sum_credit),
      lastSeenInFilter: r.last_seen,
      lifetimeCount: lifetimeByMerchant.get(r.counterparty) ?? Number(r.n),
      sparkline: spark,
      sparkHighlights: hot,
    };
  });

  // Sort by absolute flow desc — biggest impact first.
  out.sort(
    (a, b) =>
      b.sumDebitInFilter +
      b.sumCreditInFilter -
      (a.sumDebitInFilter + a.sumCreditInFilter),
  );
  return out;
}

/**
 * Apply every saved per-merchant rule (category + recurrence + share)
 * to any newly-arrived un-reviewed transactions whose counterparty
 * matches. Called from the /review page loader so the user's
 * previously-set rules keep working across statement ingestions —
 * they don't have to re-toggle the bulk apply each month for the same
 * recurring merchant.
 *
 * Three independent UPDATEs, one per rule table. Each is idempotent:
 * only updates rows that don't already match the rule's value.
 * Reviewed=1 rows are left alone — those are user-confirmed and trump
 * any rule. Cheap when no rules exist (zero-row joins, ~microseconds).
 */
export async function sweepPendingMerchantRules(): Promise<{
  swept: number;
}> {
  let total = 0;
  const tally = (result: unknown) => {
    if (typeof (result as { changes?: number }).changes === "number") {
      total += (result as { changes: number }).changes;
    }
  };

  // Category: existing path, retained verbatim. Sets category +
  // category_rule = 'merchant' so the ingestion-time merger knows the
  // value came from a rule (not from a SmartSuggest accept).
  tally(
    db().run(sql`
      UPDATE transactions
      SET category = (
            SELECT category FROM merchant_category_rules r
            WHERE r.counterparty = transactions.counterparty
          ),
          category_rule = 'merchant',
          updated_at = CURRENT_TIMESTAMP
      WHERE transactions.counterparty IN (
              SELECT counterparty FROM merchant_category_rules
            )
        AND transactions.reviewed = 0
        AND (
          transactions.category IS NULL
          OR transactions.category != (
            SELECT category FROM merchant_category_rules r
            WHERE r.counterparty = transactions.counterparty
          )
        )
    `),
  );

  // Recurrence
  tally(
    db().run(sql`
      UPDATE transactions
      SET recurrence = (
            SELECT recurrence FROM merchant_recurrence_rules r
            WHERE r.counterparty = transactions.counterparty
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE transactions.counterparty IN (
              SELECT counterparty FROM merchant_recurrence_rules
            )
        AND transactions.reviewed = 0
        AND (
          transactions.recurrence IS NULL
          OR transactions.recurrence != (
            SELECT recurrence FROM merchant_recurrence_rules r
            WHERE r.counterparty = transactions.counterparty
          )
        )
    `),
  );

  // Share
  tally(
    db().run(sql`
      UPDATE transactions
      SET shared_with = (
            SELECT shared_with FROM merchant_share_rules r
            WHERE r.counterparty = transactions.counterparty
          ),
          share_count = (
            SELECT share_count FROM merchant_share_rules r
            WHERE r.counterparty = transactions.counterparty
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE transactions.counterparty IN (
              SELECT counterparty FROM merchant_share_rules
            )
        AND transactions.reviewed = 0
        AND (
          transactions.share_count != (
            SELECT share_count FROM merchant_share_rules r
            WHERE r.counterparty = transactions.counterparty
          )
          OR (
            (transactions.shared_with IS NULL) !=
            ((SELECT shared_with FROM merchant_share_rules r
              WHERE r.counterparty = transactions.counterparty) IS NULL)
          )
          OR transactions.shared_with != (
            SELECT shared_with FROM merchant_share_rules r
            WHERE r.counterparty = transactions.counterparty
          )
        )
    `),
  );

  return { swept: total };
}

// ============================================================================
// /review/split — queue rows for the split-focused review surface
// ============================================================================

/**
 * One row of the split-review queue. Cluster around what the user
 * needs to make a split decision quickly:
 *
 *   - who paid (always "me" today — txns are debits from my account),
 *   - to whom (the counterparty, with kind so we know if it's a person),
 *   - amount and date,
 *   - which queue reason placed this row here (drives section header
 *     + the suggested action label),
 *   - the suggested split (if any) — pre-resolved to the matching
 *     person display name so the UI doesn't need to look it up,
 *   - the user-visible recurrence label (so we can hint "monthly").
 */
export interface SplitQueueRow {
  id: number;
  txnDate: string;
  txnTime: string | null;
  amount: number;
  direction: "debit" | "credit";
  counterparty: string;
  counterpartyKind: string | null;
  personId: string | null;
  category: string | null;
  recurrence: string | null;
  /** Why this row is in the queue. Same row may match multiple
   *  reasons — we tag the one that's the strongest signal so the
   *  section header is meaningful. */
  reason: "person" | "large" | "recurring";
  /** Display name of the person we'd default the split to. Null when
   *  no obvious split target exists (e.g. a large Zepto order). */
  suggestedSplitWith: string | null;
}

/**
 * Compose the split-review queue from three independent filters:
 *
 *   1. Person-kind un-split            — the canonical split candidate
 *   2. Large un-reviewed (>= threshold) — anything sizable to check
 *   3. Recurring monthly w/ a person    — rent/utility-shaped flows
 *
 * Each row is tagged with the strongest matching reason for its
 * section header. Rows that satisfy multiple reasons (e.g. a large
 * monthly person txn) are de-duped — the priority order is
 * person > recurring > large so the UI surfaces the most actionable
 * framing.
 *
 * Reviewed=1 rows are excluded throughout. The queue is intentionally
 * un-paginated for now — local dataset, max a few hundred rows.
 */
export async function getSplitQueueRows(
  largeThreshold: number = 1000,
): Promise<SplitQueueRow[]> {
  const db = openDb();
  // Pull the union once, then categorize in JS. Cheaper than three
  // round-trips since most predicates hit the same indexed columns.
  const rows = db.all<{
    id: number;
    txn_date: string;
    txn_time: string | null;
    withdrawal: number | null;
    deposit: number | null;
    counterparty: string;
    counterparty_kind: string | null;
    person_id: string | null;
    category: string | null;
    recurrence: string | null;
    share_count: number | null;
  }>(sql`
    SELECT id, txn_date, txn_time, withdrawal, deposit,
           counterparty, counterparty_kind, person_id, category,
           recurrence, share_count
    FROM transactions
    WHERE reviewed = 0
      AND counterparty IS NOT NULL
      AND counterparty != ''
      AND (
        -- (1) Person-kind un-split
        (counterparty_kind = 'person' AND (share_count IS NULL OR share_count = 1))
        -- (2) Large un-reviewed
        OR (COALESCE(withdrawal, deposit, 0) >= ${largeThreshold})
        -- (3) Recurring monthly with a person
        OR (recurrence IN ('monthly', 'weekly', 'quarterly')
            AND counterparty_kind = 'person')
      )
    ORDER BY txn_date DESC, COALESCE(txn_time, '00:00') DESC, id DESC
  `);

  // Pre-resolve suggested-split target display names. We hit
  // DEFAULT_PEOPLE in core for the canonical id→name map.
  const { DEFAULT_PEOPLE } = await import("@splitlens/core");
  const personIdToName = new Map(
    DEFAULT_PEOPLE.map((p: { id: string; displayName: string }) => [
      p.id,
      p.displayName,
    ]),
  );

  return rows.map((r) => {
    const amount = r.withdrawal ?? r.deposit ?? 0;
    const direction: "debit" | "credit" = r.withdrawal ? "debit" : "credit";
    // Priority: person > recurring > large.
    let reason: SplitQueueRow["reason"] = "large";
    if (r.counterparty_kind === "person") {
      reason =
        r.recurrence === "monthly" ||
        r.recurrence === "weekly" ||
        r.recurrence === "quarterly"
          ? "recurring"
          : "person";
    }
    const suggestedSplitWith =
      r.person_id && personIdToName.get(r.person_id)
        ? personIdToName.get(r.person_id)!
        : null;
    return {
      id: r.id,
      txnDate: r.txn_date,
      txnTime: r.txn_time,
      amount,
      direction,
      counterparty: r.counterparty,
      counterpartyKind: r.counterparty_kind,
      personId: r.person_id,
      category: r.category,
      recurrence: r.recurrence,
      reason,
      suggestedSplitWith,
    };
  });
}

/**
 * Fetch the active rule state for a counterparty (all three
 * dimensions). Drives the InboxModal's pre-fill of the bulk-apply
 * toggle defaults so the UI reflects what's already set.
 */
export interface MerchantRuleState {
  category: string | null;
  recurrence: string | null;
  sharedWith: string[] | null;
  shareCount: number | null;
}

export async function getMerchantRuleState(
  counterparty: string,
): Promise<MerchantRuleState> {
  const cp = counterparty.trim();
  if (!cp)
    return { category: null, recurrence: null, sharedWith: null, shareCount: null };

  const cat = db().get<{ category: string }>(sql`
    SELECT category FROM merchant_category_rules WHERE counterparty = ${cp}
  `);
  const rec = db().get<{ recurrence: string }>(sql`
    SELECT recurrence FROM merchant_recurrence_rules WHERE counterparty = ${cp}
  `);
  const shr = db().get<{ shared_with: string | null; share_count: number }>(sql`
    SELECT shared_with, share_count FROM merchant_share_rules
    WHERE counterparty = ${cp}
  `);

  let parsedShared: string[] | null = null;
  if (shr?.shared_with) {
    try {
      const parsed = JSON.parse(shr.shared_with);
      if (Array.isArray(parsed)) parsedShared = parsed.map(String);
    } catch {
      // Malformed JSON in shared_with — treat as no list.
      parsedShared = null;
    }
  }

  return {
    category: cat?.category ?? null,
    recurrence: rec?.recurrence ?? null,
    sharedWith: parsedShared,
    shareCount: shr?.share_count ?? null,
  };
}

/** 1–2 char avatar text. Persons use first letters of words; businesses use the leading char. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// ============================================================================
// Client-side filtering — bulk loaders
//
// Apple-instant filter clicks on /review require the whole txn dataset to be
// available in the browser. The server queries below pull EVERYTHING once,
// then the client computes filters, buckets, and aggregates synchronously in
// React's render pass. Each filter click becomes a pure useMemo recompute
// instead of a network round-trip.
// ============================================================================

/** One row of the txn ledger, fattened with every column the client filter
 *  + aggregation logic needs. Mirrors ReviewListRow but carries the few
 *  extra fields that the filter predicates check (personId, accountId,
 *  shareCount, recurrence, counterpartyKind). */
export interface ClientReviewRow {
  id: number;
  accountId: number;
  txnDate: string; // YYYY-MM-DD
  txnTime: string | null; // HH:MM
  /** Positive amount; direction tells you the sign. */
  amount: number;
  direction: "debit" | "credit";
  counterparty: string | null;
  counterpartyKind: string | null;
  personId: string | null;
  narration: string | null;
  category: string | null;
  shareCount: number;
  reviewed: boolean;
  recurrence: string | null;
  sourceCount: number;
  hasReceipt: boolean;
}

/** Per-counterparty context that doesn't depend on the active filter —
 *  lifetime counts and the trailing-12-months sparkline. Cached on the
 *  client because computing these requires scanning the whole ledger. */
export interface ClientMerchantContext {
  counterparty: string;
  lifetimeCount: number;
  /** 12 monthly counts, oldest → newest, ending in the current month. */
  sparkline: number[];
}

/**
 * Load every txn in the ledger as plain client-shaped rows. No filter, no
 * limit. The client uses this to drive instant filter/bucket recomputes;
 * the server still owns the per-row detail fetch (getTransactionForReview).
 *
 * Payload size: ~150 bytes/row × N rows. At 10k rows we're at ~1.5MB raw,
 * ~350KB gzipped — fine for local-first.
 */
export async function getAllClientReviewRows(): Promise<ClientReviewRow[]> {
  const rows = db().all<{
    id: number;
    account_id: number;
    txn_date: string;
    txn_time: string | null;
    withdrawal: number | null;
    deposit: number | null;
    counterparty: string | null;
    counterparty_kind: string | null;
    person_id: string | null;
    narration: string | null;
    category: string | null;
    share_count: number;
    reviewed: number;
    recurrence: string | null;
    source_count: number;
    has_receipt: number;
  }>(sql`
    SELECT t.id, t.account_id, t.txn_date, t.txn_time, t.withdrawal, t.deposit,
           t.counterparty, t.counterparty_kind, t.person_id, t.narration,
           t.category, t.share_count, t.reviewed, t.recurrence,
           (SELECT count(DISTINCT source_type) FROM transaction_sources
              WHERE transaction_id = t.id) AS source_count,
           EXISTS (
             SELECT 1 FROM transaction_sources s
             WHERE s.transaction_id = t.id
               AND s.source_type IN ('zepto_invoice', 'swiggy_email', 'zomato_email',
                                     'zepto_ocr', 'blinkit_ocr', 'instamart_ocr')
           ) AS has_receipt
    FROM transactions t
    ORDER BY t.txn_date DESC, COALESCE(t.txn_time, '00:00') DESC, t.id DESC
  `);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    txnDate: r.txn_date,
    txnTime: r.txn_time,
    amount: r.withdrawal ?? r.deposit ?? 0,
    direction: r.withdrawal ? "debit" : "credit",
    counterparty: r.counterparty,
    counterpartyKind: r.counterparty_kind,
    personId: r.person_id,
    narration: r.narration,
    category: r.category,
    shareCount: r.share_count,
    reviewed: !!r.reviewed,
    recurrence: r.recurrence,
    sourceCount: Number(r.source_count),
    hasReceipt: !!r.has_receipt,
  }));
}

/**
 * Lifetime + 12-month sparkline per counterparty. Filter-independent, so
 * we load it once at page boot. The client zips this with the active
 * filter's per-merchant slice to produce the rich by-merchant rows.
 */
export async function getAllMerchantContexts(): Promise<ClientMerchantContext[]> {
  // 12 axis months ending in the current month.
  const now = new Date();
  const axis: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    axis.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  const oldestYm = axis[0];

  const lifetime = db().all<{ counterparty: string; n: number }>(sql`
    SELECT counterparty, count(*) AS n
    FROM transactions
    WHERE counterparty IS NOT NULL AND counterparty != ''
    GROUP BY counterparty
  `);

  const monthly = db().all<{
    counterparty: string;
    ym: string;
    n: number;
  }>(sql`
    SELECT counterparty, substr(txn_date, 1, 7) AS ym, count(*) AS n
    FROM transactions
    WHERE counterparty IS NOT NULL AND counterparty != ''
      AND txn_date >= ${oldestYm + "-01"}
    GROUP BY counterparty, substr(txn_date, 1, 7)
  `);

  const sparkByMerchant = new Map<string, number[]>();
  for (const r of monthly) {
    const arr = sparkByMerchant.get(r.counterparty) ?? new Array(12).fill(0);
    const idx = axis.indexOf(r.ym);
    if (idx >= 0) arr[idx] = Number(r.n);
    sparkByMerchant.set(r.counterparty, arr);
  }
  return lifetime.map((r) => ({
    counterparty: r.counterparty,
    lifetimeCount: Number(r.n),
    sparkline: sparkByMerchant.get(r.counterparty) ?? new Array(12).fill(0),
  }));
}
