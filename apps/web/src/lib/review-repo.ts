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
import { deriveSelection } from "./review-time";

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
  };
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
  notes: string | null;
  reviewed: boolean;
  linkedTxnId: number | null;
  account: { id: number; bank: string; type: string; last4: string };
  sources: ReviewSource[];
  /** If a transaction_sources row links to a separate physical file, the file's location. */
  attachedFiles: Array<{ sourceType: string; path: string }>;
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
    notes: t.notes,
    reviewed: Boolean(t.reviewed),
    linkedTxnId: t.linked_txn_id,
    account: { id: t.account_id, bank: t.bank, type: t.type, last4: t.last4 },
    sources: decoded,
    attachedFiles,
  };
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
