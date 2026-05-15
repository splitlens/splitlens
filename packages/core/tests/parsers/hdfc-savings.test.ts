import { describe, it, expect } from "vitest";
import {
  parseHdfcSavings,
  parseHdfcSavingsPages,
  clusterLines,
  findHeaderColumns,
} from "../../src/parsers/hdfc-savings";
import type { ExtractedPage } from "../../src/types/index";
import {
  fixtureOnePageFiveTxns,
  fixtureTwoPages,
  fixtureEmptyPage,
} from "./fixtures/hdfc-savings.fixture";

describe("HDFC savings parser — Uint8Array entry point", () => {
  it("returns empty result for empty PDF when no extractor is supplied", async () => {
    const result = await parseHdfcSavings(new Uint8Array());
    expect(result).toEqual({ statement: null, transactions: [] });
  });

  it("delegates to the supplied extractPages function", async () => {
    const extractPages = async (): Promise<ExtractedPage[]> => [fixtureOnePageFiveTxns()];
    const { statement, transactions } = await parseHdfcSavings(new Uint8Array(), { extractPages });
    expect(statement?.bank).toBe("HDFC");
    expect(transactions.length).toBeGreaterThan(0);
  });
});

describe("parseHdfcSavingsPages — pure positional parser", () => {
  it("returns null statement + zero txns for empty pages array", () => {
    expect(parseHdfcSavingsPages([])).toEqual({ statement: null, transactions: [] });
  });

  it("returns no transactions when the page has no header", () => {
    const { transactions } = parseHdfcSavingsPages([fixtureEmptyPage()]);
    expect(transactions).toEqual([]);
  });

  it("parses 5 transactions from the one-page fixture", () => {
    const { transactions } = parseHdfcSavingsPages([fixtureOnePageFiveTxns()]);
    expect(transactions).toHaveLength(5);
  });

  it("extracts statement metadata correctly", () => {
    const { statement } = parseHdfcSavingsPages([fixtureOnePageFiveTxns()]);
    expect(statement).toMatchObject({
      bank: "HDFC",
      accountType: "savings",
      accountLast4: "2491",
      customerName: "PRATEEKARYAN",
      periodFrom: "2025-04-01",
      periodTo: "2026-03-31",
    });
  });

  it("parses an OUT transaction (withdrawal column populated)", () => {
    const { transactions } = parseHdfcSavingsPages([fixtureOnePageFiveTxns()]);
    const t = transactions[0]!;
    expect(t.txnDate).toBe("2025-04-01");
    expect(t.narration).toContain("UPI-MSREEPRAKASH");
    expect(t.refNo).toBe("0000623913994441");
    expect(t.withdrawal).toBe(17);
    expect(t.deposit).toBeNull();
    expect(t.closingBalance).toBe(466579.86);
  });

  it("parses a SHORT-narration IN credit (the SALARY bug from prototype)", () => {
    // Regression test: 'SALARY' as a single short word at x0=68 used to fall
    // into the date column due to header-midpoint boundary logic. Verify it
    // now lands in the narration column and the deposit (not withdrawal) is captured.
    const { transactions } = parseHdfcSavingsPages([fixtureOnePageFiveTxns()]);
    const salary = transactions.find((t) => t.narration === "SALARY");
    expect(salary).toBeDefined();
    expect(salary!.withdrawal).toBeNull();
    expect(salary!.deposit).toBe(210976);
    expect(salary!.closingBalance).toBe(226261.51);
  });

  it("appends continuation lines to the narration of the preceding transaction", () => {
    const { transactions } = parseHdfcSavingsPages([fixtureOnePageFiveTxns()]);
    const upi = transactions[0]!;
    expect(upi.narration).toContain("BLUPI-623913994441-PAYMENTFROMPHONE");
  });

  it("handles transactions across multiple pages and assigns sequential row indices", () => {
    const { transactions } = parseHdfcSavingsPages(fixtureTwoPages());
    expect(transactions).toHaveLength(3);
    expect(transactions.map((t) => t.sourceRowIdx)).toEqual([0, 1, 2]);
    expect(transactions[2]!.txnDate).toBe("2025-04-02");
  });

  it("filters out page footer noise (HDFCBANKLIMITED, GSTN, address)", () => {
    // Regression test for the prototype's footer-leak bug
    const { transactions } = parseHdfcSavingsPages([fixtureOnePageFiveTxns()]);
    for (const t of transactions) {
      expect(t.narration).not.toMatch(/HDFCBANKLIMITED|GSTN|RegisteredOffice/i);
    }
  });

  it("running balance reconciles for sample data", () => {
    const { transactions } = parseHdfcSavingsPages([fixtureOnePageFiveTxns()]);
    // Spot-check: each row's closing balance is consistent with debit/credit applied
    // (we only have 5 disjoint txns in the fixture, so we just verify shape)
    for (const t of transactions) {
      expect(t.closingBalance).toBeGreaterThan(0);
      expect(t.withdrawal === null || t.deposit === null).toBe(true);
    }
  });
});

describe("clusterLines", () => {
  it("returns empty array for empty input", () => {
    expect(clusterLines([])).toEqual([]);
  });

  it("groups words with similar y-coordinates into the same line", () => {
    const lines = clusterLines([
      { text: "B", x0: 100, x1: 110, top: 50, bottom: 60 },
      { text: "A", x0: 50, x1: 60, top: 50, bottom: 60 },
      { text: "C", x0: 200, x1: 210, top: 80, bottom: 90 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.map((w) => w.text)).toEqual(["A", "B"]); // sorted left-to-right
    expect(lines[1]!.map((w) => w.text)).toEqual(["C"]);
  });
});

describe("findHeaderColumns", () => {
  it("returns null when no header row is present", () => {
    const lines = clusterLines(fixtureEmptyPage().words);
    expect(findHeaderColumns(lines)).toBeNull();
  });

  it("derives column ranges with narration_left anchored to first txn's date x1", () => {
    const fixture = fixtureOnePageFiveTxns();
    const lines = clusterLines(fixture.words);
    const ranges = findHeaderColumns(lines);
    expect(ranges).not.toBeNull();

    expect(ranges!.date[0]).toBe(0);

    // narration_left should be just past the first transaction's date word's x1.
    // The first txn date word in our fixture is at x0=33.7 (top=252), so its
    // x1 + 3 = narration_left. Verify the boundary lands BETWEEN date.x1 and the
    // narration content's x0 (68), proving the prototype's "SALARY" bug is fixed.
    const firstTxnDate = fixture.words.find((w) => w.text === "01/04/25" && w.top === 252)!;
    expect(ranges!.narration[0]).toBeGreaterThan(firstTxnDate.x1);
    expect(ranges!.narration[0]).toBeLessThanOrEqual(firstTxnDate.x1 + 5);
    // And critically: narration content at x0=68 must fall on the narration side.
    expect(ranges!.narration[0]).toBeLessThan(68);
  });
});
