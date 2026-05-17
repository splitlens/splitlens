import { describe, it, expect } from "vitest";
import { parsePhonePe, parsePhonePeText } from "../../src/parsers/phonepe";
import { PHONEPE_PAGE_1, PHONEPE_PAGE_2 } from "./fixtures/phonepe.fixture";

describe("parsePhonePe — Uint8Array entry point", () => {
  it("returns empty result when no extractor is supplied", async () => {
    const r = await parsePhonePe(new Uint8Array());
    expect(r).toEqual({ statement: null, transactions: [] });
  });
});

describe("parsePhonePeText — statement metadata", () => {
  it("extracts phone number and billing period from page 1 header", () => {
    const { statement } = parsePhonePeText([PHONEPE_PAGE_1]);
    expect(statement).toEqual({
      phoneNumber: "+911234567890",
      periodFrom: "2026-04-01",
      periodTo: "2026-05-15",
    });
  });

  it("returns null statement when no header is present (e.g. page 2 alone)", () => {
    const { statement } = parsePhonePeText([PHONEPE_PAGE_2]);
    expect(statement).toBeNull();
  });
});

describe("parsePhonePeText — Variant A (amount on date line)", () => {
  it("parses all 5 transactions on page 1", () => {
    const { transactions } = parsePhonePeText([PHONEPE_PAGE_1]);
    expect(transactions).toHaveLength(5);
  });

  it("parses a named-counterparty debit correctly", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions[0]!;
    expect(t).toMatchObject({
      txnDate: "2026-04-01",
      txnTime: "08:53",
      direction: "out",
      counterparty: "KRISHNA STORE",
      amount: 48,
      utr: "095596237777",
      transactionId: "AC232604010853361289256546",
      sourceAccountLast4: "2491",
      kind: "named",
      sourceRowIdx: 0,
    });
  });

  it("classifies a VPA counterparty as kind='vpa'", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions.find(
      (x) => x.counterparty === "merchant@axisbank",
    );
    expect(t?.kind).toBe("vpa");
    expect(t?.direction).toBe("out");
  });

  it("classifies 'Bill paid -' as kind='bill', stripping the action verb", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions.find((x) => x.kind === "bill");
    expect(t).toBeDefined();
    expect(t!.counterparty).toBe("FASTag");
    expect(t!.amount).toBe(300);
    expect(t!.direction).toBe("out");
  });

  it("treats 'Received from <name>' as direction='in' (credit)", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions.find(
      (x) => x.counterparty === "Rahul Kumar",
    );
    expect(t).toBeDefined();
    expect(t!.direction).toBe("in");
    expect(t!.amount).toBe(672);
    expect(t!.kind).toBe("named");
  });

  it("classifies a masked '******1234' counterparty as kind='self_transfer'", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions.find((x) =>
      x.counterparty.startsWith("*"),
    );
    expect(t).toBeDefined();
    expect(t!.kind).toBe("self_transfer");
    expect(t!.counterparty).toBe("******2528");
  });
});

describe("parsePhonePeText — Variant B (5-digit amount wraps onto time line)", () => {
  it("parses the wrapped variant correctly (debit, 11216.00)", () => {
    const { transactions } = parsePhonePeText([PHONEPE_PAGE_2]);
    const big = transactions.find((t) => t.counterparty === "BIG MERCHANT NAME");
    expect(big).toBeDefined();
    expect(big!.amount).toBe(11216);
    expect(big!.txnTime).toBe("02:01");
    expect(big!.direction).toBe("out");
    expect(big!.utr).toBe("312464501587");
    expect(big!.transactionId).toBe("T2604020201054810135940");
  });

  it("parses the wrapped variant on a credit (refund) row", () => {
    const { transactions } = parsePhonePeText([PHONEPE_PAGE_2]);
    const refund = transactions.find((t) => t.direction === "in");
    expect(refund).toBeDefined();
    expect(refund!.amount).toBe(10833);
    expect(refund!.counterparty).toBe("refund-merchant@hdfcbank");
    expect(refund!.kind).toBe("vpa");
  });
});

describe("parsePhonePeText — 12h → 24h time conversion", () => {
  it("12:00 AM maps to 00:00", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions.find(
      (x) => x.counterparty === "******2528",
    );
    expect(t!.txnTime).toBe("00:00");
  });

  it("12:00 PM maps to 12:00 (noon, not +12)", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions.find(
      (x) => x.counterparty === "merchant@axisbank",
    );
    expect(t!.txnTime).toBe("12:00");
  });

  it("10:41 PM maps to 22:41", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions.find(
      (x) => x.counterparty === "Rahul Kumar",
    );
    expect(t!.txnTime).toBe("22:41");
  });

  it("01:26 PM maps to 13:26 (PM hour < 12 → +12)", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_2]).transactions.find((x) => x.direction === "in");
    expect(t!.txnTime).toBe("13:26");
  });
});

describe("parsePhonePeText — split-source rows (wallet + bank, account + bank)", () => {
  it("parses a bank+wallet split row without dropping it", () => {
    const { transactions } = parsePhonePeText([PHONEPE_PAGE_2]);
    const juice = transactions.find((t) => t.counterparty === "JUICE JUNCTION");
    expect(juice).toBeDefined();
    expect(juice!.amount).toBe(60);
    expect(juice!.sourceAccountLast4).toBe("0426");
    expect(juice!.splitSourceRaw).toBe("INR 20.24 | Wallet INR 39.76");
  });

  it("parses a bank+account split row without dropping it", () => {
    const { transactions } = parsePhonePeText([PHONEPE_PAGE_2]);
    const ramdev = transactions.find((t) => t.counterparty === "R RAMDEV MEDICALS");
    expect(ramdev).toBeDefined();
    expect(ramdev!.amount).toBe(462);
    expect(ramdev!.sourceAccountLast4).toBe("2491");
    expect(ramdev!.splitSourceRaw).toBe("INR 395.00 | Account INR 67.00");
  });

  it("leaves splitSourceRaw null on non-split rows", () => {
    const t = parsePhonePeText([PHONEPE_PAGE_1]).transactions[0]!;
    expect(t.splitSourceRaw).toBeNull();
  });
});

describe("parsePhonePeText — multi-page", () => {
  it("parses transactions across both pages and assigns monotonic sourceRowIdx", () => {
    const { transactions } = parsePhonePeText([PHONEPE_PAGE_1, PHONEPE_PAGE_2]);
    expect(transactions).toHaveLength(9);
    for (let i = 0; i < transactions.length; i++) {
      expect(transactions[i]!.sourceRowIdx).toBe(i);
    }
  });

  it("skips per-page repeated column headers and the disclaimer block", () => {
    const { transactions } = parsePhonePeText([PHONEPE_PAGE_1, PHONEPE_PAGE_2]);
    for (const t of transactions) {
      expect(t.counterparty).not.toMatch(/Date Transaction Details/);
      expect(t.counterparty).not.toMatch(/^This is/);
      expect(t.counterparty).not.toMatch(/Page \d+ of/);
    }
  });
});

describe("parsePhonePeText — empty / no-data inputs", () => {
  it("returns empty result for an empty page array", () => {
    expect(parsePhonePeText([])).toEqual({ statement: null, transactions: [] });
  });

  it("returns empty transactions for a page with only header/disclaimer noise", () => {
    const noise = `Transaction Statement for +911234567890
Apr 01, 2026 - May 15, 2026
Date Transaction Details Type Amount
Page 1 of 1
This is a system generated statement.`;
    const { transactions } = parsePhonePeText([noise]);
    expect(transactions).toEqual([]);
  });
});
