/**
 * Match a transaction's timestamp against a set of location candidates,
 * returning the best inferred location (or null).
 *
 * Two kinds of candidates:
 *   - semantic stays: have a [startUtc, endUtc] window. When the txn time
 *     falls inside the window we claim HIGH confidence with delta=0.
 *   - raw pings:      single timestamp. We pick the closest by abs(delta),
 *     gated by a maximum tolerance.
 *
 * Ranking when both kinds match:
 *   1. Any semantic stay covering the timestamp wins outright over raw pings
 *      (Google's place identification beats coordinate-only data every time).
 *   2. Among semantic stays that cover the timestamp, prefer the one whose
 *      centre (midpoint) is closest to the txn time.
 *   3. Among raw pings, smallest |delta| wins.
 *   4. Among equal |delta| pings, tighter accuracy wins.
 *
 * The function is fully pure: caller is responsible for fetching the
 * candidate set in some window around the txn timestamp.
 */

export type LocationConfidence = "high" | "medium" | "low";

export type LocationCandidate =
  | {
      kind: "semantic";
      startUtcMs: number;
      endUtcMs: number;
      lat: number;
      lng: number;
      placeName: string | null;
      placeId: string | null;
      placeCategory: string | null;
    }
  | {
      kind: "raw";
      timestampUtcMs: number;
      lat: number;
      lng: number;
      accuracyM: number | null;
    };

export interface LocationMatch {
  placeName: string | null;
  placeId: string | null;
  placeCategory: string | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
  confidence: LocationConfidence;
  source: "semantic_stay" | "raw_ping";
  /** Absolute minutes between txn time and chosen candidate's reference time. */
  deltaMinutes: number;
}

export interface MatchOptions {
  /**
   * Maximum acceptable |delta| in minutes for raw pings. Semantic stays
   * are NOT subject to this (a stay either covers the timestamp or not).
   * Default: 15.
   */
  maxRawDeltaMinutes?: number;
}

const DEFAULT_MAX_RAW_DELTA_MIN = 15;
const MS_PER_MIN = 60 * 1000;

/**
 * Pure matcher. `txnUtcMs` is the txn timestamp in UTC milliseconds; the
 * caller is responsible for the IST → UTC conversion.
 */
export function matchLocation(
  txnUtcMs: number,
  candidates: ReadonlyArray<LocationCandidate>,
  opts: MatchOptions = {},
): LocationMatch | null {
  if (!Number.isFinite(txnUtcMs)) return null;
  const maxRawDeltaMs =
    (opts.maxRawDeltaMinutes ?? DEFAULT_MAX_RAW_DELTA_MIN) * MS_PER_MIN;

  // 1. Semantic stays that cover the timestamp (start ≤ ts ≤ end).
  let bestSemantic:
    | { c: Extract<LocationCandidate, { kind: "semantic" }>; centreDelta: number }
    | null = null;
  for (const c of candidates) {
    if (c.kind !== "semantic") continue;
    if (c.startUtcMs > txnUtcMs || c.endUtcMs < txnUtcMs) continue;
    const centre = (c.startUtcMs + c.endUtcMs) / 2;
    const centreDelta = Math.abs(txnUtcMs - centre);
    if (!bestSemantic || centreDelta < bestSemantic.centreDelta) {
      bestSemantic = { c, centreDelta };
    }
  }
  if (bestSemantic) {
    const c = bestSemantic.c;
    return {
      placeName: c.placeName,
      placeId: c.placeId,
      placeCategory: c.placeCategory,
      lat: c.lat,
      lng: c.lng,
      accuracyM: null,
      confidence: "high",
      source: "semantic_stay",
      deltaMinutes: 0,
    };
  }

  // 2. Raw pings within tolerance — pick closest in time, then tightest accuracy.
  let bestRaw:
    | { c: Extract<LocationCandidate, { kind: "raw" }>; deltaMs: number }
    | null = null;
  for (const c of candidates) {
    if (c.kind !== "raw") continue;
    const delta = Math.abs(c.timestampUtcMs - txnUtcMs);
    if (delta > maxRawDeltaMs) continue;
    if (!bestRaw) {
      bestRaw = { c, deltaMs: delta };
      continue;
    }
    if (delta < bestRaw.deltaMs) {
      bestRaw = { c, deltaMs: delta };
      continue;
    }
    if (
      delta === bestRaw.deltaMs &&
      c.accuracyM != null &&
      (bestRaw.c.accuracyM == null || c.accuracyM < bestRaw.c.accuracyM)
    ) {
      bestRaw = { c, deltaMs: delta };
    }
  }
  if (bestRaw) {
    const c = bestRaw.c;
    const deltaMin = bestRaw.deltaMs / MS_PER_MIN;
    return {
      placeName: null,
      placeId: null,
      placeCategory: null,
      lat: c.lat,
      lng: c.lng,
      accuracyM: c.accuracyM,
      confidence: deltaMin <= 5 ? "medium" : "low",
      source: "raw_ping",
      deltaMinutes: Math.round(deltaMin * 10) / 10,
    };
  }

  return null;
}

// ===========================================================================
// IST ↔ UTC helpers
// ===========================================================================

/**
 * India Standard Time is UTC+5:30, with no daylight savings. The conversion
 * is a constant offset — no `Intl.DateTimeFormat` round-trips needed (and
 * those have surprising bugs around midnight crossings anyway).
 *
 * Takes ISO date YYYY-MM-DD + HH:MM time, returns UTC epoch ms.
 * Either argument null-ish → returns null.
 */
const IST_OFFSET_MIN = 5 * 60 + 30;

export function istLocalToUtcMs(
  isoDate: string | null | undefined,
  hhmm: string | null | undefined,
): number | null {
  if (!isoDate || !hhmm) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [hh, mm] = hhmm.split(":").map(Number);
  if (hh == null || mm == null || hh > 23 || mm > 59) return null;
  // Build an instant pretending the IST clock face was UTC, then subtract
  // the IST offset to land on the true UTC instant.
  const naive = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
    hh,
    mm,
  );
  return naive - IST_OFFSET_MIN * 60 * 1000;
}

/**
 * Inverse of `istLocalToUtcMs`. Useful when surfacing a candidate's UTC
 * timestamp back as an IST time-of-day for display.
 */
export function utcMsToIstHhmm(utcMs: number): string {
  const ist = new Date(utcMs + IST_OFFSET_MIN * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(
    ist.getUTCMinutes(),
  ).padStart(2, "0")}`;
}
