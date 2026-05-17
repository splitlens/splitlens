/**
 * match.ts — pair an OCR'd receipt with a canonical transaction.
 *
 * The matching rule (per the spec):
 *   - txn date within ±1 day of the receipt date
 *   - txn amount within ±₹2 of the receipt total
 *
 * We accept a generic transaction shape so this module isn't coupled to any
 * particular database driver. Callers (the daemon) hydrate `MatchableTxn[]`
 * from whatever ORM they happen to be using.
 */

export interface MatchableTxn {
  id: string | number;
  /** ISO YYYY-MM-DD. */
  date: string;
  /**
   * Absolute INR amount for the txn. We use absolute value so the matcher
   * doesn't care whether the schema stores spend as withdrawal (positive) or
   * a signed amount (negative).
   */
  amount: number;
  /**
   * Free-text narration / description. Used as a tiebreaker when multiple
   * txns satisfy the date+amount window.
   */
  narration?: string;
}

export interface ReceiptToMatch {
  /** ISO YYYY-MM-DD of when the order was placed / delivered. */
  date: string;
  /** INR total from the OCR'd receipt. */
  amount: number;
  /**
   * Merchant key (e.g. "zepto"). Used as a tiebreaker — if multiple txns are
   * within tolerance, prefer one whose narration contains the merchant name.
   */
  merchant: string;
}

export interface MatchOptions {
  /** Date tolerance in days, default ±1. */
  dateWindowDays?: number;
  /** Amount tolerance in INR, default ±2. */
  amountToleranceInr?: number;
}

/**
 * Returns the matching txn id, or null if zero or ≥1 ambiguous matches.
 *
 * Tiebreakers (in order):
 *   1. Narration contains the merchant name (case-insensitive).
 *   2. Closest amount.
 *   3. Closest date.
 *
 * If after tiebreakers there's still more than one txn we return null —
 * a false-positive attachment is worse than a missed one (the daemon will
 * route the screenshot to `unparsed/` and the user can manually pair it).
 */
export function matchTxn<T extends MatchableTxn>(
  receipt: ReceiptToMatch,
  txns: T[],
  opts: MatchOptions = {},
): T | null {
  const dateWindow = opts.dateWindowDays ?? 1;
  const amountTol = opts.amountToleranceInr ?? 2;

  const receiptMs = Date.parse(receipt.date);
  if (Number.isNaN(receiptMs)) return null;

  const candidates = txns.filter((txn) => {
    const txnMs = Date.parse(txn.date);
    if (Number.isNaN(txnMs)) return false;
    const dayDiff = Math.abs(txnMs - receiptMs) / (24 * 60 * 60 * 1000);
    if (dayDiff > dateWindow) return false;
    return Math.abs(Math.abs(txn.amount) - receipt.amount) <= amountTol;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Tiebreaker 1: prefer narration mentioning the merchant.
  const merchantLc = receipt.merchant.toLowerCase();
  const merchantMatches = candidates.filter((t) =>
    (t.narration ?? "").toLowerCase().includes(merchantLc),
  );
  const pool = merchantMatches.length > 0 ? merchantMatches : candidates;
  if (pool.length === 1) return pool[0]!;

  // Tiebreaker 2 + 3: closest by (amount diff, then date diff).
  const scored = pool
    .map((t) => ({
      txn: t,
      amountDiff: Math.abs(Math.abs(t.amount) - receipt.amount),
      dateDiff: Math.abs(Date.parse(t.date) - receiptMs),
    }))
    .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff);

  // If the top two are tied on both, we genuinely can't tell them apart.
  const [first, second] = scored;
  if (
    second &&
    first!.amountDiff === second.amountDiff &&
    first!.dateDiff === second.dateDiff
  ) {
    return null;
  }
  return first!.txn;
}
