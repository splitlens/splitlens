import { describe, it, expect } from "vitest";
import {
  matchLocation,
  istLocalToUtcMs,
  utcMsToIstHhmm,
  type LocationCandidate,
} from "../../src/location/match";

// Helper: build a UTC ms from an ISO instant string.
const ms = (iso: string): number => Date.parse(iso);

describe("matchLocation", () => {
  it("returns null when there are no candidates", () => {
    expect(matchLocation(ms("2026-05-14T18:45:00Z"), [])).toBeNull();
  });

  it("returns null when txn time is NaN", () => {
    expect(matchLocation(Number.NaN, [])).toBeNull();
  });

  it("picks a semantic stay covering the timestamp with high confidence", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "semantic",
        startUtcMs: ms("2026-05-14T18:23:47Z"),
        endUtcMs: ms("2026-05-14T19:47:00Z"),
        lat: 12.83,
        lng: 77.8,
        placeName: "Cult.fit Indiranagar",
        placeId: "ChIJabc",
        placeCategory: "TYPE_GYM",
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:45:00Z"), candidates);
    expect(m).not.toBeNull();
    expect(m!.placeName).toBe("Cult.fit Indiranagar");
    expect(m!.confidence).toBe("high");
    expect(m!.source).toBe("semantic_stay");
    expect(m!.deltaMinutes).toBe(0);
  });

  it("prefers semantic stay over a raw ping that's closer in time", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "semantic",
        startUtcMs: ms("2026-05-14T18:00:00Z"),
        endUtcMs: ms("2026-05-14T19:00:00Z"),
        lat: 12.0,
        lng: 77.0,
        placeName: "Restaurant",
        placeId: null,
        placeCategory: "RESTAURANT",
      },
      {
        // Raw ping right at the txn time — but semantic should still win.
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:30:00Z"),
        lat: 13.0,
        lng: 78.0,
        accuracyM: 5,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates);
    expect(m!.source).toBe("semantic_stay");
    expect(m!.placeName).toBe("Restaurant");
  });

  it("picks the closest raw ping when no semantic stay covers the time", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:25:00Z"),
        lat: 12.5,
        lng: 77.5,
        accuracyM: 15,
      },
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:33:00Z"),
        lat: 12.6,
        lng: 77.6,
        accuracyM: 10,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates);
    expect(m!.source).toBe("raw_ping");
    expect(m!.lat).toBe(12.6); // 3-min delta beats 5-min delta
    expect(m!.placeName).toBeNull();
  });

  it("assigns medium confidence for raw pings within 5 min", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:32:00Z"),
        lat: 12.5,
        lng: 77.5,
        accuracyM: 10,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates);
    expect(m!.confidence).toBe("medium");
    expect(m!.deltaMinutes).toBe(2);
  });

  it("assigns low confidence for raw pings 5-15 min away", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:40:00Z"),
        lat: 12.5,
        lng: 77.5,
        accuracyM: 10,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates);
    expect(m!.confidence).toBe("low");
    expect(m!.deltaMinutes).toBe(10);
  });

  it("rejects raw pings beyond default 15-min tolerance", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:00:00Z"),
        lat: 12.5,
        lng: 77.5,
        accuracyM: 10,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates);
    expect(m).toBeNull();
  });

  it("honours a custom maxRawDeltaMinutes", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:00:00Z"),
        lat: 12.5,
        lng: 77.5,
        accuracyM: 10,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates, {
      maxRawDeltaMinutes: 60,
    });
    expect(m).not.toBeNull();
    expect(m!.deltaMinutes).toBe(30);
  });

  it("ties on delta → prefers tighter accuracy", () => {
    const candidates: LocationCandidate[] = [
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:35:00Z"),
        lat: 12.5,
        lng: 77.5,
        accuracyM: 50,
      },
      {
        kind: "raw",
        timestampUtcMs: ms("2026-05-14T18:35:00Z"),
        lat: 13.5,
        lng: 78.5,
        accuracyM: 5,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates);
    expect(m!.accuracyM).toBe(5);
  });

  it("among multiple covering stays, picks the one whose centre is closest", () => {
    // Wider stay's centre is 18:35; tight stay's centre is 18:30. Txn at 18:30.
    const candidates: LocationCandidate[] = [
      {
        kind: "semantic",
        startUtcMs: ms("2026-05-14T18:10:00Z"),
        endUtcMs: ms("2026-05-14T19:00:00Z"),
        lat: 12.0,
        lng: 77.0,
        placeName: "Wider stay",
        placeId: null,
        placeCategory: null,
      },
      {
        kind: "semantic",
        startUtcMs: ms("2026-05-14T18:25:00Z"),
        endUtcMs: ms("2026-05-14T18:35:00Z"),
        lat: 13.0,
        lng: 78.0,
        placeName: "Tight stay",
        placeId: null,
        placeCategory: null,
      },
    ];
    const m = matchLocation(ms("2026-05-14T18:30:00Z"), candidates);
    expect(m!.placeName).toBe("Tight stay");
  });
});

describe("istLocalToUtcMs", () => {
  it("converts IST date+time to UTC ms with the +5:30 offset", () => {
    // 18:30 IST = 13:00 UTC
    const out = istLocalToUtcMs("2026-05-14", "18:30");
    expect(out).toBe(ms("2026-05-14T13:00:00Z"));
  });

  it("handles midnight-cross IST → previous-day UTC", () => {
    // 02:00 IST on the 14th = 20:30 UTC on the 13th
    const out = istLocalToUtcMs("2026-05-14", "02:00");
    expect(out).toBe(ms("2026-05-13T20:30:00Z"));
  });

  it("returns null for malformed inputs", () => {
    expect(istLocalToUtcMs(null, "10:00")).toBeNull();
    expect(istLocalToUtcMs("2026-05-14", null)).toBeNull();
    expect(istLocalToUtcMs("not-a-date", "10:00")).toBeNull();
    expect(istLocalToUtcMs("2026-05-14", "25:00")).toBeNull();
    expect(istLocalToUtcMs("2026-05-14", "10:99")).toBeNull();
    expect(istLocalToUtcMs("2026-05-14", "1030")).toBeNull();
  });

  it("roundtrips through utcMsToIstHhmm", () => {
    const utc = istLocalToUtcMs("2026-05-14", "23:00");
    expect(utc).not.toBeNull();
    expect(utcMsToIstHhmm(utc!)).toBe("23:00");
  });

  it("utcMsToIstHhmm handles midnight crossover", () => {
    // 19:00 UTC = 00:30 IST next day
    expect(utcMsToIstHhmm(ms("2026-05-14T19:00:00Z"))).toBe("00:30");
  });
});
