import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";

import {
  openDb,
  accounts,
  transactions,
  type SplitLensDb,
} from "@splitlens/db";
import type {
  CcParseResult,
  CcRawTransaction,
  ParseResult,
  RawTransaction,
} from "@splitlens/core";

import { writeHdfcCcIngest } from "../src/hdfc-cc";
import { writeHdfcSavingsIngest } from "../src/hdfc-savings";

// ---------- helpers ----------

let nextIdx = 0;

function ccRow(over: Partial<CcRawTransaction> = {}): CcRawTransaction {
  return {
    txnDate: "2025-04-03",
    txnTime: "10:13",
    description: "AMAZONMUMBAI",
    amount: 169,
    isPayment: false,
    isInternational: false,
    isCharge: false,
    rewards: 4,
    sourceRowIdx: nextIdx++,
    ...over,
  };
}

function ccParsed(rows: CcRawTransaction[]): CcParseResult {
  return {
    statement: {
      bank: "HDFC",
      cardType: "Regalia",
      cardLast4: "3969",
      customerName: "PRATEEK ARYAN",
      statementDate: "2025-04-20",
      periodFrom: "2025-03-21",
      periodTo: "2025-04-20",
    },
    transactions: rows,
  };
}

function savingsRow(over: Partial<RawTransaction> = {}): RawTransaction {
  return {
    txnDate: "2025-05-10",
    valueDate: "2025-05-10",
    narration: "CC 000552260XXXXXX3969 AUTOPAY SI-TAD",
    refNo: "0000000665335908",
    withdrawal: 4984,
    deposit: null,
    closingBalance: 553886.78,
    sourceRowIdx: nextIdx++,
    ...over,
  };
}

function savingsParsed(rows: RawTransaction[]): ParseResult {
  return {
    statement: {
      bank: "HDFC",
      accountType: "savings",
      accountLast4: "2491",
      customerName: "PRATEEK ARYAN",
      periodFrom: "2025-04-01",
      periodTo: "2026-03-31",
    },
    transactions: rows,
  };
}

let tmp: string;
let db: SplitLensDb;

beforeEach(() => {
  nextIdx = 0;
  tmp = mkdtempSync(join(tmpdir(), "splitlens-cc-test-"));
  db = openDb(join(tmp, "test.sqlite"));
});

