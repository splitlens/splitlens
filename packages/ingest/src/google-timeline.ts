/**
 * Google Maps Timeline ingestion.
 *
 * Source: the user does a one-time export via Google Takeout (or directly
 * from the Maps app's "Export timeline data" affordance), then drops the
 * resulting `.zip` or individual `.json` files onto the upload surface.
 *
 * Two file shapes we care about, both from Google's Takeout export:
 *
 *   1. Records.json — flat array of raw GPS pings. Often 10s–100s of MB
 *      for multi-year users. We downsample to one record per 5-minute
 *      bucket at parse time, keeping the highest-accuracy ping in each
 *      window. Without this, a year's data is ~500k rows; downsampled it
 *      lands around 100k.
 *
 *   2. Semantic Location History/YYYY/YYYY_MONTH.json — Google's interpreted
 *      "stays" + "activity segments". We only keep `placeVisit` entries
 *      since they're what merchant-location matching actually needs.
 *      Small files (KB range each), one per month.
 *
 * No third-party API calls. No reverse-geocoding. We trust Google's place
 * identification in the semantic file; for raw pings we just store lat/lng
 * and let the matcher decide what to do with them.
 *
 * Memory note: parser uses `JSON.parse` on the whole file. For multi-GB
 * `Records.json` this would OOM — but downsampled exports from Maps app and
 * recent Takeouts hover around 5–50 MB per year, comfortably in memory. If
 * a user hits that ceiling we'll add streaming later; for now simplicity
 * wins.
 */

import { createHash } from "node:crypto";
import yauzl from "yauzl";
import { sql } from "drizzle-orm";
import type { SplitLensDb } from "@splitlens/db";

/** One row of `Records.json` after parsing + downsampling. */
export interface RawLocationRecord {
  /** ISO 8601 in UTC, e.g. "2026-05-14T18:23:47.000Z". */
  timestampUtc: string;
  lat: number;
  lng: number;
  /** Meters. Null when Google didn't record one. */
  accuracyM: number | null;
}

/**
 * One row from a Semantic Location History monthly file. Represents a
 * contiguous span during which Google decided the user was "at" a single
 * place (a `placeVisit`). We discard `activitySegment` entries because
 * matching transactions to roads in motion isn't useful.
 */
export interface SemanticStay {
  /** ISO 8601 UTC. */
  startUtc: string;
  /** ISO 8601 UTC. */
  endUtc: string;
  /** Centroid of the place, in decimal degrees. */
  lat: number;
  lng: number;
  /** Google's friendly name when known ("Cult.fit Indiranagar"). */
  placeName: string | null;
  /** Stable Google Place ID — survives across exports. */
  placeId: string | null;
  /** Google's place taxonomy ("RESTAURANT", "TYPE_GYM", ...). */
  placeCategory: string | null;
}

/** Output of consuming a Takeout import. */
export interface TakeoutContents {
  /** Covering window of everything found. ISO UTC. */
  periodFromUtc: string | null;
  periodToUtc: string | null;
  records: RawLocationRecord[];
  semanticStays: SemanticStay[];
}

// ===========================================================================
// Records.json — parse + downsample
// ===========================================================================

/**
 * Historical Takeout format for raw pings — still in use as of 2024–2025:
 *
 *   { "locations": [
 *       {
 *         "timestamp": "2026-05-14T18:23:47.123Z",  // or older: "timestampMs": "1747249427123"
 *         "latitudeE7": 129700000,                   // signed int × 1e7
 *         "longitudeE7": 778000000,
 *         "accuracy": 17
 *       },
 *       ...
 *   ]}
 */
interface RawRecordsEntry {
  timestamp?: string;
  timestampMs?: string;
  latitudeE7?: number;
  longitudeE7?: number;
  accuracy?: number;
}

const DEFAULT_BUCKET_MIN = 5;

/**
 * Parse a `Records.json` payload and yield downsampled records.
 *
 * Downsampling: one record per `bucketMinutes` UTC bucket, keeping the
 * highest-accuracy ping (lowest accuracy_m number). Without this a year of
 * Records.json yields ~500k rows; with 5-min buckets it lands ~100k.
 */
