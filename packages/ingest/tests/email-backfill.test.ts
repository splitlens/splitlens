/**
 * Tests for `pickEmailMatches` — the pure matching step inside
 * `backfillSwiggyZomatoItems`. Carved out from the IMAP-driven function so
 * we can validate the date/amount window logic, merchant gating, and
 * one-email-per-candidate semantics without a live mailbox.
 */
import { describe, it, expect } from "vitest";
import {
  pickEmailMatches,
  type CandidateTxn,
  type IndexedEmail,
} from "../src/email-backfill";

const DAY_MS = 86400 * 1000;

function indexFromEmails(emails: IndexedEmail[]): Map<number, IndexedEmail[]> {
  const out = new Map<number, IndexedEmail[]>();
  for (const e of emails) {
    const key = Math.round(e.amount * 100);
    const list = out.get(key);
    if (list) list.push(e);
    else out.set(key, [e]);
  }
  return out;
}

function swiggyEmail(over: Partial<IndexedEmail> = {}): IndexedEmail {
  return {
    amount: 403,
    emailMs: new Date("2026-04-12T18:00:00Z").getTime(),
    merchant: "swiggy",
    extractorId: "swiggy",
    sourceTxnId: "order-1",
    fields: {
      kind: "food_delivery",
      amount: 403,
      orderId: "order-1",
      restaurant: "Some Place",
      items: [{ qty: 1, name: "Roasted Chicken Salad", price: 349 }],
    },
    summary: "Swiggy: 1 item · ₹403.00",
    ...over,
  };
}

function zomatoEmail(over: Partial<IndexedEmail> = {}): IndexedEmail {
  return {
    amount: 612.5,
    emailMs: new Date("2026-04-15T20:30:00Z").getTime(),
    merchant: "zomato",
    extractorId: "zomato",
    sourceTxnId: "zo-1",
    fields: {
      kind: "zomato_delivery",
      amount: 612.5,
      orderId: "zo-1",
      restaurant: "Pizza Place",
      items: [{ qty: 2, name: "Cheese Pizza" }],
    },
    summary: "Zomato @ Pizza Place: 1 items · ₹612.50",
    ...over,
  };
}

function candidate(over: Partial<CandidateTxn> = {}): CandidateTxn {
  return {
    id: 1,
    txnDate: "2026-04-12",
    withdrawal: 403,
    counterparty: "Swiggy",
    ...over,
  };
}

