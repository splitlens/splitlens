/**
 * Pure helper that turns a flat row list + the current time selection into
 * a set of horizontally-scrollable columns. The column granularity follows
 * the user's zoom level:
 *
 *   Year selected (no month)  →  month columns (1..12 within the year)
 *   Month selected (no day)   →  day columns (1..N within the month)
 *
 * Other selections (no year, day selected) return `null` so the caller
 * falls back to the existing vertical list layout — at those zoom levels
 * horizontal columns either don't have a natural unit (all-time) or have
 * too few entries to be useful (single day).
 *
 * The full calendar grid is materialized — empty columns are kept and
 * marked `empty: true` so the timeline reads as a continuous strip of
 * days/months (gaps visible) rather than a jagged "only days with data"
 * view. The visual cost of empty columns is low and the navigation feel
 * is much better.
 */
import type { ReviewListRow, TimeBuckets } from "@/lib/review-repo";
import { MONTH_SHORT } from "@/lib/review-time";

const DAY_OF_WEEK_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type TimelineGranularity = "month" | "day";

export interface TimelineColumn {
  /** Stable React key + the key into row groupings. */
  key: string;
  /** Primary header label, e.g. "Wed 29" or "Apr". */
  primaryLabel: string;
  /** Secondary header label, e.g. "Apr 2026" or "2026". Used as a smaller line. */
  secondaryLabel: string;
  /** Pre-grouped rows for this column. */
  rows: ReviewListRow[];
  /** Sum of debit amounts for this column. Convenient for the header. */
  debitTotal: number;
  /** Empty columns (calendar gaps) — rendered with a placeholder. */
  empty: boolean;
  /** True when any row in this column matches the active id. */
  hasActive: boolean;
}

export interface TimelineLayout {
  granularity: TimelineGranularity;
  columns: TimelineColumn[];
}

/**
 * Returns a timeline layout when the current selection warrants one;
 * otherwise `null` and the caller renders a vertical list.
 */
export function buildTimelineColumns(
  rows: ReviewListRow[],
  buckets: TimeBuckets,
  activeId: number | null,
): TimelineLayout | null {
  const { selectedYear, selectedMonth, selectedDay } = buckets;

  // Day selected (or no year) → no timeline.
  if (selectedYear == null) return null;
  if (selectedMonth != null && selectedDay != null) return null;

  if (selectedMonth == null) {
    // YEAR view → month columns.
    const groups = groupRowsBy(rows, (r) => r.txnDate.slice(0, 7)); // YYYY-MM
    const columns: TimelineColumn[] = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${selectedYear}-${String(m).padStart(2, "0")}`;
      const colRows = groups.get(key) ?? [];
      columns.push({
        key,
        primaryLabel: MONTH_SHORT[m - 1]!,
        secondaryLabel: String(selectedYear),
        rows: colRows,
        debitTotal: sumDebits(colRows),
        empty: colRows.length === 0,
        hasActive: colRows.some((r) => r.id === activeId),
      });
    }
    return { granularity: "month", columns };
  }

  // MONTH view → day columns.
  const lastDay = new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate();
  const groups = groupRowsBy(rows, (r) => r.txnDate); // YYYY-MM-DD
  const columns: TimelineColumn[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const key = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const colRows = groups.get(key) ?? [];
    const dow = new Date(Date.UTC(selectedYear, selectedMonth - 1, d)).getUTCDay();
    columns.push({
      key,
      primaryLabel: `${DAY_OF_WEEK_SHORT[dow]} ${d}`,
      secondaryLabel: `${MONTH_SHORT[selectedMonth - 1]} ${selectedYear}`,
      rows: colRows,
      debitTotal: sumDebits(colRows),
      empty: colRows.length === 0,
      hasActive: colRows.some((r) => r.id === activeId),
    });
  }
  return { granularity: "day", columns };
}

function groupRowsBy<T extends ReviewListRow, K>(
  rows: T[],
  keyFn: (r: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = keyFn(r);
    let arr = out.get(k);
    if (!arr) {
      arr = [];
      out.set(k, arr);
    }
    arr.push(r);
  }
  return out;
}

function sumDebits(rows: ReviewListRow[]): number {
  let s = 0;
  for (const r of rows) if (r.direction === "debit") s += r.amount;
  return s;
}
