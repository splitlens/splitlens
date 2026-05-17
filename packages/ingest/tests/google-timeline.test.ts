/**
 * Tests for the Google Takeout Timeline parsers. Synthetic fixtures only —
 * we don't ship real Takeout data in the repo.
 *
 * Three surfaces:
 *   1. parseSemanticMonth  — single monthly file → stay objects
 *   2. streamRecordsJson   — large flat ping array → downsampled records
 *   3. ingestTakeoutZip    — full zip → DB rows + idempotency
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb, type SplitLensDb } from "@splitlens/db";

import {
  parseSemanticMonth,
  parseRecordsJson,
  ingestTakeoutZip,
  hashTakeoutBytes,
} from "../src/google-timeline";

// ===========================================================================
// Semantic Location History
// ===========================================================================

describe("parseSemanticMonth", () => {
  it("extracts placeVisit stays and drops activitySegments", () => {
    const fixture = JSON.stringify({
      timelineObjects: [
        {
          placeVisit: {
            location: {
              latitudeE7: 128300000, // 12.83°N
              longitudeE7: 778000000, // 77.8°E
              placeId: "ChIJabc",
              name: "Cult.fit Indiranagar",
              semanticType: "TYPE_GYM",
            },
            duration: {
              startTimestamp: "2026-05-14T18:23:47Z",
              endTimestamp: "2026-05-14T19:47:00Z",
            },
          },
        },
        {
          activitySegment: {
            duration: {
              startTimestamp: "2026-05-14T19:47:00Z",
              endTimestamp: "2026-05-14T19:55:00Z",
            },
          },
        },
        {
          placeVisit: {
            location: {
              latitudeE7: 128700000,
              longitudeE7: 778100000,
              name: "Home",
            },
            duration: {
              startTimestamp: "2026-05-14T20:00:00Z",
              endTimestamp: "2026-05-15T07:30:00Z",
            },
          },
        },
      ],
    });
    const stays = parseSemanticMonth(fixture);
    expect(stays).toHaveLength(2);
    expect(stays[0]).toEqual({
      startUtc: "2026-05-14T18:23:47Z",
      endUtc: "2026-05-14T19:47:00Z",
      lat: 12.83,
      lng: 77.8,
      placeName: "Cult.fit Indiranagar",
      placeId: "ChIJabc",
      placeCategory: "TYPE_GYM",
    });
    expect(stays[1]?.placeName).toBe("Home");
    expect(stays[1]?.placeId).toBeNull();
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseSemanticMonth("{not-json")).toEqual([]);
    expect(parseSemanticMonth("")).toEqual([]);
    expect(parseSemanticMonth("null")).toEqual([]);
  });

  it("skips placeVisit entries missing location or duration", () => {
    const fixture = JSON.stringify({
      timelineObjects: [
        { placeVisit: { duration: { startTimestamp: "x", endTimestamp: "y" } } },
        { placeVisit: { location: { latitudeE7: 1, longitudeE7: 1 } } },
        {
          placeVisit: {
            location: { latitudeE7: 100000000, longitudeE7: 200000000 },
            duration: {
              startTimestamp: "2026-01-01T00:00:00Z",
              endTimestamp: "2026-01-01T01:00:00Z",
            },
          },
        },
      ],
    });
    const stays = parseSemanticMonth(fixture);
    expect(stays).toHaveLength(1);
  });

  it("falls back from placeCategory to semanticType", () => {
    const fixture = JSON.stringify({
      timelineObjects: [
        {
          placeVisit: {
            location: {
              latitudeE7: 100000000,
              longitudeE7: 200000000,
              placeCategory: "RESTAURANT",
              semanticType: "TYPE_HOME",
            },
            duration: {
              startTimestamp: "2026-01-01T00:00:00Z",
              endTimestamp: "2026-01-01T01:00:00Z",
            },
          },
        },
      ],
    });
    expect(parseSemanticMonth(fixture)[0]?.placeCategory).toBe("RESTAURANT");
  });
});

// ===========================================================================
// Records.json streaming + downsample
// ===========================================================================

describe("parseRecordsJson", () => {
  function parse(obj: unknown, bucket?: number) {
    return parseRecordsJson(JSON.stringify(obj), bucket);
  }

  it("yields one record per 5-minute bucket, keeping the best accuracy", () => {
    const out = parse({
      locations: [
        { timestamp: "2026-05-14T18:00:00Z", latitudeE7: 129700000, longitudeE7: 778000000, accuracy: 30 },
        { timestamp: "2026-05-14T18:02:00Z", latitudeE7: 129701000, longitudeE7: 778001000, accuracy: 10 },
        { timestamp: "2026-05-14T18:04:00Z", latitudeE7: 129702000, longitudeE7: 778002000, accuracy: 25 },
        { timestamp: "2026-05-14T18:06:00Z", latitudeE7: 129703000, longitudeE7: 778003000, accuracy: 12 },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.timestampUtc).toBe("2026-05-14T18:02:00Z");
    expect(out[0]!.accuracyM).toBe(10);
    expect(out[1]!.timestampUtc).toBe("2026-05-14T18:06:00Z");
  });

  it("returns records sorted chronologically", () => {
    const out = parse({
      locations: [
        { timestamp: "2026-05-14T20:00:00Z", latitudeE7: 1, longitudeE7: 1, accuracy: 5 },
        { timestamp: "2026-05-14T19:00:00Z", latitudeE7: 1, longitudeE7: 1, accuracy: 5 },
        { timestamp: "2026-05-14T18:00:00Z", latitudeE7: 1, longitudeE7: 1, accuracy: 5 },
      ],
    });
    expect(out.map((r) => r.timestampUtc)).toEqual([
      "2026-05-14T18:00:00Z",
      "2026-05-14T19:00:00Z",
      "2026-05-14T20:00:00Z",
    ]);
  });

  it("accepts the legacy timestampMs format", () => {
    const out = parse({
      locations: [
        {
          timestampMs: String(new Date("2026-05-14T18:00:00Z").getTime()),
          latitudeE7: 129700000,
          longitudeE7: 778000000,
          accuracy: 17,
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.timestampUtc).toContain("2026-05-14");
  });

  it("skips records missing lat/lng or timestamp", () => {
    const out = parse({
      locations: [
        { timestamp: "2026-05-14T18:00:00Z" }, // no lat/lng
        { latitudeE7: 1, longitudeE7: 1 }, // no timestamp
        { timestamp: "2026-05-14T18:30:00Z", latitudeE7: 100000000, longitudeE7: 200000000 },
      ],
    });
    expect(out).toHaveLength(1);
  });

  it("downsamples a high-frequency stream", () => {
    // 50 pings 20s apart over ~16 minutes → ~4 buckets (5-min each)
    const locations = Array.from({ length: 50 }, (_, i) => ({
      timestamp: new Date(Date.parse("2026-05-14T18:00:00Z") + i * 20 * 1000).toISOString(),
      latitudeE7: 100000000,
      longitudeE7: 200000000,
      accuracy: 10 + i,
    }));
    const out = parse({ locations });
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array on malformed JSON", () => {
    expect(parseRecordsJson("{not-json")).toEqual([]);
    expect(parseRecordsJson("")).toEqual([]);
    expect(parseRecordsJson("null")).toEqual([]);
  });

  it("respects a custom bucket size", () => {
    // 6 pings 60s apart → 6 with 1-min buckets, 1 with 30-min buckets
    const locations = Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(Date.parse("2026-05-14T18:00:00Z") + i * 60 * 1000).toISOString(),
      latitudeE7: 1,
      longitudeE7: 1,
      accuracy: 5,
    }));
    expect(parse({ locations }, 1)).toHaveLength(6);
    expect(parse({ locations }, 30)).toHaveLength(1);
  });
});

// ===========================================================================
// Zip ingestion + idempotency
// ===========================================================================

describe("ingestTakeoutZip", () => {
  /**
   * openDb() pulls in the full INIT_DDL which already creates
   * location_imports + location_records — no manual schema build here.
   */
  function tmpDb(): { db: SplitLensDb; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "splitlens-loc-"));
    const db = openDb(join(dir, "test.sqlite"));
    return { db, dir };
  }
  function rawSqlite(db: SplitLensDb) {
    return (db as unknown as { $client: import("better-sqlite3").Database })
      .$client;
  }

  function buildZipBuffer(files: Array<{ name: string; content: string }>): Buffer {
    // Use the OS `zip` tool to build a deterministic, real zip — easier
    // than wiring node-zip dependencies into tests.
    const dir = mkdtempSync(join(tmpdir(), "splitlens-zip-"));
    try {
      for (const f of files) {
        const dest = join(dir, f.name);
        const parent = dest.substring(0, dest.lastIndexOf("/"));
        if (parent && parent !== dir) {
          mkdirSync(parent, { recursive: true });
        }
        writeFileSync(dest, f.content);
      }
      const zipPath = join(dir, "out.zip");
      execSync(`cd "${dir}" && zip -qr out.zip ./*`, { stdio: "pipe" });
      return Buffer.from(readFileSync(zipPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("imports semantic stays from a Takeout zip", async () => {
    const semantic = {
      timelineObjects: [
        {
          placeVisit: {
            location: {
              latitudeE7: 128300000,
              longitudeE7: 778000000,
              placeId: "ChIJabc",
              name: "Cult.fit Indiranagar",
              semanticType: "TYPE_GYM",
            },
            duration: {
              startTimestamp: "2026-05-14T18:23:47Z",
              endTimestamp: "2026-05-14T19:47:00Z",
            },
          },
        },
      ],
    };
    const zip = buildZipBuffer([
      {
        name: "Takeout/Location History (Timeline)/Semantic Location History/2026/2026_MAY.json",
        content: JSON.stringify(semantic),
      },
    ]);
    const { db } = tmpDb();
    const sqlite = rawSqlite(db);
    try {
      const r = await ingestTakeoutZip(zip, db);
      expect(r.kind).toBe("imported");
      if (r.kind !== "imported") throw new Error();
      expect(r.semanticCount).toBe(1);
      expect(r.recordCount).toBe(0);
      const rows = sqlite
        .prepare(`SELECT place_name, source_kind FROM location_records`)
        .all() as Array<{ place_name: string; source_kind: string }>;
      expect(rows).toEqual([
        { place_name: "Cult.fit Indiranagar", source_kind: "takeout_semantic" },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("is idempotent on identical zip bytes", async () => {
    const semantic = {
      timelineObjects: [
        {
          placeVisit: {
            location: { latitudeE7: 100000000, longitudeE7: 200000000 },
            duration: {
              startTimestamp: "2026-01-01T00:00:00Z",
              endTimestamp: "2026-01-01T01:00:00Z",
            },
          },
        },
      ],
    };
    const zip = buildZipBuffer([
      {
        name: "Takeout/Location History (Timeline)/Semantic Location History/2026/2026_JAN.json",
        content: JSON.stringify(semantic),
      },
    ]);
    const { db } = tmpDb();
    const sqlite = rawSqlite(db);
    try {
      const r1 = await ingestTakeoutZip(zip, db);
      const r2 = await ingestTakeoutZip(zip, db);
      expect(r1.kind).toBe("imported");
      expect(r2.kind).toBe("duplicate");
    } finally {
      sqlite.close();
    }
  });

  it("returns 'empty' for a buffer with no relevant files", async () => {
    const zip = buildZipBuffer([{ name: "Takeout/README.txt", content: "hello" }]);
    const { db } = tmpDb();
    const sqlite = rawSqlite(db);
    try {
      const r = await ingestTakeoutZip(zip, db);
      expect(r.kind).toBe("empty");
    } finally {
      sqlite.close();
    }
  });

  it("returns 'empty' for empty buffer", async () => {
    const { db } = tmpDb();
    const sqlite = rawSqlite(db);
    try {
      const r = await ingestTakeoutZip(Buffer.alloc(0), db);
      expect(r.kind).toBe("empty");
    } finally {
      sqlite.close();
    }
  });
});

describe("hashTakeoutBytes", () => {
  it("returns a 64-char hex digest", () => {
    const h = hashTakeoutBytes(Buffer.from("hello"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashTakeoutBytes(Buffer.from("a"))).toBe(
      hashTakeoutBytes(Buffer.from("a")),
    );
  });

  it("differs for different inputs", () => {
    expect(hashTakeoutBytes(Buffer.from("a"))).not.toBe(
      hashTakeoutBytes(Buffer.from("b")),
    );
  });
});