describe("pickEmailMatches", () => {
  it("matches a candidate to a same-day, exact-amount email", () => {
    const idx = indexFromEmails([swiggyEmail()]);
    const { picks, unmatched } = pickEmailMatches([candidate()], idx);
    expect(picks).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
    expect(picks[0]!.email.sourceTxnId).toBe("order-1");
  });

  it("tolerates a ±2 day window", () => {
    const idx = indexFromEmails([
      swiggyEmail({
        // ~1.5 days after the candidate date — well inside ±2.
        emailMs: new Date("2026-04-13T12:00:00Z").getTime(),
        sourceTxnId: "near",
      }),
    ]);
    const { picks } = pickEmailMatches([candidate({ txnDate: "2026-04-12" })], idx);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.email.sourceTxnId).toBe("near");
  });

  it("rejects emails outside the ±2 day window", () => {
    const idx = indexFromEmails([
      swiggyEmail({
        emailMs: new Date("2026-04-20T05:00:00Z").getTime(),
        sourceTxnId: "far",
      }),
    ]);
    const { picks, unmatched } = pickEmailMatches([candidate({ txnDate: "2026-04-12" })], idx);
    expect(picks).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it("tolerates ±₹2 amount drift (banker's rounding, tips, etc.)", () => {
    const idx = indexFromEmails([
      swiggyEmail({ amount: 405, sourceTxnId: "off-by-2" }),
    ]);
    const { picks } = pickEmailMatches([candidate({ withdrawal: 403 })], idx);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.email.sourceTxnId).toBe("off-by-2");
  });

  it("rejects amounts more than ₹2 apart", () => {
    const idx = indexFromEmails([
      swiggyEmail({ amount: 412, sourceTxnId: "off-by-9" }),
    ]);
    const { picks, unmatched } = pickEmailMatches([candidate({ withdrawal: 403 })], idx);
    expect(picks).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it("respects merchant gating — a Zomato email never attaches to a Swiggy txn", () => {
    const idx = indexFromEmails([
      zomatoEmail({ amount: 403, emailMs: new Date("2026-04-12T18:00:00Z").getTime() }),
    ]);
    const { picks, unmatched } = pickEmailMatches(
      [candidate({ counterparty: "Swiggy", withdrawal: 403 })],
      idx,
    );
    expect(picks).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it("picks the closest match when multiple compete", () => {
    const idx = indexFromEmails([
      swiggyEmail({
        amount: 403,
        emailMs: new Date("2026-04-13T05:00:00Z").getTime(),
        sourceTxnId: "next-day-exact",
      }),
      swiggyEmail({
        amount: 402,
        emailMs: new Date("2026-04-12T12:00:00Z").getTime(),
        sourceTxnId: "same-day-off-by-1",
      }),
    ]);
    const { picks } = pickEmailMatches(
      [candidate({ txnDate: "2026-04-12", withdrawal: 403 })],
      idx,
    );
    expect(picks).toHaveLength(1);
    // Same-day-off-by-1 wins: |1| + |0.5d| = 1.5  vs.  |0| + |1d| = 1.0…
    // Actually |0| + 1 day = 1.0; |1| + 0.5d = 1.5 → next-day-exact should win.
    expect(picks[0]!.email.sourceTxnId).toBe("next-day-exact");
  });

  it("never assigns the same email to two candidates", () => {
    const sharedEmail = swiggyEmail({ sourceTxnId: "single" });
    const idx = indexFromEmails([sharedEmail]);
    const cands: CandidateTxn[] = [
      candidate({ id: 1, txnDate: "2026-04-12", withdrawal: 403 }),
      candidate({ id: 2, txnDate: "2026-04-13", withdrawal: 403 }),
    ];
    const { picks, unmatched } = pickEmailMatches(cands, idx);
    expect(picks).toHaveLength(1);
    // The earlier candidate (sorted by date asc) gets it.
    expect(picks[0]!.candidate.id).toBe(1);
    expect(unmatched.map((c) => c.id)).toEqual([2]);
  });

  it("matches Instamart txns via the Swiggy needle", () => {
    const idx = indexFromEmails([
      swiggyEmail({
        sourceTxnId: "instamart-1",
        fields: { kind: "instamart", amount: 403, items: [] },
      }),
    ]);
    const { picks } = pickEmailMatches(
      [candidate({ counterparty: "SWIGGYINSTAMART", withdrawal: 403 })],
      idx,
    );
    expect(picks).toHaveLength(1);
  });

  it("matches messy bank narrations like 'upiswiggy@icici'", () => {
    const idx = indexFromEmails([swiggyEmail({ sourceTxnId: "messy" })]);
    const { picks } = pickEmailMatches(
      [candidate({ counterparty: "upiswiggy@icici", withdrawal: 403 })],
      idx,
    );
    expect(picks).toHaveLength(1);
  });

  it("skips candidates whose counterparty matches neither merchant", () => {
    const idx = indexFromEmails([swiggyEmail()]);
    const { picks, unmatched } = pickEmailMatches(
      [candidate({ counterparty: "Blinkit" })],
      idx,
    );
    expect(picks).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it("returns empty when index is empty", () => {
    const { picks, unmatched } = pickEmailMatches(
      [candidate()],
      new Map<number, IndexedEmail[]>(),
    );
    expect(picks).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it("handles paise-level rounding (₹403.50 vs key 40350)", () => {
    const idx = indexFromEmails([
      swiggyEmail({ amount: 403.5, sourceTxnId: "paise" }),
    ]);
    const { picks } = pickEmailMatches(
      [candidate({ withdrawal: 403.5 })],
      idx,
    );
    expect(picks).toHaveLength(1);
    expect(picks[0]!.email.sourceTxnId).toBe("paise");
  });

  it("scores a 0-day exact match strictly better than a 1.5-day exact match", () => {
    // Tests the date-weight tie-breaker.
    const idx = indexFromEmails([
      swiggyEmail({
        amount: 403,
        emailMs: new Date("2026-04-12T18:00:00Z").getTime(),
        sourceTxnId: "same-day",
      }),
      swiggyEmail({
        amount: 403,
        emailMs: new Date("2026-04-12T18:00:00Z").getTime() + 1.5 * DAY_MS,
        sourceTxnId: "later",
      }),
    ]);
    const { picks } = pickEmailMatches(
      [candidate({ txnDate: "2026-04-12", withdrawal: 403 })],
      idx,
    );
    expect(picks[0]!.email.sourceTxnId).toBe("same-day");
  });
});
