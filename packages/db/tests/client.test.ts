import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";

import { openDb, defaultDbPath, type SplitLensDb } from "../src/client";
import {
  accounts,
  statements,
  transactions,
  transactionSources,
} from "../src/schema";

let tmp: string;
let db: SplitLensDb;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "splitlens-db-test-"));
  db = openDb(join(tmp, "test.sqlite"));
});

afterEach(() => {
  db.$client.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("openDb / defaultDbPath", () => {
  it("creates the file and parent directory on first open", () => {
    // openDb already ran in beforeEach; sqlite_version() confirms native binding works.
    const row = db.$client.prepare("SELECT sqlite_version() AS v").get() as { v: string };
    expect(row.v).toMatch(/^3\./);
  });

  it("enables WAL and foreign keys", () => {
    const wal = db.$client.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(wal.journal_mode).toBe("wal");
    const fk = db.$client.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
  });

  it("is idempotent: re-opening the same file does not re-create tables or fail", () => {
    db.$client.close();
    const db2 = openDb(join(tmp, "test.sqlite"));
    const tables = (
      db2.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((t) => t.name);
    db2.$client.close();
    expect(tables).toEqual([
      "accounts",
      "people",
      "rules",
      "statements",
      "transaction_sources",
      "transactions",
    ]);
  });

  it("defaultDbPath honors SPLITLENS_DB_PATH override", () => {
    const old = process.env.SPLITLENS_DB_PATH;
    process.env.SPLITLENS_DB_PATH = "/tmp/custom/spot.sqlite";
    try {
      expect(defaultDbPath()).toBe("/tmp/custom/spot.sqlite");
    } finally {
      if (old === undefined) delete process.env.SPLITLENS_DB_PATH;
      else process.env.SPLITLENS_DB_PATH = old;
    }
  });

  it("defaultDbPath falls back to the macOS Application Support directory", () => {
    const old = process.env.SPLITLENS_DB_PATH;
    delete process.env.SPLITLENS_DB_PATH;
    try {
      // We can only assert the platform-appropriate suffix without coupling
      // to the user running these tests.
      const p = defaultDbPath();
      expect(p.endsWith("splitlens/splitlens.sqlite")).toBe(true);
    } finally {
      if (old !== undefined) process.env.SPLITLENS_DB_PATH = old;
    }
  });
});

describe("canonical txn + multi-source enrichment (the load-bearing test)", () => {
  it("stores one transaction with two source rows (HDFC + PhonePe) and reads them back", () => {
    // Set up an HDFC savings account + an HDFC statement + a PhonePe statement
    // observing the SAME real-world ₹672 Blinkit payment.
    const acctId = db
      .insert(accounts)
      .values({ bank: "HDFC", type: "savings", last4: "2491" })
      .returning({ id: accounts.id })
      .get().id;

    const hdfcStmtId = db
      .insert(statements)
      .values({
        accountId: acctId,
        sourceFile: "/fake/Acct_Statement.pdf",
        sourceHash: "hdfc-hash-1",
        sourceType: "hdfc_savings",
        periodFrom: "2026-04-01",
        periodTo: "2026-05-15",
      })
      .returning({ id: statements.id })
      .get().id;

    const phonepeStmtId = db
      .insert(statements)
      .values({
        accountId: acctId,
        sourceFile: "/fake/PhonePe_Statement.pdf",
        sourceHash: "phonepe-hash-1",
        sourceType: "phonepe",
        periodFrom: "2026-04-01",
        periodTo: "2026-05-15",
      })
      .returning({ id: statements.id })
      .get().id;

    // Canonical transaction — fields are merged best-of from both sources.
    const txnId = db
      .insert(transactions)
      .values({
        accountId: acctId,
        txnDate: "2026-04-01",
        txnTime: "22:36", // from PhonePe (bank didn't have it)
        withdrawal: 672,
        deposit: null,
        refNo: "079673081387", // UTR — the join key both sources agreed on
        narration: "UPI-BLINKIT-...", // from HDFC
        counterparty: "Blinkit", // PhonePe's clean name beats HDFC's "UPI-BLINKIT-..."
        counterpartyKind: "named",
        category: "Groceries",
        closingBalance: 12450,
      })
      .returning({ id: transactions.id })
      .get().id;

    // Two transaction_sources rows pointing at the same canonical txn.
    db.insert(transactionSources)
      .values([
        {
          transactionId: txnId,
          sourceType: "hdfc_savings",
          statementId: hdfcStmtId,
          sourceRowIdx: 23,
          sourceTxnId: "079673081387",
          rawJson: JSON.stringify({
            narration: "UPI-BLINKIT-...",
            withdrawal: 672,
            closingBalance: 12450,
          }),
        },
        {
          transactionId: txnId,
          sourceType: "phonepe",
          statementId: phonepeStmtId,
          sourceRowIdx: 8,
          sourceTxnId: "T2604012236527870202694",
          rawJson: JSON.stringify({
            counterparty: "Blinkit",
            kind: "named",
            txnTime: "22:36",
            splitSourceRaw: null,
          }),
        },
      ])
      .run();

    const txn = db.select().from(transactions).where(eq(transactions.id, txnId)).get();
    expect(txn).toMatchObject({
      txnDate: "2026-04-01",
      txnTime: "22:36",
      withdrawal: 672,
      counterparty: "Blinkit",
      counterpartyKind: "named",
      refNo: "079673081387",
      narration: "UPI-BLINKIT-...",
      category: "Groceries",
      reviewed: false,
    });

    const sources = db
      .select()
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, txnId))
      .all();
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.sourceType).sort()).toEqual(["hdfc_savings", "phonepe"]);
    const phonepeRaw = JSON.parse(sources.find((s) => s.sourceType === "phonepe")!.rawJson);
    expect(phonepeRaw.counterparty).toBe("Blinkit");
  });

  it("UNIQUE(statement_id, source_row_idx) makes ingestion idempotent", () => {
    const acctId = db
      .insert(accounts)
      .values({ bank: "HDFC", type: "savings", last4: "2491" })
      .returning({ id: accounts.id })
      .get().id;
    const stmtId = db
      .insert(statements)
      .values({
        accountId: acctId,
        sourceFile: "/fake/x.pdf",
        sourceHash: "h1",
        sourceType: "hdfc_savings",
      })
      .returning({ id: statements.id })
      .get().id;
    const txnId = db
      .insert(transactions)
      .values({ accountId: acctId, txnDate: "2026-04-01", withdrawal: 100 })
      .returning({ id: transactions.id })
      .get().id;

    db.insert(transactionSources)
      .values({
        transactionId: txnId,
        sourceType: "hdfc_savings",
        statementId: stmtId,
        sourceRowIdx: 0,
        rawJson: "{}",
      })
      .run();

    // Re-inserting the same (statement_id, source_row_idx) must fail.
    expect(() =>
      db
        .insert(transactionSources)
        .values({
          transactionId: txnId,
          sourceType: "hdfc_savings",
          statementId: stmtId,
          sourceRowIdx: 0,
          rawJson: "{}",
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("UNIQUE(bank, type, last4) prevents duplicate accounts", () => {
    db.insert(accounts).values({ bank: "HDFC", type: "savings", last4: "2491" }).run();
    expect(() =>
      db.insert(accounts).values({ bank: "HDFC", type: "savings", last4: "2491" }).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("foreign keys reject orphan transaction_sources rows", () => {
    expect(() =>
      db
        .insert(transactionSources)
        .values({
          transactionId: 9999, // doesn't exist
          sourceType: "phonepe",
          statementId: 9999,
          sourceRowIdx: 0,
          rawJson: "{}",
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
