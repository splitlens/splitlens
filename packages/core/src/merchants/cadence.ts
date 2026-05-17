/**
 * Cadence detection for repeated merchant charges.
 *
 * Given a series of ISO date strings (YYYY-MM-DD) representing charges from
 * the same merchant, decide whether this is a `weekly`, `monthly`,
 * `quarterly`, or `yearly` recurrence — or none of those.
 *
 * Approach: compute the gaps (in days) between consecutive sorted dates,
 * take the median, and bucket against known cadence centres with a
 * tolerance window. We use the median rather than the mean so a single
 * skipped/double charge doesn't flip the classification.
 *
 * Threshold rationale: with <3 samples there are at most 2 intervals,
 * which is too thin to make a useful "monthly" claim. We say `one_time` at
 * 1 sample, and at 2 samples we still report an interval but flag it as
 * `low` confidence so the UI can soften the language ("seen twice — about
 * a month apart" rather than "Monthly").
 *
 * Pure function; no I/O.
 */

export type CadenceKind =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "irregular"
  | "one_time";

export type CadenceConfidence = "high" | "medium" | "low";

export interface CadenceResult {
  kind: CadenceKind;
  confidence: CadenceConfidence;
  /**
   * Median gap between consecutive charges, in days. NULL for one_time
   * (no gaps to measure). Useful for "next expected" projection.
   */
  medianIntervalDays: number | null;
  /** Number of samples considered (post-dedup). */
  sampleCount: number;
}

/**
 * Tolerance windows around each canonical cadence centre.
 *
 * Picked empirically:
 *   - weekly:    7 days, ±2  (covers 5–9 day cycles — bank holidays, etc.)
 *   - monthly:  30 days, ±6  (covers 24–36 — handles Feb + month-end drift)
 *   - quarterly: 91 days, ±15 (covers 76–106 — wide because nobody actually
 *                              bills "every 91 days"; this captures "every
 *                              three months" with date jitter)
 *   - yearly:  365 days, ±30 (covers 335–395)
 */
const CADENCE_WINDOWS: ReadonlyArray<{
  kind: Exclude<CadenceKind, "irregular" | "one_time">;
  centre: number;
  tolerance: number;
}> = [
  { kind: "weekly", centre: 7, tolerance: 2 },
  { kind: "monthly", centre: 30, tolerance: 6 },
  { kind: "quarterly", centre: 91, tolerance: 15 },
  { kind: "yearly", centre: 365, tolerance: 30 },
];

export function detectCadence(isoDates: ReadonlyArray<string>): CadenceResult {
  // Parse, dedupe, and sort ascending. Invalid dates are dropped silently —
  // ingestion should never produce them but we don't want to throw at
  // render time.
  const days = uniqueSortedEpochDays(isoDates);

  if (days.length === 0) {
    return {
      kind: "one_time",
      confidence: "low",
      medianIntervalDays: null,
      sampleCount: 0,
    };
  }
  if (days.length === 1) {
    return {
      kind: "one_time",
      confidence: "high",
      medianIntervalDays: null,
      sampleCount: 1,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < days.length; i++) {
    intervals.push(days[i]! - days[i - 1]!);
  }
  const median = medianOf(intervals);

  // Bucket against cadence windows.
  const matched = CADENCE_WINDOWS.find(
    (w) => Math.abs(median - w.centre) <= w.tolerance,
  );

  if (!matched) {
    return {
      kind: "irregular",
      confidence: days.length >= 4 ? "medium" : "low",
      medianIntervalDays: median,
      sampleCount: days.length,
    };
  }

  // Confidence tiering for a recognised cadence:
  //   high   : ≥4 samples AND ≥75% of intervals are inside the window
  //   medium : ≥3 samples
  //   low    : 2 samples (we can name the cadence but can't really commit)
  const inWindow = intervals.filter(
    (d) => Math.abs(d - matched.centre) <= matched.tolerance,
  ).length;
  const inWindowRatio = inWindow / intervals.length;

  let confidence: CadenceConfidence;
  if (days.length >= 4 && inWindowRatio >= 0.75) confidence = "high";
  else if (days.length >= 3) confidence = "medium";
  else confidence = "low";

  return {
    kind: matched.kind,
    confidence,
    medianIntervalDays: median,
    sampleCount: days.length,
  };
}

/**
 * Project the date of the next expected charge from the last seen date +
 * cadence. Returns ISO YYYY-MM-DD, or NULL when the cadence is one_time /
 * irregular or we have no interval to project from.
 */
export function projectNextCharge(
  lastSeenIso: string,
  cadence: CadenceResult,
): string | null {
  if (cadence.medianIntervalDays == null) return null;
  if (cadence.kind === "one_time" || cadence.kind === "irregular") return null;
  const last = parseIsoToEpochDay(lastSeenIso);
  if (last == null) return null;
  return epochDayToIso(last + Math.round(cadence.medianIntervalDays));
}

// ─── helpers ───────────────────────────────────────────────────────────────

function uniqueSortedEpochDays(isoDates: ReadonlyArray<string>): number[] {
  const parsed: number[] = [];
  for (const iso of isoDates) {
    const d = parseIsoToEpochDay(iso);
    if (d != null) parsed.push(d);
  }
  parsed.sort((a, b) => a - b);
  // Dedupe — same-day charges count as one "sample" for cadence purposes
  // (otherwise two Apple charges on the same day would create a 0-day
  // interval and pull the median toward 0).
  const out: number[] = [];
  for (const d of parsed) {
    if (out.length === 0 || out[out.length - 1] !== d) out.push(d);
  }
  return out;
}

function parseIsoToEpochDay(iso: string): number | null {
  // Expect strict YYYY-MM-DD. Date.parse is permissive but for our SQLite
  // column we know the shape, so a regex check is the cheap sanity guard.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

function epochDayToIso(epochDay: number): string {
  const ms = epochDay * 86_400_000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function medianOf(nums: ReadonlyArray<number>): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}