export function parseRecordsJson(
  text: string,
  bucketMinutes = DEFAULT_BUCKET_MIN,
): RawLocationRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const locations = (parsed as { locations?: unknown }).locations;
  if (!Array.isArray(locations)) return [];

  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = new Map<number, RawLocationRecord>();

  for (const raw of locations) {
    if (!raw || typeof raw !== "object") continue;
    const rec = normaliseRawRecord(raw as RawRecordsEntry);
    if (!rec) continue;
    const ts = Date.parse(rec.timestampUtc);
    if (Number.isNaN(ts)) continue;
    const bucket = Math.floor(ts / bucketMs);
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, rec);
      continue;
    }
    // Better = lower accuracy number (= tighter ping)
    if (
      rec.accuracyM != null &&
      (existing.accuracyM == null || rec.accuracyM < existing.accuracyM)
    ) {
      buckets.set(bucket, rec);
    }
  }

  // Return chronologically.
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

function normaliseRawRecord(e: RawRecordsEntry): RawLocationRecord | null {
  if (e.latitudeE7 == null || e.longitudeE7 == null) return null;
  let ts: string | null = null;
  if (typeof e.timestamp === "string") {
    ts = e.timestamp;
  } else if (typeof e.timestampMs === "string") {
    const n = Number(e.timestampMs);
    if (!Number.isFinite(n)) return null;
    ts = new Date(n).toISOString();
  }
  if (!ts) return null;
  return {
    timestampUtc: ts,
    lat: e.latitudeE7 / 1e7,
    lng: e.longitudeE7 / 1e7,
    accuracyM: typeof e.accuracy === "number" ? e.accuracy : null,
  };
}

// ===========================================================================
// Semantic Location History — monthly file parse
// ===========================================================================

interface SemanticPlaceVisit {
  location?: {
    latitudeE7?: number;
    longitudeE7?: number;
    placeId?: string;
    name?: string;
    semanticType?: string;
    placeCategory?: string;
  };
  duration?: {
    startTimestamp?: string;
    endTimestamp?: string;
  };
}

/**
 * Parse a single Semantic Location History monthly file. Returns the
 * placeVisit stays only — activity segments are intentionally discarded.
 */
export function parseSemanticMonth(text: string): SemanticStay[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const objs = (parsed as { timelineObjects?: unknown }).timelineObjects;
  if (!Array.isArray(objs)) return [];

  const out: SemanticStay[] = [];
  for (const obj of objs) {
    if (!obj || typeof obj !== "object") continue;
    const visit = (obj as { placeVisit?: SemanticPlaceVisit }).placeVisit;
    if (!visit) continue;
    const loc = visit.location;
    const dur = visit.duration;
    if (!loc || !dur) continue;
    if (
      loc.latitudeE7 == null ||
      loc.longitudeE7 == null ||
      !dur.startTimestamp ||
      !dur.endTimestamp
    )
      continue;
    out.push({
      startUtc: dur.startTimestamp,
      endUtc: dur.endTimestamp,
      lat: loc.latitudeE7 / 1e7,
      lng: loc.longitudeE7 / 1e7,
      placeName: typeof loc.name === "string" ? loc.name : null,
      placeId: typeof loc.placeId === "string" ? loc.placeId : null,
      placeCategory:
        typeof loc.placeCategory === "string"
          ? loc.placeCategory
          : typeof loc.semanticType === "string"
            ? loc.semanticType
            : null,
    });
  }
  return out;
}

// ===========================================================================
// Zip orchestration — open a Takeout zip, route entries to the right parser
// ===========================================================================

/**
 * Filename patterns Takeout uses. Three flavors observed in the wild:
 *   1. `Takeout/Location History (Timeline)/...`       (Takeout export)
 *   2. `Takeout/Location History/...`                   (older Takeout)
 *   3. `Location History (Timeline)/...`                (user zipped the inner folder)
 *   4. `Records.json` at the root                       (user uploaded just the file)
 *
 * Recognise all of them.
 */
const RECORDS_RE =
  /(^|\/)Records\.json$/i;
