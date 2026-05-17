/**
 * Pure helpers for /review's time-navigator. No DB, no I/O, no React —
 * shared between the server query (review-repo.ts) and the client-side
 * TimeNavigator component, so the selection logic stays in one place.
 */

export interface TimeSelection {
  selectedYear: number | null;
  selectedMonth: number | null;
  selectedDay: number | null;
}

/**
 * Map a (from, to) date range to a "selection" tuple. The TimeNavigator
 * encodes its state as from/to URL params (no separate "year=" param)
 * because those are already what the list query uses.
 *
 *   from = to = YYYY-MM-DD                  → day selected
 *   from = YYYY-MM-01, to = YYYY-MM-<last>  → month selected
 *   from = YYYY-01-01, to = YYYY-12-31      → year selected
 *   anything else                           → nothing
 */
export function deriveSelection(
  from: string | null | undefined,
  to: string | null | undefined,
): TimeSelection {
  if (!from || !to) {
    return { selectedYear: null, selectedMonth: null, selectedDay: null };
  }
  if (from === to) {
    const [y, m, d] = from.split("-");
    return {
      selectedYear: Number(y),
      selectedMonth: Number(m),
      selectedDay: Number(d),
    };
  }
  const fp = from.split("-");
  const tp = to.split("-");
  if (
    fp[0] === tp[0] &&
    fp[1] === tp[1] &&
    fp[2] === "01" &&
    isLastDayOfMonth(to)
  ) {
    return {
      selectedYear: Number(fp[0]),
      selectedMonth: Number(fp[1]),
      selectedDay: null,
    };
  }
  if (
    fp[0] === tp[0] &&
    fp[1] === "01" &&
    fp[2] === "01" &&
    tp[1] === "12" &&
    tp[2] === "31"
  ) {
    return {
      selectedYear: Number(fp[0]),
      selectedMonth: null,
      selectedDay: null,
    };
  }
  return { selectedYear: null, selectedMonth: null, selectedDay: null };
}

/** Inverse of deriveSelection — turn a selection back into a from/to range. */
export function rangeForSelection(args: {
  year: number | null;
  month: number | null;
  day: number | null;
}): { from: string | null; to: string | null } {
  if (args.year == null) return { from: null, to: null };
  if (args.month == null) {
    return { from: `${args.year}-01-01`, to: `${args.year}-12-31` };
  }
  const mm = String(args.month).padStart(2, "0");
  if (args.day == null) {
    const last = new Date(Date.UTC(args.year, args.month, 0)).getUTCDate();
    return {
      from: `${args.year}-${mm}-01`,
      to: `${args.year}-${mm}-${String(last).padStart(2, "0")}`,
    };
  }
  const dd = String(args.day).padStart(2, "0");
  return { from: `${args.year}-${mm}-${dd}`, to: `${args.year}-${mm}-${dd}` };
}

export function isLastDayOfMonth(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === last;
}

export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
