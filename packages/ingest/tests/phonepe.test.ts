import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";

import {
  openDb,
  accounts,
  statements,
  transactions,
  transactionSources,
  type SplitLensDb,
} from "@splitlens/db";
import type { PhonePeParseResult, PhonePeRawTransaction } from "@splitlens/core";

import { writePhonePeIngest } from "../src/phonepe";
import { classifyByFilename } from "../src/classify";

// Helper to build a PhonePeRawTransaction without typing out every field
let nextIdx = 0;
function row(over: Partial<PhonePeRawTransaction> = {}): PhonePeRawTransaction {
  return {
    txnDate: "2026-04-01",
    txnTime: "08:53",
    direction: "out",
    counterparty: "KRISHNA STORE",
    amount: 48,
    utr: `utr-${nextIdx}`,
    transactionId: `pp-txn-${nextIdx}`,
    sourceAccountLast4: "2491",
    kind: "named",
    splitSourceRaw: null,
    sourceRowIdx: nextIdx++,
    ...over,
  };
}

function parsed(rows: PhonePeRawTransaction[]): PhonePeParseResult {
  return {
    statement: {
      phoneNumber: "+911234567890",
      periodFrom: "2026-04-01",
      periodTo: "2026-04-30",
    },
    transactions: rows,
  };
}

let tmp: string;
let db: SplitLensDb;

beforeEach(() => {
  nextIdx = 0;
  tmp = mkdtempSync(join(tmpdir(), "splitlens-ingest-test-"));
  db = openDb(join(tmp, "test.sqlite"));
});