const SEMANTIC_RE =
  /(^|\/)Semantic Location History\/\d{4}\/.+\.json$/i;

/** Compute a stable SHA-256 of the source bytes for idempotency keying. */
export function hashTakeoutBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Open a Takeout zip in-memory and route each relevant entry to the right
 * parser. Returns the materialized records + stays + covering period.
 */
export async function readTakeoutZip(
  buf: Buffer,
  bucketMinutes = DEFAULT_BUCKET_MIN,
): Promise<TakeoutContents> {
  const semanticStays: SemanticStay[] = [];
  let recordsText: string | null = null;

  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      if (!zip) return reject(new Error("zip is empty"));

      zip.on("error", reject);
      zip.on("end", () => resolve());

      zip.readEntry();
      zip.on("entry", (entry) => {
        const name = entry.fileName;
        const isDir = /\/$/.test(name);
        if (isDir) {
          zip.readEntry();
          return;
        }
        const isRecords = RECORDS_RE.test(name);
        const isSemantic = SEMANTIC_RE.test(name);
        if (!isRecords && !isSemantic) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) {
            zip.readEntry();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            if (isRecords) {
              recordsText = body;
            } else {
              for (const s of parseSemanticMonth(body)) semanticStays.push(s);
            }
            zip.readEntry();
          });
          stream.on("error", () => zip.readEntry());
        });
      });
    });
  });

  const records = recordsText ? parseRecordsJson(recordsText, bucketMinutes) : [];

  let periodFromUtc: string | null = null;
  let periodToUtc: string | null = null;
  for (const r of records) {
    if (!periodFromUtc || r.timestampUtc < periodFromUtc) periodFromUtc = r.timestampUtc;
    if (!periodToUtc || r.timestampUtc > periodToUtc) periodToUtc = r.timestampUtc;
  }
  for (const s of semanticStays) {
    if (!periodFromUtc || s.startUtc < periodFromUtc) periodFromUtc = s.startUtc;
    if (!periodToUtc || s.endUtc > periodToUtc) periodToUtc = s.endUtc;
  }

  return { records, semanticStays, periodFromUtc, periodToUtc };
}

// ===========================================================================
// Top-level orchestrator — write rows into the DB transactionally
// ===========================================================================

export interface TakeoutIngestOptions {
  /** Override the default 5-min downsample bucket. */
  bucketMinutes?: number;
}

export type TakeoutIngestOutcome =
  | {
      kind: "imported";
      importId: number;
      recordCount: number;
      semanticCount: number;
      periodFromUtc: string | null;
      periodToUtc: string | null;
    }
  | { kind: "duplicate"; importId: number }
  | { kind: "empty" }
  | { kind: "error"; reason: string };

/**
 * Idempotent Takeout import. Hashes the input bytes; aborts when the same
 * zip has already been ingested. Otherwise: writes one row into
 * `location_imports`, then bulk-inserts records + semantic stays in a
 * single SQLite transaction.
 */
export async function ingestTakeoutZip(
  buf: Buffer,
  db: SplitLensDb,
  opts: TakeoutIngestOptions = {},
): Promise<TakeoutIngestOutcome> {
  if (buf.length === 0) return { kind: "empty" };
  const hash = hashTakeoutBytes(buf);
  const existing = db.get<{ id: number }>(sql`
    SELECT id FROM location_imports WHERE takeout_hash = ${hash}
  `);
  if (existing) return { kind: "duplicate", importId: existing.id };

  let contents: TakeoutContents;
  try {
    contents = await readTakeoutZip(buf, opts.bucketMinutes ?? DEFAULT_BUCKET_MIN);
  } catch (err) {
    return { kind: "error", reason: err instanceof Error ? err.message : String(err) };
  }

  return writeContents(db, hash, contents);
}

/**
 * Ingest a single Records.json (raw pings only). For users who unzip Takeout
 * and only upload the heavy file.
 */
