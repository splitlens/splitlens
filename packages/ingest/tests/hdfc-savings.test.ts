import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";

import {
  openDb,
  accounts,
  transactions,
  transactionSources,
  type SplitLensDb,
} from "@splitlens/db";
import type {
  ParseResult,
  RawTransaction,
  PhonePeRawTransaction,
  PhonePeParseResult,
} from "@splitlens/core";

import { canonicalRefForHdfc, writeHdfcSavingsIngest } from "../src/hdfc-savings";
import { writePhonePeIngest } from "../src/phonepe";

// ---------- helpers ----------

let nextIdx = 0;

function hdfcRow(over: Partial<RawTransaction> = {}): RawTransaction {
  return {
    txnDate: "2025-04-01",
    valueDate: "2025-04-01",
    narration: "UPI-KRISHNA BEKARY-paytmqr@ptys-YESB0PTMUPI-095596237777-PAYMENT FROM PHONE",
    refNo: "0000095596237777",
    withdrawal: 48,
    deposit: null,
    closingBalance: 100000,
    sourceRowIdx: nextIdx++,
    ...over,
  };
}

function hdfcParsed(rows: RawTransaction[]): ParseResult {
  return {
    statement: {
      bank: "HDFC",
      accountType: "savings",
      accountLast4: "2491",
      customerName: "PRATEEK ARYAN",
      periodFrom: "2025-04-01",
      periodTo: "2026-05-14",
    },
    transactions: rows,
  };
}

function phonepeRow(over: Partial<PhonePeRawTransaction> = {}): PhonePeRawTransaction {
  return {
    txnDate: "2025-04-01",
    txnTime: "08:53",
    direction: "out",
    counterparty: "KRISHNA BEKARY",
    amount: 48,
    utr: "095596237777",
    transactionId: "AC23-test",
    sourceAccountLast4: "2491",
    kind: "named",
    splitSourceRaw: null,
    sourceRowIdx: nextIdx++,
    ...over,
  };
}

function phonepeParsed(rows: PhonePeRawTransaction[]): PhonePeParseResult {
  return {
    statement: {
      phoneNumber: "+911234567890",
      periodFrom: "2025-04-01",
      periodTo: "2025-04-30",
    },
    transactions: rows,
  };
}

let tmp: string;
let db: SplitLensDb;

beforeEach(() => {
  nextIdx = 0;
  tmp = mkdtempSync(join(tmpdir(), "splitlens-hdfc-test-"));
  db = openDb(join(tmp, "test.sqlite"));
});

afterEach(() => {
  db.$client.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ---------- canonicalRefForHdfc unit tests ----------

describe("canonicalRefForHdfc — UTR normalization", () => {
  it("strips leading zeros from standard UPI refNos", () => {
    const t = hdfcRow({ narration: "UPI-X-y@z-A0B-095596237777-X", refNo: "0000095596237777" });
    expect(canonicalRefForHdfc(t)).toBe("095596237777");
  });

  it("returns null for UPIRET refunds — the embedded UTR is the ORIGINAL payment's, not the refund's", () => {
    const t = hdfcRow({
      narration: "UPIRET-20250413-546975585569",
      refNo: "000000000000000",
    });
    expect(canonicalRefForHdfc(t)).toBeNull();
  });

  it("returns null for NEFT references — bank-internal, not a cross-source key", () => {
    const t = hdfcRow({
      narration: "NEFT CR-CHAS0INBX01-SALARY-PRATEEK ARYAN-CHASN52025042590561428",
      refNo: "CHASN52025042590561428",
    });
    expect(canonicalRefForHdfc(t)).toBeNull();
  });

  it("returns null for CC AUTOPAY rows — internal reference, not a UTR", () => {
    const t = hdfcRow({
      narration: "CC 000552260XXXXXX3969 AUTOPAY SI-TAD",
      refNo: "0000000665335908",
    });
    expect(canonicalRefForHdfc(t)).toBeNull();
  });

  it("returns null for INTEREST PAID rows", () => {
    const t = hdfcRow({
      narration: "INTEREST PAID TILL 30-JUN-2025",
      refNo: "000000000000000",
    });
    expect(canonicalRefForHdfc(t)).toBeNull();
  });

  it("returns null when refNo is empty", () => {
    const t = hdfcRow({ narration: "Something", refNo: undefined });
    expect(canonicalRefForHdfc(t)).toBeNull();
  });
});

// ---------- the load-bearing multi-source enrichment test ----------

describe("multi-source enrichment — PhonePe first, then HDFC", () => {
  it("HDFC ingestion matches existing PhonePe canonical row by UTR and fills in narration + closing balance", () => {
    // First: PhonePe ingest writes the canonical row with time + clean counterparty.
    writePhonePeIngest({
      db,
      parsed: phonepeParsed([phonepeRow()]),
      sourceFile: "/fake/pp.pdf",
      sourceHash: "pp-hash",
      pageCount: 1,
    });

    // The PhonePe row's UTR is "095596237777"; the HDFC row's refNo is
    // "0000095596237777" which normalizes to the same. They MUST match.
    const result = writeHdfcSavingsIngest({
      db,
      parsed: hdfcParsed([hdfcRow()]),
      sourceFile: "/fake/hdfc.pdf",
      sourceHash: "hdfc-hash",
      pageCount: 1,
    });

    expect(result).toMatchObject({
      status: "ingested",
      txnCount: 1,
      newTransactions: 0,
      matchedExisting: 1,
    });

    // Exactly one canonical transaction; both sources attached.
    const txns = db.select().from(transactions).all();
    expect(txns).toHaveLength(1);
    const txn = txns[0]!;

    // PhonePe's contributions preserved:
    expect(txn.txnTime).toBe("08:53");
    expect(txn.counterparty).toBe("KRISHNA BEKARY");
    expect(txn.counterpartyKind).toBe("named");
    // HDFC's contributions filled in:
    expect(txn.narration).toContain("UPI-KRISHNA BEKARY");
    expect(txn.closingBalance).toBe(100000);
    expect(txn.valueDate).toBe("2025-04-01");
    // Unchanged from PhonePe insert:
    expect(txn.withdrawal).toBe(48);
    expect(txn.refNo).toBe("095596237777");

    const sources = db
      .select()
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, txn.id))
      .all();
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.sourceType).sort()).toEqual(["hdfc_savings", "phonepe"]);
  });

  it("works in the reverse order too: HDFC first, then PhonePe", () => {
    writeHdfcSavingsIngest({
      db,
      parsed: hdfcParsed([hdfcRow()]),
      sourceFile: "/fake/hdfc.pdf",
      sourceHash: "hdfc-hash",
      pageCount: 1,
    });

    const result = writePhonePeIngest({
      db,
      parsed: phonepeParsed([phonepeRow()]),
      sourceFile: "/fake/pp.pdf",
      sourceHash: "pp-hash",
      pageCount: 1,
    });

    expect(result.matchedExisting).toBe(1);
    expect(result.newTransactions).toBe(0);

    const txn = db.select().from(transactions).all()[0]!;
    // HDFC's: narration + closing balance + value date
    expect(txn.narration).toContain("UPI-KRISHNA BEKARY");
    expect(txn.closingBalance).toBe(100000);
    // PhonePe's later-merged contributions: txn_time + counterparty + kind
    expect(txn.txnTime).toBe("08:53");
    expect(txn.counterparty).toBe("KRISHNA BEKARY");
    expect(txn.counterpartyKind).toBe("named");
  });

  it("the canonical account is shared: PhonePe and HDFC create exactly one (HDFC, savings, 2491) account row", () => {
    writePhonePeIngest({
      db,
      parsed: phonepeParsed([phonepeRow()]),
      sourceFile: "/fake/pp.pdf",
      sourceHash: "pp",
      pageCount: 1,
    });
    writeHdfcSavingsIngest({
      db,
      parsed: hdfcParsed([hdfcRow()]),
      sourceFile: "/fake/hdfc.pdf",
      sourceHash: "hdfc",
      pageCount: 1,
    });

    const accts = db.select().from(accounts).all();
    expect(accts).toHaveLength(1);
    expect(accts[0]).toMatchObject({ bank: "HDFC", type: "savings", last4: "2491" });
    // customer_name comes from HDFC's parser (PhonePe doesn't have it).
    expect(accts[0]?.customerName).toBe("PRATEEK ARYAN");
  });
});

