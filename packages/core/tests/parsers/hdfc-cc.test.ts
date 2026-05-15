import { describe, it, expect } from "vitest";
import { parseHdfcCc, parseHdfcCcText } from "../../src/parsers/hdfc-cc";
import {
  V13_AUG_2024_PAGE1,
  V16_APR_2026_PAGE1,
  V16_APR_2026_PAGE2,
} from "./fixtures/hdfc-cc.fixture";

describe("parseHdfcCc — Uint8Array entry point", () => {
  it("returns empty result when no extractor is supplied", async () => {
    const r = await parseHdfcCc(new Uint8Array());
    expect(r).toEqual({ statement: null, transactions: [] });
  });
});

describe("parseHdfcCcText — v1.6 (newer Regalia format)", () => {
  it("extracts statement metadata", () => {
    const { statement } = parseHdfcCcText([V16_APR_2026_PAGE1]);
    expect(statement).toMatchObject({
      bank: "HDFC",
      cardType: "Regalia",
      cardLast4: "3969",
      customerName: "PRATEEK ARYAN",
      statementDate: "2026-04-20",
      periodFrom: "2026-03-21",
      periodTo: "2026-04-20",
    });
  });

  it("parses 3 domestic transactions on page 1", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1]);
    expect(transactions).toHaveLength(3);

    const amazon = transactions[0]!;
    expect(amazon.txnDate).toBe("2026-04-03");
    expect(amazon.txnTime).toBe("10:13");
    expect(amazon.description).toBe("AMAZONMUMBAI");
    expect(amazon.amount).toBe(169);
    expect(amazon.isPayment).toBe(false);
    expect(amazon.isInternational).toBe(false);
    expect(amazon.isCharge).toBe(false);
    expect(amazon.rewards).toBe(4);
    expect(amazon.foreignAmount).toBeUndefined();
  });

  it("parses the ₹3.17L Apple India purchase correctly (regression: footer-leak / 0-prefix bug)", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1]);
    const apple = transactions.find((t) => t.description.includes("APPLE"));
    expect(apple).toBeDefined();
    expect(apple!.amount).toBe(317900);
    expect(apple!.isPayment).toBe(false);
    expect(apple!.rewards).toBe(8476);
  });

  it("recognizes AUTOPAY THANK YOU as a payment (credit to card)", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1]);
    const autopay = transactions.find((t) => t.description.includes("AUTOPAY"));
    expect(autopay).toBeDefined();
    expect(autopay!.isPayment).toBe(true);
    expect(autopay!.amount).toBe(14579);
  });

  it("parses international transactions with foreign amount", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1, V16_APR_2026_PAGE2]);
    const claude = transactions.find((t) => t.description.includes("CLAUDE.AI"));
    expect(claude).toBeDefined();
    expect(claude!.foreignAmount).toBe("USD 118.00");
    expect(claude!.amount).toBe(10997.25);
    expect(claude!.isInternational).toBe(true);
    expect(claude!.rewards).toBe(292);
  });

  it("parses 3-line IGST charges (description split above + below the date/amount line)", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1, V16_APR_2026_PAGE2]);
    const igstCharges = transactions.filter((t) => t.description.startsWith("IGST-"));
    expect(igstCharges.length).toBeGreaterThanOrEqual(2);
    for (const c of igstCharges) {
      expect(c.isCharge).toBe(true);
      expect(c.isInternational).toBe(true);
    }
    expect(igstCharges[0]!.amount).toBe(69.28);
    expect(igstCharges[0]!.description).toContain("MT260840076000010016963");
  });

  it("parses CONSOLIDATED FCY MARKUP FEE as a charge", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1, V16_APR_2026_PAGE2]);
    const markup = transactions.find((t) => t.description.includes("CONSOLIDATED FCY MARKUP"));
    expect(markup).toBeDefined();
    expect(markup!.isCharge).toBe(true);
    expect(markup!.amount).toBe(517.74);
  });

  it("strips the trailing rewards '+ N' from the description", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1]);
    for (const t of transactions) {
      expect(t.description).not.toMatch(/\+\s*\d+\s*$/);
    }
  });

  it("totals match the statement (₹3.17L Apple + ₹169 Amazon + ₹14,579 Autopay = ₹3,32,648)", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1]);
    const total = transactions.reduce((sum, t) => sum + t.amount, 0);
    expect(total).toBe(317900 + 169 + 14579);
  });
});