export async function ingestRecordsJson(
  buf: Buffer,
  db: SplitLensDb,
  opts: TakeoutIngestOptions = {},
): Promise<TakeoutIngestOutcome> {
  if (buf.length === 0) return { kind: "empty" };
  const hash = hashTakeoutBytes(buf);
  const existing = db.get<{ id: number }>(sql`
    SELECT id FROM location_imports WHERE takeout_hash = ${hash}
  `);
  if (existing) return { kind: "duplicate", importId: existing.id };

  const records = parseRecordsJson(
    buf.toString("utf-8"),
    opts.bucketMinutes ?? DEFAULT_BUCKET_MIN,
  );
  if (records.length === 0) return { kind: "empty" };

  return writeContents(db, hash, {
    records,
    semanticStays: [],
    periodFromUtc: records[0]?.timestampUtc ?? null,
    periodToUtc: records[records.length - 1]?.timestampUtc ?? null,
  });
}

/** Ingest one Semantic Location History monthly file. */
export async function ingestSemanticMonthJson(
  buf: Buffer,
  db: SplitLensDb,
): Promise<TakeoutIngestOutcome> {
  if (buf.length === 0) return { kind: "empty" };
  const hash = hashTakeoutBytes(buf);
  const existing = db.get<{ id: number }>(sql`
    SELECT id FROM location_imports WHERE takeout_hash = ${hash}
  `);
  if (existing) return { kind: "duplicate", importId: existing.id };

  const stays = parseSemanticMonth(buf.toString("utf-8"));
  if (stays.length === 0) return { kind: "empty" };

  let periodFromUtc: string | null = null;
  let periodToUtc: string | null = null;
  for (const s of stays) {
    if (!periodFromUtc || s.startUtc < periodFromUtc) periodFromUtc = s.startUtc;
    if (!periodToUtc || s.endUtc > periodToUtc) periodToUtc = s.endUtc;
  }
  return writeContents(db, hash, {
    records: [],
    semanticStays: stays,
    periodFromUtc,
    periodToUtc,
  });
}

function writeContents(
  db: SplitLensDb,
  hash: string,
  contents: TakeoutContents,
): TakeoutIngestOutcome {
  // (parameters retained for future use; bucketMinutes is read in callers)
  if (contents.records.length === 0 && contents.semanticStays.length === 0) {
    return { kind: "empty" };
  }

  // SQLite transaction wrapping a single import row + bulk insert.
  const native = (
    db as unknown as {
      $client: { transaction: (fn: () => unknown) => () => unknown };
    }
  ).$client;
  const txn = native.transaction(() => {
    db.run(sql`
      INSERT INTO location_imports (
        takeout_hash, period_from, period_to, record_count, semantic_count
      ) VALUES (
        ${hash},
        ${contents.periodFromUtc},
        ${contents.periodToUtc},
        ${contents.records.length},
        ${contents.semanticStays.length}
      )
    `);
    const importRow = db.get<{ id: number }>(sql`
      SELECT id FROM location_imports WHERE takeout_hash = ${hash}
    `);
    if (!importRow) throw new Error("import row missing after insert");

    for (const r of contents.records) {
      db.run(sql`
        INSERT INTO location_records (
          timestamp_utc, window_end_utc, lat, lng, accuracy_m,
          place_name, place_id, place_category, source_kind, import_id
        ) VALUES (
          ${r.timestampUtc}, NULL, ${r.lat}, ${r.lng}, ${r.accuracyM},
          NULL, NULL, NULL, 'takeout_raw', ${importRow.id}
        )
      `);
    }
    for (const s of contents.semanticStays) {
      db.run(sql`
        INSERT INTO location_records (
          timestamp_utc, window_end_utc, lat, lng, accuracy_m,
          place_name, place_id, place_category, source_kind, import_id
        ) VALUES (
          ${s.startUtc}, ${s.endUtc}, ${s.lat}, ${s.lng}, NULL,
          ${s.placeName}, ${s.placeId}, ${s.placeCategory}, 'takeout_semantic', ${importRow.id}
        )
      `);
    }
    return importRow.id;
  });
  const importId = txn() as number;

  return {
    kind: "imported",
    importId,
    recordCount: contents.records.length,
    semanticCount: contents.semanticStays.length,
    periodFromUtc: contents.periodFromUtc,
    periodToUtc: contents.periodToUtc,
  };
}
