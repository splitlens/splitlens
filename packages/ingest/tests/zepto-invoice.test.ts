import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";

import { openDb, closeDb, type SplitLensDb } from "@splitlens/db";
import type { ZeptoInvoice } from "@splitlens/core";

import { writeZeptoInvoiceEnrichment } from "../src/zepto-invoice";

// We unit-test the writer half of the orchestrator: takes a parsed invoice
// + a DB, runs the match policy, writes the source row. No file I/O needed.

let tmp: string;
let db: SplitLensDb;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "splitlens-zepto-invoice-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});

function makeAccount(d: SplitLensDb): number {
  d.run(sql`
    INSERT INTO accounts (bank, type, last4, customer_name)
    VALUES ('HDFC', 'savings', '0426', 'Test')
  `);
  return (d.get<{ id: number }>(sql`SELECT last_insert_rowid() AS id`) as { id: number }).id;
}

function makeTxn(
  d: SplitLensDb,
  args: { accountId: number; date: string; amount: number; narration?: string; counterparty?: string },
): number {
  d.run(sql`
    INSERT INTO transactions (account_id, txn_date, withdrawal, narration, counterparty)
    VALUES (${args.accountId}, ${args.date}, ${args.amount}, ${args.narration ?? null}, ${args.counterparty ?? null})
  `);
  return (d.get<{ id: number }>(sql`SELECT last_insert_rowid() AS id`) as { id: number }).id;
}

function invoice(over: Partial<ZeptoInvoice> = {}): ZeptoInvoice {
  return {
    orderNo: "HQUUKBCNI14442A",
    invoiceNo: "260529G006536991",
    date: "2026-05-14",
    amount: 345.01,
    items: [
      { seq: 1, name: "Red Bull Energy Drink", qty: 1, amount: 105 },
      { seq: 2, name: "Gold Flake King's Blue", qty: 1, amount: 240 },
    ],
    rawText: "Order No.: HQUUKBCNI14442A Date : 14-05-2026 Invoice Value 345.01",
    ...over,
  };
}

describe("writeZeptoInvoiceEnrichment — happy path", () => {
  it("attaches the invoice to a matching UPI debit (same day, exact amount)", () => {
    const accountId = makeAccount(db);
    const txnId = makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 345.01,
      narration: "UPI-ZEPTO-RZP-zepto@hdfcbank-...",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "hash1",
      sourceFile: "/tmp/zepto.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("enriched");
    if (r.kind === "enriched") {
      expect(r.transactionId).toBe(txnId);
    }
    const sources = db.all<{ source_type: string; transaction_id: number }>(sql`
      SELECT source_type, transaction_id FROM transaction_sources
    `);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.source_type).toBe("zepto_invoice");
    expect(sources[0]!.transaction_id).toBe(txnId);
  });

  it("matches on date ±1 + amount ±₹2 tolerance", () => {
    const accountId = makeAccount(db);
    // Invoice date 2026-05-14, amount 345.01.
    // Txn date 2026-05-15 (1 day after), amount 343.50 (₹1.51 less). Should match.
    const txnId = makeTxn(db, {
      accountId,
      date: "2026-05-15",
      amount: 343.5,
      counterparty: "Zepto",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "hash1",
      sourceFile: "/tmp/zepto.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("enriched");
    if (r.kind === "enriched") expect(r.transactionId).toBe(txnId);
  });

  it("matches on counterparty=Zepto even if narration doesn't say zepto", () => {
    const accountId = makeAccount(db);
    const txnId = makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 345.01,
      narration: "UPI-FOOBAR-RZP@HDFCBANK",
      counterparty: "Zepto Marketplace",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("enriched");
    if (r.kind === "enriched") expect(r.transactionId).toBe(txnId);
  });
});

describe("writeZeptoInvoiceEnrichment — no canonical match", () => {
  it("returns no_canonical_match when no zepto-narrated txn exists in the window", () => {
    const accountId = makeAccount(db);
    // Same date + amount but narration doesn't say zepto.
    makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 345.01,
      narration: "UPI-SOMETHING-ELSE",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("no_canonical_match");
  });

  it("counts near-misses (in date window but out of amount range)", () => {
    const accountId = makeAccount(db);
    makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 1000,
      narration: "UPI-ZEPTO-different-order",
    });
    makeTxn(db, {
      accountId,
      date: "2026-05-13",
      amount: 500,
      narration: "UPI-ZEPTO-different-order-2",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("no_canonical_match");
    if (r.kind === "no_canonical_match") {
      expect(r.nearMisses).toBe(2);
    }
  });

  it("rejects txns outside the date window even at exact amount", () => {
    const accountId = makeAccount(db);
    // 3 days outside the ±1 window
    makeTxn(db, {
      accountId,
      date: "2026-05-18",
      amount: 345.01,
      narration: "UPI-ZEPTO-zepto",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("no_canonical_match");
  });
});

describe("writeZeptoInvoiceEnrichment — tiebreakers", () => {
  it("prefers the closest amount when multiple txns are in the window", () => {
    const accountId = makeAccount(db);
    const closer = makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 345.50, // ₹0.49 off
      narration: "UPI-ZEPTO-A",
    });
    makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 346.00, // ₹0.99 off
      narration: "UPI-ZEPTO-B",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("enriched");
    if (r.kind === "enriched") expect(r.transactionId).toBe(closer);
  });

  it("tiebreaks by date when amounts are equal", () => {
    const accountId = makeAccount(db);
    const sameDay = makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 345.01,
      narration: "UPI-ZEPTO-A",
    });
    makeTxn(db, {
      accountId,
      date: "2026-05-15",
      amount: 345.01,
      narration: "UPI-ZEPTO-B",
    });
    const r = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r.kind).toBe("enriched");
    if (r.kind === "enriched") expect(r.transactionId).toBe(sameDay);
  });
});

describe("writeZeptoInvoiceEnrichment — idempotency", () => {
  it("writing the same parsed invoice twice doesn't produce duplicate source rows", () => {
    const accountId = makeAccount(db);
    makeTxn(db, {
      accountId,
      date: "2026-05-14",
      amount: 345.01,
      narration: "UPI-ZEPTO",
    });

    const r1 = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h-same",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r1.kind).toBe("enriched");

    // Same sourceHash on the statement uq index will fail the second insert
    // → caught + reported as skipped_duplicate.
    const r2 = writeZeptoInvoiceEnrichment({
      db,
      parsed: invoice(),
      sourceHash: "h-same",
      sourceFile: "/tmp/x.pdf",
      pageCount: 1,
    });
    expect(r2.kind).toBe("skipped_duplicate");

    const rows = db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM transaction_sources`);
    expect(rows[0]!.c).toBe(1);
  });
});
