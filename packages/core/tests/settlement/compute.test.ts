import { describe, it, expect } from "vitest";
import { computeSettlement } from "../../src/settlement/index";
import type { Person, RawTransaction, SharedTransaction } from "../../src/types/index";

const RAHUL: Person = {
  id: "rahul",
  displayName: "Rahul Kumar",
  upiPatterns: ["RAHUL.*?(9525680445|RAHUL\\.GR8DPS)"],
};

const SHIVAM: Person = {
  id: "shivam",
  displayName: "Shivam Ramsurat",
  upiPatterns: ["SHIVAMRAMSURAT|SHIVAMWA786|SHIVAMWA321"],
};

describe("computeSettlement", () => {
  it("returns empty object for no shared txns and no people", () => {
    expect(computeSettlement([], [], {})).toEqual({});
  });

  it("returns empty object for no shared txns even with people configured", () => {
    expect(computeSettlement([], [], { rahul: RAHUL, shivam: SHIVAM })).toEqual({});
  });

  it("ignores IN transactions in sharedTxns (only OUT counts)", () => {
    const sharedIn: SharedTransaction[] = [
      { id: 1, amount: 1000, sharedWith: ["rahul"], shareCount: 2, direction: "in" },
    ];
    expect(computeSettlement(sharedIn, [], { rahul: RAHUL })).toEqual({});
  });

  it("3-way split: ₹9000 paid by me, shared with Rahul + Shivam → each owes ₹3000", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 9000, sharedWith: ["rahul", "shivam"], shareCount: 3, direction: "out" },
    ];
    const result = computeSettlement(txns, [], { rahul: RAHUL, shivam: SHIVAM });
    expect(result.rahul).toEqual({ owesMe: 3000, paidBack: 0, net: 3000 });
    expect(result.shivam).toEqual({ owesMe: 3000, paidBack: 0, net: 3000 });
  });

  it("2-way split: ₹17000 with Rahul → Rahul owes ₹8500", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 17000, sharedWith: ["rahul"], shareCount: 2, direction: "out" },
    ];
    const result = computeSettlement(txns, [], { rahul: RAHUL });
    expect(result.rahul).toEqual({ owesMe: 8500, paidBack: 0, net: 8500 });
  });

  it("aggregates multiple shared txns per person", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 9000, sharedWith: ["rahul"], shareCount: 2, direction: "out" },
      { id: 2, amount: 3000, sharedWith: ["rahul"], shareCount: 2, direction: "out" },
    ];
    const result = computeSettlement(txns, [], { rahul: RAHUL });
    expect(result.rahul?.owesMe).toBe(6000);
  });

  it("subtracts repayments matched by UPI pattern from net owed", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 9000, sharedWith: ["rahul"], shareCount: 2, direction: "out" },
    ];
    const inflows: RawTransaction[] = [
      {
        txnDate: "2026-03-15",
        narration: "UPI-RAHULKUMAR-9525680445@YBL-HDFC0000235-...",
        withdrawal: null,
        deposit: 4500,
        sourceRowIdx: 0,
      },
    ];
    const result = computeSettlement(txns, inflows, { rahul: RAHUL });
    expect(result.rahul).toEqual({ owesMe: 4500, paidBack: 4500, net: 0 });
  });

  it("a person not in PEOPLE config still accrues owesMe (no inflow matching, but tracked)", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 1000, sharedWith: ["unknown_person"], shareCount: 2, direction: "out" },
    ];
    const result = computeSettlement(txns, [], {});
    expect(result.unknown_person).toEqual({ owesMe: 500, paidBack: 0, net: 500 });
  });

  it("rounds amounts to 2 decimal places (no floating-point cruft)", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 100, sharedWith: ["rahul", "shivam"], shareCount: 3, direction: "out" },
    ];
    const result = computeSettlement(txns, [], { rahul: RAHUL, shivam: SHIVAM });
    // 100 / 3 = 33.333... → rounded to 33.33
    expect(result.rahul?.owesMe).toBe(33.33);
    expect(result.shivam?.owesMe).toBe(33.33);
  });

  it("net can be negative if I've been overpaid (rare but possible)", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 1000, sharedWith: ["rahul"], shareCount: 2, direction: "out" },
    ];
    const inflows: RawTransaction[] = [
      {
        txnDate: "2026-03-15",
        narration: "UPI-RAHULKUMAR-9525680445@YBL-...",
        withdrawal: null,
        deposit: 700, // overpaid by 200
        sourceRowIdx: 0,
      },
    ];
    const result = computeSettlement(txns, inflows, { rahul: RAHUL });
    expect(result.rahul?.net).toBe(-200);
  });

  it("normalizes person ids to lowercase", () => {
    const txns: SharedTransaction[] = [
      { id: 1, amount: 1000, sharedWith: ["RAHUL", "Shivam"], shareCount: 3, direction: "out" },
    ];
    const result = computeSettlement(txns, [], {});
    expect(result.rahul?.owesMe).toBeCloseTo(333.33, 2);
    expect(result.shivam?.owesMe).toBeCloseTo(333.33, 2);
    expect(result.RAHUL).toBeUndefined();
  });
});
