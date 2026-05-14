import { describe, it, expect } from "vitest";
import { parseHdfcSavings } from "../../src/parsers/hdfc-savings.js";

describe("HDFC Savings parser — STUB (Week 2 will implement)", () => {
  it("returns empty result for empty input", async () => {
    const result = await parseHdfcSavings(new Uint8Array());
    expect(result).toEqual({ statement: null, transactions: [] });
  });

  // RED tests below: these will fail until Week 2 implementation lands.
  // They serve as the test contract the parser must eventually satisfy.

  it.skip("[RED] extracts statement metadata from a real HDFC PDF", async () => {
    // TODO Week 2: drop a redacted fixture into tests/fixtures/hdfc-savings-1page.pdf
    // const pdf = readFixture("hdfc-savings-1page.pdf");
    // const { statement } = await parseHdfcSavings(pdf, { password: "test" });
    // expect(statement).toMatchObject({
    //   bank: "HDFC",
    //   accountType: "savings",
    //   accountLast4: "2491",
    //   periodFrom: "2025-04-01",
    //   periodTo: "2026-03-31",
    // });
  });

  it.skip("[RED] reconciles running balance across all transactions", async () => {
    // TODO Week 2: assert prev_balance - withdrawal + deposit == closing_balance for every row
  });

  it.skip("[RED] strips footer noise (HDFCBANKLIMITED, GSTN) from last txn on each page", async () => {
    // TODO Week 2: regression test for the footer-leak bug from the Python prototype
  });
});
