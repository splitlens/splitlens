/**
 * Client-side filter, bucket, and aggregate logic for /review.
 *
 * The server loads ALL txns once via `getAllClientReviewRows()` and a
 * per-counterparty lifetime/sparkline context via `getAllMerchantContexts()`.
 * Every subsequent filter click on /review runs the helpers here over the
 * cached row set, in React's render pass — so the scrubber, txn list, and
 * by-merchant view all update on the same frame as the click.
 *
 * Mirrors the SQL filter predicates + bucketing in review-repo.ts. Any
 * change to the filter shape needs to land in both places, but the SQL
 * version is now only used for the initial bulk loaders, not for hot-path
 * filter recomputes.
 */
import type {
  ClientMerchantContext,
  ClientReviewRow,
  ReviewListFilter,
  ReviewListRow,
  ReviewListResult,
  MerchantAggregate,
  TimeBuckets,
} from "./review-repo";

// ──────────────────────────────────────────────────────────────────────────
// Filter
// ──────────────────────────────────────────────────────────────────────────

/** Returns rows that pass every active predicate in `filter`. Fields left
 *  null/undefined act as no-op. */
export function applyClientFilter(
  rows: ClientReviewRow[],
  filter: ReviewListFilter,
): ClientReviewRow[] {
  const q = filter.q?.trim().toLowerCase() ?? null;
  const tod = filter.timeOfDay ?? null;
  return rows.filter((r) => {
    if (filter.from && r.txnDate < filter.from) return false;
    if (filter.to && r.txnDate > filter.to) return false;
    if (filter.category && r.category !== filter.category) return false;
    if (filter.unreviewedOnly && r.reviewed) return false;
    if (filter.personId && r.personId !== filter.personId) return false;
    if (filter.accountId != null && r.accountId !== filter.accountId) return false;
    if (filter.shareStatus === "personal" && r.shareCount > 1) return false;
    if (filter.shareStatus === "shared" && r.shareCount <= 1) return false;
    if (
      filter.recurrenceClass === "one_time" &&
      r.recurrence != null &&
      r.recurrence !== "one_time"
    )
      return false;
    if (
      filter.recurrenceClass === "recurring" &&
      (r.recurrence == null || r.recurrence === "one_time")
    )
      return false;
    if (q) {
      const cp = r.counterparty?.toLowerCase() ?? "";
      const nar = r.narration?.toLowerCase() ?? "";
      if (!cp.includes(q) && !nar.includes(q)) return false;
    }
    if (tod && r.txnTime) {
      const t = r.txnTime;
      if (tod === "morning" && !(t >= "06:00" && t < "12:00")) return false;
      if (tod === "afternoon" && !(t >= "12:00" && t < "17:00")) return false;
      if (tod === "evening" && !(t >= "17:00" && t < "21:00")) return false;
      if (tod === "night" && !(t >= "21:00" || t < "06:00")) return false;
    } else if (tod && !r.txnTime) {
      return false;
    }
    return true;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Materialize → ReviewListResult (shape the existing UI expects)
// ──────────────────────────────────────────────────────────────────────────

/** Convert filtered client rows into the legacy ReviewListResult shape so
 *  the existing UI components don't have to change. Sort order matches
 *  the SQL: by date desc unless explicitly asc, then time desc, then id. */
export function buildReviewListResult(
  allRows: ClientReviewRow[],
  filtered: ClientReviewRow[],
  filter: ReviewListFilter,
): ReviewListResult {
  const limit = Math.min(filter.limit ?? 200, 500);
  const asc = filter.sort === "asc";
  const sorted = [...filtered].sort((a, b) => {
    const dd = a.txnDate.localeCompare(b.txnDate);
    if (dd !== 0) return asc ? dd : -dd;
    const tt = (a.txnTime ?? "00:00").localeCompare(b.txnTime ?? "00:00");
    if (tt !== 0) return asc ? tt : -tt;
    return asc ? a.id - b.id : b.id - a.id;
  });
  const rows: ReviewListRow[] = sorted.slice(0, limit).map((r) => ({
    id: r.id,
    txnDate: r.txnDate,
    txnTime: r.txnTime,
    amount: r.amount,
    direction: r.direction,
    counterparty: r.counterparty,
    narration: r.narration,
    category: r.category,
    reviewed: r.reviewed,
    sourceCount: r.sourceCount,
    hasReceipt: r.hasReceipt,
  }));

  let totalDebit = 0;
  let totalCredit = 0;
  let totalUnreviewed = 0;
  for (const r of filtered) {
    if (r.direction === "debit") totalDebit += r.amount;
    else totalCredit += r.amount;
    if (!r.reviewed) totalUnreviewed += 1;
  }
  const ledgerTotal = allRows.length;
  const ledgerReviewed = allRows.reduce((s, r) => s + (r.reviewed ? 1 : 0), 0);

  const { chartBuckets, chartGranularity } = computeChartBucketsClient(
    filtered,
    filter,
  );

  return {
    rows,
    totalMatching: filtered.length,
    totalUnreviewed,
    ledgerTotal,
    ledgerReviewed,
    totalDebit,
    totalCredit,
    chartBuckets,
    chartGranularity,
    monthDimensions: null, // not needed for the live filter path
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Chart buckets (for the timeline summary inside the layout, if used)
// ──────────────────────────────────────────────────────────────────────────

function computeChartBucketsClient(
  rows: ClientReviewRow[],
  filter: ReviewListFilter,
): {
  chartBuckets: ReviewListResult["chartBuckets"];
  chartGranularity: ReviewListResult["chartGranularity"];
} {
  // Granularity rule — same as the SQL version.
  const sameDay = filter.from && filter.to && filter.from === filter.to;
  const sameMonth =
    filter.from && filter.to && filter.from.slice(0, 7) === filter.to.slice(0, 7);
  const sameYear =
    filter.from && filter.to && filter.from.slice(0, 4) === filter.to.slice(0, 4);
  let granularity: ReviewListResult["chartGranularity"];
  if (sameDay) granularity = "hour";
  else if (sameMonth) granularity = "day";
  else if (sameYear) granularity = "month";
  else granularity = "yearmonth";

  const buckets = new Map<string, { debit: number; credit: number; count: number }>();
  for (const r of rows) {
    let key: string;
    let label: string;
    if (granularity === "hour") {
      const h = r.txnTime ? r.txnTime.slice(0, 2) : "??";
      key = h;
      label = h === "??" ? "—" : `${h}:00`;
    } else if (granularity === "day") {
      key = r.txnDate.slice(8, 10);
      label = String(parseInt(key, 10));
    } else if (granularity === "month") {
      key = r.txnDate.slice(5, 7);
      const idx = parseInt(key, 10) - 1;
      label = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ][idx] ?? key;
    } else {
      key = r.txnDate.slice(0, 7);
      const [, m] = key.split("-");
      const idx = parseInt(m ?? "", 10) - 1;
      const ms = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      label = `${ms[idx] ?? m} ’${key.slice(2, 4)}`;
    }
    const cur =
      buckets.get(key) ?? { debit: 0, credit: 0, count: 0 };
    if (r.direction === "debit") cur.debit += r.amount;
    else cur.credit += r.amount;
    cur.count += 1;
    buckets.set(key, cur);
  }
  const out = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      label: keyToLabel(key, granularity),
      debit: v.debit,
      credit: v.credit,
      count: v.count,
    }));
  return { chartBuckets: out, chartGranularity: granularity };
}

function keyToLabel(
  key: string,
  granularity: ReviewListResult["chartGranularity"],
): string {
  if (granularity === "hour")
    return key === "??" ? "—" : `${key}:00`;
  if (granularity === "day") return String(parseInt(key, 10));
  if (granularity === "month") {
    const idx = parseInt(key, 10) - 1;
    return (
      [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ][idx] ?? key
    );
  }
  const [, m] = key.split("-");
  const idx = parseInt(m ?? "", 10) - 1;
  const ms = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${ms[idx] ?? m} ’${key.slice(2, 4)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Scrubber buckets — months strip + day grid + active-month metadata
// ──────────────────────────────────────────────────────────────────────────

/** Compute the TimeBuckets shape from the unfiltered row set. The strip is
 *  filter-independent (it's the user's navigation tool, not a result), so
 *  we pass ALL rows here. Mirrors the server `getTimeBuckets`. */
export function buildClientTimeBuckets(
  allRows: ClientReviewRow[],
  filter: ReviewListFilter,
): TimeBuckets {
  // Active year/month/day: derive from `from`/`to`.
  let selectedYear: number | null = null;
  let selectedMonth: number | null = null;
  let selectedDay: number | null = null;
  if (filter.from && filter.to) {
    const [fy, fm, fd] = filter.from.split("-").map(Number);
    const [ty, tm, td] = filter.to.split("-").map(Number);
    if (fy && ty && fy === ty) {
      selectedYear = fy;
      if (fm && tm && fm === tm) {
        selectedMonth = fm;
        if (fd && td && fd === td) selectedDay = fd;
      }
    }
  } else if (filter.from) {
    const [y, m, d] = filter.from.split("-").map(Number);
    selectedYear = y ?? null;
    selectedMonth = m ?? null;
    selectedDay = d ?? null;
  }

  // Year + month + recent-month strips. recentMonths spans every month
  // with activity (sorted ascending), not just the last 12 — matches
  // the server contract.
  const yearMap = new Map<number, number>();
  const monthMap = new Map<string, { count: number; unreviewed: number }>();
  for (const r of allRows) {
    const [y, m] = r.txnDate.split("-").map(Number);
    if (!y || !m) continue;
    yearMap.set(y, (yearMap.get(y) ?? 0) + 1);
    const ym = r.txnDate.slice(0, 7);
    const cur = monthMap.get(ym) ?? { count: 0, unreviewed: 0 };
    cur.count += 1;
    if (!r.reviewed) cur.unreviewed += 1;
    monthMap.set(ym, cur);
  }
  const years = Array.from(yearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, count]) => ({ year, count }));
  const recentMonths = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, v]) => {
      const [y, m] = ym.split("-").map(Number);
      return {
        year: y ?? 0,
        month: m ?? 0,
        count: v.count,
        unreviewed: v.unreviewed,
      };
    });

  // Months within selected year.
  const months = selectedYear
    ? Array.from({ length: 12 }, (_, i) => {
        const ym = `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
        return {
          year: selectedYear!,
          month: i + 1,
          count: monthMap.get(ym)?.count ?? 0,
        };
      }).filter((m) => m.count > 0)
    : [];

  // Day grid for the selected month (or latest if none selected).
  const target =
    selectedYear && selectedMonth
      ? { year: selectedYear, month: selectedMonth }
      : recentMonths.length > 0
        ? {
            year: recentMonths[recentMonths.length - 1]!.year,
            month: recentMonths[recentMonths.length - 1]!.month,
          }
        : null;
  const days: TimeBuckets["days"] = [];
  if (target) {
    const lastDay = new Date(
      Date.UTC(target.year, target.month, 0),
    ).getUTCDate();
    const dayCounts = new Array(31).fill(0);
    const ymPrefix = `${target.year}-${String(target.month).padStart(2, "0")}-`;
    for (const r of allRows) {
      if (!r.txnDate.startsWith(ymPrefix)) continue;
      const d = parseInt(r.txnDate.slice(8, 10), 10);
      if (d >= 1 && d <= 31) dayCounts[d - 1] += 1;
    }
    for (let d = 1; d <= lastDay; d++) {
      days.push({
        year: target.year,
        month: target.month,
        day: d,
        count: dayCounts[d - 1] ?? 0,
      });
    }
  }

  // Time-of-day buckets for the selected day. Same logic as the server:
  // counts run against ALL rows in the active filter regardless of the
  // current time-of-day filter, so the bucket bar is informational.
  const timeOfDay: TimeBuckets["timeOfDay"] = [];
  if (selectedYear && selectedMonth && selectedDay) {
    const date = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
    let morning = 0, afternoon = 0, evening = 0, night = 0;
    for (const r of allRows) {
      if (r.txnDate !== date || !r.txnTime) continue;
      const t = r.txnTime;
      if (t >= "06:00" && t < "12:00") morning += 1;
      else if (t >= "12:00" && t < "17:00") afternoon += 1;
      else if (t >= "17:00" && t < "21:00") evening += 1;
      else night += 1;
    }
    timeOfDay.push(
      { bucket: "morning", count: morning },
      { bucket: "afternoon", count: afternoon },
      { bucket: "evening", count: evening },
      { bucket: "night", count: night },
    );
  }

  return {
    years,
    months,
    recentMonths,
    days,
    timeOfDay,
    selectedYear,
    selectedMonth,
    selectedDay,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Per-merchant aggregates for the by-merchant view
// ──────────────────────────────────────────────────────────────────────────

const UNKNOWN_MERCHANT_KEY = "—";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** Compute MerchantAggregate[] from the in-filter rows zipped with the
 *  pre-loaded per-counterparty lifetime context. Sorted by absolute flow
 *  desc — biggest impact first. */
export function buildClientMerchantAggregates(
  filteredRows: ClientReviewRow[],
  contexts: ClientMerchantContext[],
): MerchantAggregate[] {
  const ctxByName = new Map<string, ClientMerchantContext>();
  for (const c of contexts) ctxByName.set(c.counterparty, c);

  type Bucket = {
    counterparty: string;
    kind: "person" | "business";
    personId: string | null;
    category: Map<string, number>;
    rawNarrationSample: string | null;
    countInFilter: number;
    sumDebitInFilter: number;
    sumCreditInFilter: number;
    lastSeenInFilter: string;
    recurring: boolean;
  };
  const map = new Map<string, Bucket>();

  for (const r of filteredRows) {
    if (!r.counterparty) continue;
    let b = map.get(r.counterparty);
    if (!b) {
      const kind: Bucket["kind"] =
        r.counterpartyKind === "person" || r.personId
          ? "person"
          : "business";
      b = {
        counterparty: r.counterparty,
        kind,
        personId: kind === "person" ? r.personId : null,
        category: new Map(),
        rawNarrationSample: r.narration,
        countInFilter: 0,
        sumDebitInFilter: 0,
        sumCreditInFilter: 0,
        lastSeenInFilter: r.txnDate,
        recurring: false,
      };
      map.set(r.counterparty, b);
    }
    b.countInFilter += 1;
    if (r.direction === "debit") b.sumDebitInFilter += r.amount;
    else b.sumCreditInFilter += r.amount;
    if (r.txnDate > b.lastSeenInFilter) b.lastSeenInFilter = r.txnDate;
    if (r.category) {
      b.category.set(r.category, (b.category.get(r.category) ?? 0) + 1);
    }
    if (r.recurrence && r.recurrence !== "one_time") b.recurring = true;
  }

  const out: MerchantAggregate[] = [];
  for (const b of map.values()) {
    let topCat: string | null = null;
    let topCount = 0;
    for (const [cat, n] of b.category) {
      if (n > topCount) {
        topCount = n;
        topCat = cat;
      }
    }
    const ctx = ctxByName.get(b.counterparty);
    const spark = ctx?.sparkline ?? new Array(12).fill(0);
    const mean = spark.reduce((s, n) => s + n, 0) / 12;
    const hot = mean > 0
      ? spark
          .map((n, i) => (n > mean * 1.5 ? i : -1))
          .filter((i) => i >= 0)
      : [];
    const slug =
      b.kind === "person" && b.personId ? b.personId : b.counterparty;
    out.push({
      slug,
      counterparty: b.counterparty,
      kind: b.kind,
      personId: b.personId,
      displayName: b.counterparty,
      initials: initialsFor(b.counterparty),
      category: topCat,
      recurring: b.recurring,
      rawNarrationSample: b.rawNarrationSample,
      countInFilter: b.countInFilter,
      sumDebitInFilter: b.sumDebitInFilter,
      sumCreditInFilter: b.sumCreditInFilter,
      lastSeenInFilter: b.lastSeenInFilter,
      lifetimeCount: ctx?.lifetimeCount ?? b.countInFilter,
      sparkline: spark,
      sparkHighlights: hot,
    });
  }
  out.sort(
    (a, b) =>
      b.sumDebitInFilter +
      b.sumCreditInFilter -
      (a.sumDebitInFilter + a.sumCreditInFilter),
  );
  return out;
}

// Re-export so the page + layout import from one place.
export { UNKNOWN_MERCHANT_KEY };
