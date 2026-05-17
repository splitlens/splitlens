"use server";

import "server-only";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { openDb } from "@splitlens/db";
import {
  ingestTakeoutZip,
  ingestRecordsJson,
  ingestSemanticMonthJson,
  type TakeoutIngestOutcome,
} from "@splitlens/ingest";

// ============================================================================
// Location data ingestion + management
// ============================================================================

export type LocationImportResult =
  | {
      ok: true;
      kind: "imported" | "duplicate";
      importId?: number;
      recordCount?: number;
      semanticCount?: number;
      periodFromUtc?: string | null;
      periodToUtc?: string | null;
      durationMs: number;
    }
  | { ok: false; error: string };

/**
 * Accept a Takeout export — either the full zip, a bare `Records.json`, or
 * a single Semantic Location History monthly JSON file. The filename
 * decides which path runs. Idempotent: re-uploading the exact same bytes
 * returns `kind: "duplicate"` without writing anything.
 *
 * Body is base64-encoded so the action wire stays string-safe in Next's
 * server-action protocol. 200MB hard cap (the daemon's local SQLite can
 * comfortably store the post-downsample row count from that).
 */
export async function ingestGoogleTimeline(
  fileName: string,
  base64: string,
): Promise<LocationImportResult> {
  const start = Date.now();
  const cleanName = (fileName ?? "").trim();
  if (!cleanName) return { ok: false, error: "file name required" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "could not decode payload" };
  }
  if (bytes.length === 0) return { ok: false, error: "empty file" };
  if (bytes.length > 200 * 1024 * 1024) {
    return { ok: false, error: "file too large (>200 MB)" };
  }

  const lower = cleanName.toLowerCase();
  const db = openDb();

  let outcome: TakeoutIngestOutcome;
  try {
    if (lower.endsWith(".zip")) {
      outcome = await ingestTakeoutZip(bytes, db);
    } else if (lower === "records.json" || lower.endsWith("/records.json")) {
      outcome = await ingestRecordsJson(bytes, db);
    } else if (lower.endsWith(".json")) {
      // Best-effort: treat as a Semantic Location History monthly file.
      // ingestSemanticMonthJson returns "empty" if the JSON doesn't look
      // like one, so the user gets a clean error rather than a silent insert.
      outcome = await ingestSemanticMonthJson(bytes, db);
    } else {
      return {
        ok: false,
        error: `unsupported file: ${cleanName}. Drop a Takeout .zip, Records.json, or a Semantic Location History monthly JSON.`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const durationMs = Date.now() - start;

  if (outcome.kind === "empty") {
    return {
      ok: false,
      error:
        "no recognisable location data inside. The zip should contain Records.json and/or a Semantic Location History/ folder under Takeout/Location History.",
    };
  }
  if (outcome.kind === "error") {
    return { ok: false, error: outcome.reason };
  }
  if (outcome.kind === "duplicate") {
    return {
      ok: true,
      kind: "duplicate",
      importId: outcome.importId,
      durationMs,
    };
  }
  // imported
  revalidatePath("/review");
  revalidatePath("/try");
  return {
    ok: true,
    kind: "imported",
    importId: outcome.importId,
    recordCount: outcome.recordCount,
    semanticCount: outcome.semanticCount,
    periodFromUtc: outcome.periodFromUtc,
    periodToUtc: outcome.periodToUtc,
    durationMs,
  };
}

// ============================================================================
// List / delete imports
// ============================================================================

export interface LocationImportRow {
  id: number;
  periodFrom: string | null;
  periodTo: string | null;
  recordCount: number;
  semanticCount: number;
  importedAt: string;
}

export async function listLocationImports(): Promise<LocationImportRow[]> {
  const db = openDb();
  const rows = db.all<{
    id: number;
    period_from: string | null;
    period_to: string | null;
    record_count: number;
    semantic_count: number;
    imported_at: string;
  }>(sql`
    SELECT id, period_from, period_to, record_count, semantic_count, imported_at
    FROM location_imports
    ORDER BY imported_at DESC
  `);
  return rows.map((r) => ({
    id: r.id,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    recordCount: r.record_count,
    semanticCount: r.semantic_count,
    importedAt: r.imported_at,
  }));
}

/**
 * Delete a single Takeout import. `ON DELETE CASCADE` on `location_records`
 * drops the records too — no orphans.
 */
export async function deleteLocationImport(
  id: number,
): Promise<{ ok: true; deletedRecords: number } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "invalid id" };
  }
  const db = openDb();
  const before = db.get<{ n: number }>(sql`
    SELECT count(*) AS n FROM location_records WHERE import_id = ${id}
  `);
  db.run(sql`DELETE FROM location_imports WHERE id = ${id}`);
  revalidatePath("/review");
  revalidatePath("/try");
  return { ok: true, deletedRecords: before?.n ?? 0 };
}

/**
 * Wipe ALL location data (every import + every record). One-click reset for
 * the privacy-conscious user. The merchant_labels table is untouched —
 * the user's product annotations survive.
 */
export async function wipeAllLocationHistory(): Promise<{
  ok: true;
  deletedImports: number;
  deletedRecords: number;
}> {
  const db = openDb();
  const importsBefore = db.get<{ n: number }>(sql`
    SELECT count(*) AS n FROM location_imports
  `);
  const recordsBefore = db.get<{ n: number }>(sql`
    SELECT count(*) AS n FROM location_records
  `);
  db.run(sql`DELETE FROM location_imports`);
  // Defensive — cascade should clear them but just in case:
  db.run(sql`DELETE FROM location_records`);
  revalidatePath("/review");
  revalidatePath("/try");
  return {
    ok: true,
    deletedImports: importsBefore?.n ?? 0,
    deletedRecords: recordsBefore?.n ?? 0,
  };
}

/**
 * Convenience: when was the most recent location data ingested? Drives the
 * "your timeline ends [date] — upload a fresh export?" nudge on txn detail.
 */
export interface LocationFreshness {
  lastImportedAt: string | null;
  latestPeriodTo: string | null;
  totalRecords: number;
  totalImports: number;
}

export async function getLocationFreshness(): Promise<LocationFreshness> {
  const db = openDb();
  const row = db.get<{
    last_imported_at: string | null;
    latest_period_to: string | null;
    total_records: number;
    total_imports: number;
  }>(sql`
    SELECT
      MAX(imported_at)   AS last_imported_at,
      MAX(period_to)     AS latest_period_to,
      COALESCE(SUM(record_count + semantic_count), 0) AS total_records,
      COUNT(*)           AS total_imports
    FROM location_imports
  `);
  return {
    lastImportedAt: row?.last_imported_at ?? null,
    latestPeriodTo: row?.latest_period_to ?? null,
    totalRecords: row?.total_records ?? 0,
    totalImports: row?.total_imports ?? 0,
  };
}