afterEach(() => {
  db.$client.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ---------- basic CC ingest ----------

describe("writeHdfcCcIngest — basic CC statement", () => {
  it("creates a credit_card account, statement row, and per-txn rows", () => {
    const result = writeHdfcCcIngest({
      db,
      parsed: ccParsed([
        ccRow({ description: "AMAZONMUMBAI", amount: 169, isPayment: false }),
        ccRow({ description: "AUTOPAY THANK YOU", amount: 14579, isPayment: true }),
      ]),
      sourceFile: "/fake/cc.pdf",
      sourceHash: "cc-hash-1",
      pageCount: 1,
    });
    expect(result).toMatchObject({
      status: "ingested",
      txnCount: 2,
      newTransactions: 2,
      linkedAutopayPairs: 0,
    });

    const accts = db.select().from(accounts).all();
    expect(accts).toHaveLength(1);
    expect(accts[0]).toMatchObject({ bank: "HDFC", type: "credit_card", last4: "3969" });

    const txns = db.select().from(transactions).all();
    expect(txns).toHaveLength(2);

    const purchase = txns.find((t) => t.narration === "AMAZONMUMBAI")!;
    expect(purchase).toMatchObject({
      txnDate: "2025-04-03",
      txnTime: "10:13",
      withdrawal: 169,
      deposit: null,
    });
    const payment = txns.find((t) => t.narration === "AUTOPAY THANK YOU")!;
    expect(payment).toMatchObject({
      withdrawal: null,
      deposit: 14579,
    });
  });
});

// ---------- the load-bearing autopay-linker test ----------

describe("autopay linker — CC ↔ savings cross-account link", () => {
  function ingestPairForLinkTest() {
    // CC statement: one purchase + one autopay payment of ₹4984 on May 10.
    writeHdfcCcIngest({
      db,
      parsed: ccParsed([
        ccRow({ description: "AMAZONMUMBAI", amount: 169, isPayment: false }),
        ccRow({
          txnDate: "2025-05-10",
          txnTime: "07:06",
          description: "AUTOPAY THANK YOU",
          amount: 4984,
          isPayment: true,
        }),
      ]),
      sourceFile: "/fake/cc.pdf",
      sourceHash: "cc-hash-1",
      pageCount: 1,
    });
    // Savings statement: matching CC AUTOPAY debit of ₹4984 on May 10.
    writeHdfcSavingsIngest({
      db,
      parsed: savingsParsed([savingsRow()]),
      sourceFile: "/fake/savings.pdf",
      sourceHash: "savings-hash-1",
      pageCount: 1,
    });
  }

  it("links the savings AUTOPAY debit to the CC AUTOPAY THANK YOU payment, symmetrically", () => {
    ingestPairForLinkTest();

    const allTxns = db.select().from(transactions).all();
    const savingsAutopay = allTxns.find((t) => t.narration?.startsWith("CC "))!;
    const ccPayment = allTxns.find((t) => t.narration === "AUTOPAY THANK YOU")!;

    expect(savingsAutopay.linkedTxnId).toBe(ccPayment.id);
    expect(ccPayment.linkedTxnId).toBe(savingsAutopay.id);
  });

  it("works in the reverse ingestion order too (savings first, then CC)", () => {
    nextIdx = 0;
    writeHdfcSavingsIngest({
      db,
      parsed: savingsParsed([savingsRow()]),
      sourceFile: "/fake/savings.pdf",
      sourceHash: "savings-h",
      pageCount: 1,
    });
    const ccResult = writeHdfcCcIngest({
      db,
      parsed: ccParsed([
        ccRow({
          txnDate: "2025-05-10",
          description: "AUTOPAY THANK YOU",
          amount: 4984,
          isPayment: true,
        }),
      ]),
      sourceFile: "/fake/cc.pdf",
      sourceHash: "cc-h",
      pageCount: 1,
    });

    expect(ccResult.linkedAutopayPairs).toBe(1);

    const txns = db.select().from(transactions).all();
    const savings = txns.find((t) => t.narration?.startsWith("CC "))!;
    const cc = txns.find((t) => t.narration === "AUTOPAY THANK YOU")!;
    expect(savings.linkedTxnId).toBe(cc.id);
    expect(cc.linkedTxnId).toBe(savings.id);
  });

  it("does not link when the savings autopay row references a different card last4", () => {
    // Savings AUTOPAY references XXXXX1234, but CC statement is for 3969.
    writeHdfcCcIngest({
      db,
      parsed: ccParsed([
        ccRow({
          txnDate: "2025-05-10",
          description: "AUTOPAY THANK YOU",
          amount: 4984,
          isPayment: true,
        }),
      ]),
      sourceFile: "/fake/cc.pdf",
      sourceHash: "cc-h",
      pageCount: 1,
    });
    writeHdfcSavingsIngest({
      db,
      parsed: savingsParsed([
        savingsRow({ narration: "CC 000552260XXXXXX1234 AUTOPAY SI-TAD" }),
      ]),
      sourceFile: "/fake/savings.pdf",
      sourceHash: "savings-h",
      pageCount: 1,
    });

    const txns = db.select().from(transactions).all();
    for (const t of txns) {
      expect(t.linkedTxnId).toBeNull();
    }
  });

  it("does not link when amounts differ (must match exactly)", () => {
    writeHdfcCcIngest({
      db,
      parsed: ccParsed([
        ccRow({
          txnDate: "2025-05-10",
          description: "AUTOPAY THANK YOU",
          amount: 4984,
          isPayment: true,
        }),
      ]),
      sourceFile: "/fake/cc.pdf",
      sourceHash: "cc-h",
      pageCount: 1,
    });
    writeHdfcSavingsIngest({
      db,
      parsed: savingsParsed([savingsRow({ withdrawal: 4985 })]), // off by ₹1
      sourceFile: "/fake/savings.pdf",
      sourceHash: "savings-h",
      pageCount: 1,
    });

    const txns = db.select().from(transactions).all();
    for (const t of txns) {
      expect(t.linkedTxnId).toBeNull();
    }
  });

  it("is idempotent: running an additional ingest doesn't re-link or re-write the existing pair", () => {
    ingestPairForLinkTest();
    const before = db.select().from(transactions).all();

    // Insert an additional unrelated CC statement; running the linker again
    // should not modify the existing linked pair (or create new spurious ones).
    writeHdfcCcIngest({
      db,
      parsed: ccParsed([ccRow({ description: "FLIPKART", amount: 999, isPayment: false })]),
      sourceFile: "/fake/cc-2.pdf",
      sourceHash: "cc-h-2",
      pageCount: 1,
    });

    const after = db.select().from(transactions).all();
    const beforeMap = new Map(before.map((t) => [t.id, t.linkedTxnId]));
    for (const t of after) {
      if (beforeMap.has(t.id)) {
        expect(t.linkedTxnId).toBe(beforeMap.get(t.id));
      }
    }
  });
});