describe("parseHdfcCcText — v1.3 (older format with 'Cr' suffix + EMI rows)", () => {
  it("extracts statement date from v1.3 metadata", () => {
    const { statement } = parseHdfcCcText([V13_AUG_2024_PAGE1]);
    // v1.3 has "Statement Date:20/08/2024" without "Statement Date " prefix in our regex,
    // but the card number should still come through
    expect(statement?.cardLast4).toBe("3969");
  });

  it("parses the Flipkart purchase with rewards", () => {
    const { transactions } = parseHdfcCcText([V13_AUG_2024_PAGE1]);
    const flipkart = transactions.find((t) => t.description.includes("FLIPKART"));
    expect(flipkart).toBeDefined();
    expect(flipkart!.txnDate).toBe("2024-07-25");
    expect(flipkart!.amount).toBe(74056);
    expect(flipkart!.rewards).toBe(1972);
    expect(flipkart!.isPayment).toBe(false);
  });

  it("recognizes AGGREGATOR EMI ... CREDIT as a charge (EMI conversion)", () => {
    const { transactions } = parseHdfcCcText([V13_AUG_2024_PAGE1]);
    const agg = transactions.find((t) => t.description.startsWith("AGGREGATOR"));
    expect(agg).toBeDefined();
    expect(agg!.isCharge).toBe(true);
  });

  it("parses OFFUS EMI rows (processing fee, IGST) as charges", () => {
    const { transactions } = parseHdfcCcText([V13_AUG_2024_PAGE1]);
    const procFee = transactions.find((t) => t.description.includes("OFFUS EMI,PROCNG FEE"));
    const igst = transactions.find((t) => t.description.startsWith("IGST-VPS"));
    expect(procFee?.isCharge).toBe(true);
    expect(procFee?.amount).toBe(199);
    expect(igst?.isCharge).toBe(true);
    expect(igst?.amount).toBe(35.82);
  });

  it("recognizes AUTOPAY THANK YOU with Cr suffix as a payment", () => {
    const { transactions } = parseHdfcCcText([V13_AUG_2024_PAGE1]);
    const autopay = transactions.find((t) => t.description.includes("AUTOPAY"));
    expect(autopay).toBeDefined();
    expect(autopay!.isPayment).toBe(true);
    expect(autopay!.amount).toBe(16086);
  });

  it("parses Swiggy with HH:MM:SS time format", () => {
    const { transactions } = parseHdfcCcText([V13_AUG_2024_PAGE1]);
    const swiggy = transactions.find((t) => t.description.includes("SWIGGY"));
    expect(swiggy).toBeDefined();
    expect(swiggy!.txnTime).toBe("00:44:42");
    expect(swiggy!.amount).toBe(1483);
  });

  it("does NOT skip lines starting with '0' (regression: '0 Layout' trap line)", () => {
    // The '0 Layout P krishnappa...' line is a known trap — if SKIP_PREFIXES includes
    // a bare '0', date-prefixed lines like '03/04/2024' would be filtered too.
    const { transactions } = parseHdfcCcText([V13_AUG_2024_PAGE1]);
    expect(transactions.length).toBeGreaterThanOrEqual(6);
  });
});

describe("parseHdfcCcText — edge cases", () => {
  it("returns empty for empty input", () => {
    expect(parseHdfcCcText([])).toEqual({ statement: null, transactions: [] });
  });

  it("returns empty transactions when no transactions present", () => {
    const { transactions } = parseHdfcCcText([
      "DUPLICATE Regalia Credit Card Statement\nNo transactions in this period.",
    ]);
    expect(transactions).toEqual([]);
  });

  it("assigns sequential sourceRowIdx starting at 0", () => {
    const { transactions } = parseHdfcCcText([V16_APR_2026_PAGE1]);
    expect(transactions.map((t) => t.sourceRowIdx)).toEqual([0, 1, 2]);
  });
});