afterEach(() => {
  db.$client.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("classifyByFilename", () => {
  it("recognizes PhonePe statements from filename patterns", () => {
    expect(classifyByFilename("/x/PhonePe_Transaction_Statement.pdf")?.sourceType).toBe("phonepe");
    expect(classifyByFilename("/x/PhonePe_Transaction_Statement (4).pdf")?.sourceType).toBe(
      "phonepe",
    );
    expect(classifyByFilename("/x/PhonePe_Transaction_Statement 2.pdf")?.sourceType).toBe(
      "phonepe",
    );
  });

  it("recognizes HDFC savings filenames in pdf, txt, and xls form", () => {
    expect(classifyByFilename("/x/Acct_Statement_XXXXXXXX2491_14052026.pdf")?.sourceType).toBe(
      "hdfc_savings",
    );
    expect(classifyByFilename("/x/Acct_Statement_XXXXXXXX2491_14052026.txt")?.sourceType).toBe(
      "hdfc_savings",
    );
    expect(classifyByFilename("/x/Acct_Statement_XXXXXXXX2491_14052026.xls")?.sourceType).toBe(
      "hdfc_savings",
    );
  });

  it("recognizes HDFC credit-card billed statement filenames", () => {
    expect(classifyByFilename("/x/Jan2026_Billedstatements_3969_14-05-26_20-14.pdf")?.sourceType).toBe(
      "hdfc_cc",
    );
    expect(classifyByFilename("/x/Aug2024_Billedstatements_3969_14-05-26_20-15.pdf")?.sourceType).toBe(
      "hdfc_cc",
    );
  });

  it("recognizes GPay statement filenames", () => {
    expect(classifyByFilename("/x/gpay_statement_20251101_20260430.pdf")?.sourceType).toBe("gpay");
  });

  it("recognizes HDFC FD advice filenames (no ingestion, but archived)", () => {
    expect(classifyByFilename("/x/FDAdvice_97369.pdf")?.sourceType).toBe("hdfc_fd");
  });

  it("rejects unrecognized filenames", () => {
    expect(classifyByFilename("/x/random.pdf")).toBeNull();
    expect(classifyByFilename("/x/some_random_doc.pdf")).toBeNull();
  });
});

describe("writePhonePeIngest — first ingest", () => {
  it("creates account, statement, transaction, and transaction_sources rows", () => {
    const result = writePhonePeIngest({
      db,
      parsed: parsed([
        row({ counterparty: "Blinkit", amount: 672, utr: "u1" }),
        row({ counterparty: "Rahul Kumar", direction: "in", amount: 500, utr: "u2" }),
      ]),
      sourceFile: "/fake/pp.pdf",
      sourceHash: "hash-1",
      pageCount: 1,
    });

    expect(result).toMatchObject({
      status: "ingested",
      txnCount: 2,
      newTransactions: 2,
      matchedExisting: 0,
    });

    const accts = db.select().from(accounts).all();
    expect(accts).toHaveLength(1);
    expect(accts[0]).toMatchObject({ bank: "HDFC", type: "savings", last4: "2491" });

    const stmts = db.select().from(statements).all();
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatchObject({
      sourceFile: "/fake/pp.pdf",
      sourceHash: "hash-1",
      sourceType: "phonepe",
      txnCount: 2,
    });

    const txns = db.select().from(transactions).all();
    expect(txns).toHaveLength(2);

    const blinkit = txns.find((t) => t.counterparty === "Blinkit")!;
    expect(blinkit).toMatchObject({
      txnDate: "2026-04-01",
      txnTime: "08:53",
      withdrawal: 672,
      deposit: null,
      refNo: "u1",
      counterpartyKind: "named",
    });

    const rahul = txns.find((t) => t.counterparty === "Rahul Kumar")!;
    expect(rahul).toMatchObject({ withdrawal: null, deposit: 500, refNo: "u2" });

    const sources = db.select().from(transactionSources).all();
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.sourceType === "phonepe")).toBe(true);
  });

  it("uses the existing account row instead of creating a duplicate", () => {
    db.insert(accounts).values({ bank: "HDFC", type: "savings", last4: "2491" }).run();
    writePhonePeIngest({
      db,
      parsed: parsed([row()]),
      sourceFile: "/fake/pp.pdf",
      sourceHash: "h",
      pageCount: 1,
    });
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("respects defaultBank override", () => {
    writePhonePeIngest({
      db,
      parsed: parsed([row()]),
      sourceFile: "/fake/pp.pdf",
      sourceHash: "h",
      pageCount: 1,
      defaultBank: "ICICI",
    });
    const accts = db.select().from(accounts).all();
    expect(accts[0]?.bank).toBe("ICICI");
  });
});

describe("writePhonePeIngest — UTR matcher (re-ingest)", () => {
  it("when a second PhonePe statement repeats a UTR, it adds a source row but does NOT duplicate the transaction", () => {
    // First statement: one txn with UTR "shared-utr"
    writePhonePeIngest({
      db,
      parsed: parsed([row({ utr: "shared-utr", counterparty: "Blinkit", amount: 100 })]),
      sourceFile: "/fake/pp-jan.pdf",
      sourceHash: "h1",
      pageCount: 1,
    });

    // Second statement (different file, different hash): same UTR appears
    const result = writePhonePeIngest({
      db,
      parsed: parsed([row({ utr: "shared-utr", counterparty: "Blinkit", amount: 100 })]),
      sourceFile: "/fake/pp-feb.pdf",
      sourceHash: "h2",
      pageCount: 1,
    });

    expect(result).toMatchObject({
      status: "ingested",
      txnCount: 1,
      newTransactions: 0,
      matchedExisting: 1,
    });

    // Single canonical transaction
    const txns = db.select().from(transactions).all();
    expect(txns).toHaveLength(1);

    // Two source rows pointing at that one transaction
    const sources = db
      .select()
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, txns[0]!.id))
      .all();
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.statementId)).toEqual([1, 2]);
  });

  it("matches by UTR only within the SAME account (not across last4s)", () => {
    writePhonePeIngest({
      db,
      parsed: parsed([row({ utr: "same-utr", sourceAccountLast4: "2491" })]),
      sourceFile: "/a.pdf",
      sourceHash: "ha",
      pageCount: 1,
    });
    writePhonePeIngest({
      db,
      parsed: parsed([row({ utr: "same-utr", sourceAccountLast4: "0426" })]),
      sourceFile: "/b.pdf",
      sourceHash: "hb",
      pageCount: 1,
    });

    // Two accounts, two separate canonical transactions (matcher is per-account).
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(2);
  });
});

describe("writePhonePeIngest — atomicity", () => {
  it("rolls back the whole statement if one row fails (no partial writes)", () => {
    // Force a failure: a row with sourceAccountLast4=null should throw inside
    // the transaction. Nothing must persist.
    expect(() =>
      writePhonePeIngest({
        db,
        parsed: parsed([
          row({ utr: "ok-1" }),
          row({ utr: "ok-2", sourceAccountLast4: null }),
        ]),
        sourceFile: "/x.pdf",
        sourceHash: "hx",
        pageCount: 1,
      }),
    ).toThrow(/wallet-only ingestion not supported/);

    expect(db.select().from(transactions).all()).toEqual([]);
    expect(db.select().from(statements).all()).toEqual([]);
    expect(db.select().from(transactionSources).all()).toEqual([]);
  });
});
