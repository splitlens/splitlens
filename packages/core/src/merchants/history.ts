/**
 * Aggregate a set of transactions from the same merchant into a "merchant
 * history" summary — the data behind the right-pane "you have charged ₹X
 * total over Y months at cadence Z" panel.
 *
 * Pure function over a generic transaction shape so this stays usable from
 * tests, CLI tools, and any future surface that wants merchant context
 * without dragging the SQLite client along.
 */

import {
  detectCadence,
  projectNextCharge,
  type CadenceResult,
} from "./cadence";

/**
 * Minimum fields needed to summarise. The repo layer projects DB rows into
 * this shape before calling. `amountInr` is the absolute rupee amount —
 * direction (debit vs credit) is irrelevant for merchant pattern detection.
 */
export interface MerchantTxnLite {
  id: number;
  /** ISO YYYY-MM-DD */
  date: string;
  /** Absolute INR amount (positive integer or 0). */
  amountInr: number;
}

/**
 * A distinct amount you've been charged by this merchant, with how often
 * and when last. We round to the nearest rupee so a one-paisa jitter
 * doesn't fracture "₹159" into two groups.
 */
export interface DistinctAmount {
  amountInr: number;
  count: number;
  /** ISO YYYY-MM-DD of the most recent charge at this amount. */
  lastDate: string;
  /** True if this group includes the focused transaction. */
  containsFocus: boolean;
}

export interface MerchantHistory {
  /** Number of distinct (deduped) calendar days the merchant has charged. */
  count: number;
  /** Sum of all amounts in INR (rounded). */
  totalSpentInr: number;
  /** Smallest single-charge amount (rounded). */
  minAmountInr: number;
  /** Median single-charge amount (rounded). */
  medianAmountInr: number;
  /** Largest single-charge amount (rounded). */
  maxAmountInr: number;
  /** Earliest ISO date. */
  firstSeen: string;
  /** Latest ISO date. */
  lastSeen: string;
  /** Distinct amounts charged, sorted by count desc then amount desc. */
  distinctAmounts: DistinctAmount[];
  /** Detected cadence across the full history. */
  cadence: CadenceResult;
  /** ISO date of the next expected charge, when projectable. */
  nextExpectedDate: string | null;
}

/**
 * Compute a merchant summary from a set of same-merchant transactions.
 *
 * `focusTxnId` is the row currently being reviewed, used to mark which
 * distinct-amount group contains it ("← this one" in the UI).
 */
export function summarizeMerchant(
  rows: ReadonlyArray<MerchantTxnLite>,
  focusTxnId: number | null = null,
): MerchantHistory | null {
  if (rows.length === 0) return null;

  // Sort ascending by date for first/last and stable iteration.
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const amounts = sorted.map((r) => Math.round(r.amountInr));
  const totalSpent = amounts.reduce((s, a) => s + a, 0);
  const medianAmount = medianOf(amounts);
  let minAmount = amounts[0]!;
  let maxAmount = amounts[0]!;
  for (const a of amounts) {
    if (a < minAmount) minAmount = a;
    if (a > maxAmount) maxAmount = a;
  }

  // Group by rounded INR amount.
  const buckets = new Map<number, { count: number; lastDate: string; containsFocus: boolean }>();
  for (const r of sorted) {
    const key = Math.round(r.amountInr);
    const existing = buckets.get(key);
    const isFocus = focusTxnId != null && r.id === focusTxnId;
    if (existing) {
      existing.count += 1;
      // sorted ascending → later iterations have later dates
      existing.lastDate = r.date;
      if (isFocus) existing.containsFocus = true;
    } else {
      buckets.set(key, { count: 1, lastDate: r.date, containsFocus: isFocus });
    }
  }

  const distinctAmounts: DistinctAmount[] = [...buckets.entries()]
    .map(([amountInr, v]) => ({
      amountInr,
      count: v.count,
      lastDate: v.lastDate,
      containsFocus: v.containsFocus,
    }))
    .sort((a, b) => b.count - a.count || b.amountInr - a.amountInr);

  const cadence = detectCadence(sorted.map((r) => r.date));
  const lastSeen = sorted[sorted.length - 1]!.date;
  const firstSeen = sorted[0]!.date;
  const nextExpectedDate = projectNextCharge(lastSeen, cadence);

  return {
    count: sorted.length,
    totalSpentInr: totalSpent,
    minAmountInr: minAmount,
    medianAmountInr: medianAmount,
    maxAmountInr: maxAmount,
    firstSeen,
    lastSeen,
    distinctAmounts,
    cadence,
    nextExpectedDate,
  };
}

function medianOf(nums: ReadonlyArray<number>): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}
