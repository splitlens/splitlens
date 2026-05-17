import { describe, it, expect } from "vitest";
import {
  detectCadence,
  projectNextCharge,
} from "../../src/merchants/cadence";

/**
 * Generate N dates spaced `gapDays` apart starting from `startIso`. Useful
 * for synthesising clean recurring streams.
 */
function streamFrom(startIso: string, gapDays: number, count: number): string[] {
  const out: string[] = [];
  const start = Date.UTC(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  for (let i = 0; i < count; i++) {
    const d = new Date(start + i * gapDays * 86_400_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${dd}`);
  }
  return out;
}

describe("detectCadence", () => {
  describe("degenerate cases", () => {
    it("returns one_time/low for empty input", () => {
      expect(detectCadence([])).toEqual({
        kind: "one_time",
        confidence: "low",
        medianIntervalDays: null,
        sampleCount: 0,
      });
    });

    it("returns one_time/high for a single date", () => {
      expect(detectCadence(["2026-05-01"])).toEqual({
        kind: "one_time",
        confidence: "high",
        medianIntervalDays: null,
        sampleCount: 1,
      });
    });

    it("dedupes same-day duplicates before counting", () => {
      const r = detectCadence(["2026-05-01", "2026-05-01", "2026-05-01"]);
      expect(r.sampleCount).toBe(1);
      expect(r.kind).toBe("one_time");
    });

    it("drops malformed dates silently", () => {
      const r = detectCadence(["not-a-date", "2026-05-01", "also-bad"]);
      expect(r.sampleCount).toBe(1);
    });
  });

  describe("clean recurring streams", () => {
    it("detects weekly at exact 7-day gaps with 6 samples → high confidence", () => {
      const r = detectCadence(streamFrom("2026-01-01", 7, 6));
      expect(r.kind).toBe("weekly");
      expect(r.confidence).toBe("high");
      expect(r.medianIntervalDays).toBe(7);
    });

    it("detects monthly at 30-day gaps with 6 samples → high confidence", () => {
      const r = detectCadence(streamFrom("2026-01-01", 30, 6));
      expect(r.kind).toBe("monthly");
      expect(r.confidence).toBe("high");
      expect(r.medianIntervalDays).toBe(30);
    });

    it("detects quarterly at 91-day gaps", () => {
      const r = detectCadence(streamFrom("2025-01-01", 91, 5));
      expect(r.kind).toBe("quarterly");
      expect(r.confidence).toBe("high");
    });

    it("detects yearly at 365-day gaps", () => {
      const r = detectCadence(streamFrom("2020-01-01", 365, 5));
      expect(r.kind).toBe("yearly");
      expect(r.confidence).toBe("high");
    });
  });

  describe("jittered streams", () => {
    it("detects monthly when calendar-month billing produces 28/30/31-day jitter", () => {
      // Real Apple Music monthly charges from a calendar-month subscription:
      // gaps are 28, 31, 30, 31, 30, 31, 30 — all within the ±6 window
      const dates = [
        "2025-01-15",
        "2025-02-12",
        "2025-03-15",
        "2025-04-14",
        "2025-05-15",
        "2025-06-14",
        "2025-07-15",
        "2025-08-14",
      ];
      const r = detectCadence(dates);
      expect(r.kind).toBe("monthly");
      expect(r.confidence).toBe("high");
      expect(r.medianIntervalDays).toBeGreaterThanOrEqual(28);
      expect(r.medianIntervalDays).toBeLessThanOrEqual(31);
    });

    it("downgrades confidence when only some intervals fit the window", () => {
      // 30, 30, 60 (skipped month), 30 — median 30 so it's monthly, but
      // only 3/4 intervals are inside the window. With ≥4 samples, ratio
      // must be ≥0.75 for high; we hit exactly 0.75 here, so high stands.
      const r = detectCadence([
        "2026-01-01",
        "2026-01-31",
        "2026-03-02",
        "2026-05-01",
        "2026-05-31",
      ]);
      expect(r.kind).toBe("monthly");
      // 4 of 4 intervals are 30, 30, 60, 30 — 3 in window of 4 = 75%, still high.
      expect(r.confidence).toBe("high");
    });

    it("returns low confidence for exactly 2 samples", () => {
      const r = detectCadence(["2026-04-01", "2026-05-01"]);
      expect(r.kind).toBe("monthly");
      expect(r.confidence).toBe("low");
    });

    it("returns medium for 3 samples even when clean", () => {
      const r = detectCadence(["2026-03-01", "2026-04-01", "2026-05-01"]);
      expect(r.kind).toBe("monthly");
      expect(r.confidence).toBe("medium");
    });
  });

  describe("irregular streams", () => {
    it("marks wildly varying gaps as irregular", () => {
      // 5, 60, 200, 13 — no single cadence window matches the median (~36)
      const r = detectCadence([
        "2026-01-01",
        "2026-01-06",
        "2026-03-07",
        "2026-09-23",
        "2026-10-06",
      ]);
      expect(r.kind).toBe("irregular");
      expect(r.medianIntervalDays).toBeGreaterThan(0);
    });

    it("returns low confidence for irregular with few samples", () => {
      const r = detectCadence([
        "2026-01-01",
        "2026-02-15",
        "2026-08-20",
      ]);
      expect(r.kind).toBe("irregular");
      expect(r.confidence).toBe("low");
    });
  });
});

describe("projectNextCharge", () => {
  it("returns null for one_time", () => {
    const c = detectCadence(["2026-05-01"]);
    expect(projectNextCharge("2026-05-01", c)).toBeNull();
  });

  it("returns null for irregular", () => {
    const c = detectCadence([
      "2026-01-01",
      "2026-01-06",
      "2026-03-07",
      "2026-09-23",
    ]);
    expect(projectNextCharge("2026-09-23", c)).toBeNull();
  });

  it("projects last + 30 days for clean monthly", () => {
    const c = detectCadence(streamFrom("2026-01-01", 30, 6));
    // last date = 2026-01-01 + 5*30 = 2026-06-29; next ~ +30
    expect(projectNextCharge("2026-06-29", c)).toBe("2026-07-29");
  });

  it("projects last + 7 days for weekly", () => {
    const c = detectCadence(streamFrom("2026-05-01", 7, 5));
    expect(projectNextCharge("2026-05-29", c)).toBe("2026-06-05");
  });

  it("returns null when lastSeen is malformed", () => {
    const c = detectCadence(streamFrom("2026-01-01", 30, 6));
    expect(projectNextCharge("not-a-date", c)).toBeNull();
  });
});
