import { describe, it, expect } from "vitest";
import { matchTxn, type MatchableTxn } from "../src/match";

const TXNS: MatchableTxn[] = [
  { id: 1, date: "2026-05-10", amount: 154.0, narration: "UPI/ZEPTO MARKETPLACE" },
  { id: 2, date: "2026-05-11", amount: 290.0, narration: "BLINKIT GROCERY" },
  { id: 3, date: "2026-05-15", amount: 400.0, narration: "INSTAMART ORDER" },
  { id: 4, date: "2026-05-15", amount: 401.0, narration: "SWIGGY FOOD" },
  { id: 5, date: "2026-04-01", amount: 154.0, narration: "ZEPTO" }, // way out of date window
];

describe("matchTxn", () => {
  it("matches exact amount + same day", () => {
    const match = matchTxn(
      { date: "2026-05-10", amount: 154, merchant: "zepto" },
      TXNS,
    );
    expect(match?.id).toBe(1);
  });

  it("matches within ±1 day and ±₹2", () => {
    const match = matchTxn(
      { date: "2026-05-11", amount: 153, merchant: "zepto" }, // ₹1 off, 1 day off
      TXNS,
    );
    expect(match?.id).toBe(1);
  });

  it("rejects matches outside the date window", () => {
    const match = matchTxn(
      { date: "2026-05-10", amount: 154, merchant: "zepto" },
      [TXNS[4]!], // only the April txn
    );
    expect(match).toBeNull();
  });

  it("rejects matches outside the amount tolerance", () => {
    const match = matchTxn(
      { date: "2026-05-10", amount: 200, merchant: "zepto" },
      TXNS,
    );
    expect(match).toBeNull();
  });

  it("uses merchant narration as a tiebreaker when multiple txns fit", () => {
    // 400 ± 2 covers both txn 3 (Instamart) and txn 4 (Swiggy). Merchant
    // narration tiebreaker should pick Instamart.
    const match = matchTxn(
      { date: "2026-05-15", amount: 400, merchant: "instamart" },
      TXNS,
    );
    expect(match?.id).toBe(3);
  });

  it("returns the closer txn when no narration tiebreaker resolves", () => {
    const txns: MatchableTxn[] = [
      { id: "a", date: "2026-05-10", amount: 154, narration: "MERCHANT A" },
      { id: "b", date: "2026-05-10", amount: 155, narration: "MERCHANT B" },
    ];
    const match = matchTxn({ date: "2026-05-10", amount: 154, merchant: "unknown" }, txns);
    expect(match?.id).toBe("a");
  });

  it("returns null when txns are truly indistinguishable", () => {
    const txns: MatchableTxn[] = [
      { id: "a", date: "2026-05-10", amount: 100, narration: "FOO" },
      { id: "b", date: "2026-05-10", amount: 100, narration: "BAR" },
    ];
    const match = matchTxn({ date: "2026-05-10", amount: 100, merchant: "baz" }, txns);
    expect(match).toBeNull();
  });

  it("handles signed amounts (debits stored as negative numbers)", () => {
    const txns: MatchableTxn[] = [
      { id: "a", date: "2026-05-10", amount: -154, narration: "ZEPTO" },
    ];
    const match = matchTxn({ date: "2026-05-10", amount: 154, merchant: "zepto" }, txns);
    expect(match?.id).toBe("a");
  });

  it("returns null for malformed receipt dates", () => {
    const match = matchTxn(
      { date: "not-a-date", amount: 154, merchant: "zepto" },
      TXNS,
    );
    expect(match).toBeNull();
  });
});