// ---------- the merger's reviewed-respecting guarantee ----------

describe("merger — reviewed=true must NOT be overwritten", () => {
  it("does not overwrite counterparty / category / notes when reviewed=1", async () => {
    // PhonePe ingest creates the canonical row.
    writePhonePeIngest({
      db,
      parsed: phonepeParsed([phonepeRow()]),
      sourceFile: "/fake/pp.pdf",
      sourceHash: "pp",
      pageCount: 1,
    });

    // User manually edits + marks reviewed.
    const txnId = db.select().from(transactions).all()[0]!.id;
    db.update(transactions)
      .set({
        counterparty: "Krishna's Bakery (edited)",
        category: "Food:Bakery",
        notes: "Verified — favorite Sunday treat",
        reviewed: true,
      })
      .where(eq(transactions.id, txnId))
      .run();

    // HDFC ingest matches by UTR and tries to merge. It should NOT clobber
    // user-edited fields. narration/closingBalance (AUTO fields, still NULL
    // in the canonical row) ARE allowed to fill in.
    writeHdfcSavingsIngest({
      db,
      parsed: hdfcParsed([hdfcRow()]),
      sourceFile: "/fake/hdfc.pdf",
      sourceHash: "hdfc",
      pageCount: 1,
    });

    const txn = db.select().from(transactions).where(eq(transactions.id, txnId)).get()!;
    expect(txn.counterparty).toBe("Krishna's Bakery (edited)"); // preserved
    expect(txn.category).toBe("Food:Bakery"); // preserved
    expect(txn.notes).toBe("Verified — favorite Sunday treat"); // preserved
    expect(txn.narration).toContain("UPI-KRISHNA BEKARY"); // filled in (AUTO)
    expect(txn.closingBalance).toBe(100000); // filled in (AUTO)
  });
});

// ---------- non-UPI HDFC rows insert as new canonical (no false matches) ----------

describe("non-UPI HDFC rows — never false-positive match", () => {
  it("two NEFT rows with the same all-zero refNo create separate canonical txns (canonicalRef → null)", () => {
    // Two distinct interest postings with refNo=000000000000000 ought to live
    // as two canonical txns, not be merged together by the matcher.
    writeHdfcSavingsIngest({
      db,
      parsed: hdfcParsed([
        hdfcRow({
          narration: "INTEREST PAID TILL 30-JUN-2025",
          refNo: "000000000000000",
          withdrawal: null,
          deposit: 3974,
        }),
        hdfcRow({
          narration: "INTEREST PAID TILL 30-SEP-2025",
          refNo: "000000000000000",
          withdrawal: null,
          deposit: 4112,
        }),
      ]),
      sourceFile: "/fake/hdfc.pdf",
      sourceHash: "hdfc",
      pageCount: 1,
    });

    const txns = db.select().from(transactions).all();
    expect(txns).toHaveLength(2);
    expect(txns.every((t) => t.refNo === null)).toBe(true);
  });
});
