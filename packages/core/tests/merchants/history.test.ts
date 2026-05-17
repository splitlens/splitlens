import { describe, it, expect } from "vitest";
import {
  summarizeMerchant,
  type MerchantTxnLite,
} from "../../src/merchants/history";

const row = (
  id: number,
  date: string,
  amountInr: number,
): MerchantTxnLite => ({ id, date, amountInr });

describe("summarizeMerchant", () => {
  it("returns null for empty input", () => {
    expect(summarizeMerchant([])).toBeNull();
  });

  it("handles a single charge", () => {
    const r = summarizeMerchant([row(1, "2026-05-01", 159)]);
    expect(r).not.toBeNull();
    expect(r!.count).toBe(1);
    expect(r!.totalSpentInr).toBe(159);
    expect(r!.medianAmountInr).toBe(159);
    expect(r!.minAmountInr).toBe(159);
    expect(r!.maxAmountInr).toBe(159);
    expect(r!.firstSeen).toBe("2026-05-01");
    expect(r!.lastSeen).toBe("2026-05-01");
    expect(r!.distinctAmounts).toHaveLength(1);
    expect(r!.distinctAmounts[0]).toEqual({
      amountInr: 159,
      count: 1,
      lastDate: "2026-05-01",
      containsFocus: false,
    });
    expect(r!.cadence.kind).toBe("one_time");
    expect(r!.nextExpectedDate).toBeNull();
  });

  it("aggregates a clean monthly Apple Music stream", () => {
    const rows = [
      row(1, "2025-01-15", 99),
      row(2, "2025-02-14", 99),
      row(3, "2025-03-15", 99),
      row(4, "2025-04-14", 99),
      row(5, "2025-05-15", 99),
      row(6, "2025-06-14", 99),
    ];
    const r = summarizeMerchant(rows)!;
    expect(r.count).toBe(6);
    expect(r.totalSpentInr).toBe(594);
    expect(r.medianAmountInr).toBe(99);
    expect(r.firstSeen).toBe("2025-01-15");
    expect(r.lastSeen).toBe("2025-06-14");
    expect(r.cadence.kind).toBe("monthly");
    expect(r.cadence.confidence).toBe("high");
    expect(r.nextExpectedDate).not.toBeNull();
  });

  it("buckets distinct amounts and sorts by count desc", () => {
    // 3 × ₹159, 2 × ₹99, 1 × ₹59 — three different Apple subs at the
    // canonical Apple price points.
    const rows = [
      row(1, "2026-01-01", 159),
      row(2, "2026-01-15", 99),
      row(3, "2026-02-01", 159),
      row(4, "2026-02-15", 99),
      row(5, "2026-03-01", 159),
      row(6, "2026-03-10", 59),
    ];
    const r = summarizeMerchant(rows)!;
    expect(r.distinctAmounts).toEqual([
      { amountInr: 159, count: 3, lastDate: "2026-03-01", containsFocus: false },
      { amountInr: 99, count: 2, lastDate: "2026-02-15", containsFocus: false },
      { amountInr: 59, count: 1, lastDate: "2026-03-10", containsFocus: false },
    ]);
  });

  it("marks the focus transaction's amount group", () => {
    const rows = [
      row(1, "2026-01-01", 159),
      row(2, "2026-02-01", 99),
      row(3, "2026-02-15", 159),
    ];
    const r = summarizeMerchant(rows, /* focusTxnId */ 3)!;
    const focused = r.distinctAmounts.find((d) => d.containsFocus);
    expect(focused?.amountInr).toBe(159);
    expect(r.distinctAmounts.filter((d) => d.containsFocus)).toHaveLength(1);
  });

  it("handles unsorted input correctly (sorts before computing)", () => {
    const rows = [
      row(2, "2026-03-01", 99),
      row(1, "2026-01-01", 99),
      row(3, "2026-02-01", 99),
    ];
    const r = summarizeMerchant(rows)!;
    expect(r.firstSeen).toBe("2026-01-01");
    expect(r.lastSeen).toBe("2026-03-01");
  });

  it("rounds non-integer amounts so paisa jitter doesn't fracture buckets", () => {
    const rows = [
      row(1, "2026-01-01", 159.0),
      row(2, "2026-02-01", 159.49),
      row(3, "2026-03-01", 158.51),
    ];
    const r = summarizeMerchant(rows)!;
    expect(r.distinctAmounts).toHaveLength(1);
    expect(r.distinctAmounts[0]!.amountInr).toBe(159);
    expect(r.distinctAmounts[0]!.count).toBe(3);
  });

  it("reports min/median/max for high-variance merchants", () => {
    // A grocery-like merchant: many distinct amounts, no repetition.
    const rows = [
      row(1, "2025-01-01", 250),
      row(2, "2025-01-08", 1_800),
      row(3, "2025-01-15", 470),
      row(4, "2025-01-22", 95),
      row(5, "2025-01-29", 3_200),
    ];
    const r = summarizeMerchant(rows)!;
    expect(r.minAmountInr).toBe(95);
    expect(r.maxAmountInr).toBe(3_200);
    expect(r.medianAmountInr).toBe(470);
  });

  it("projects next charge when cadence is recognisable", () => {
    const rows = [
      row(1, "2026-01-01", 99),
      row(2, "2026-01-31", 99),
      row(3, "2026-03-02", 99),
      row(4, "2026-04-01", 99),
      row(5, "2026-05-01", 99),
    ];
    const r = summarizeMerchant(rows)!;
    expect(r.cadence.kind).toBe("monthly");
    expect(r.nextExpectedDate).toBe("2026-05-31");
  });
});
