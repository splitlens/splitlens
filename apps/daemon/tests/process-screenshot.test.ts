import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDb, closeDb, type SplitLensDb } from "@splitlens/db";
import { sql } from "drizzle-orm";

import { resolveDaemonPaths } from "../src/paths";
import { processScreenshotFile } from "../src/process-screenshot";

// We test the OCR routing logic without needing the macOS Vision binary by
// pointing `processScreenshotFile` at a shell-script "fake binary" that emits
// pre-cooked OCR JSON on stdout. This exercises the same spawn/parse path
// recognizeText runs in production.

let tmp: string;
let db: SplitLensDb;
let fakeBin: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "splitlens-screenshot-test-"));
  db = openDb(join(tmp, "db.sqlite"));
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});

function setupDirs() {
  const paths = resolveDaemonPaths(tmp);
  for (const dir of [
    paths.inbox,
    paths.inboxScreenshots,
    paths.unparsed,
    paths.archiveScreenshots,
    ...Object.values(paths.archive),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/** Write a shell script that emits the given JSON on stdout and exits 0. */
function makeFakeVision(json: object): string {
  const path = join(tmp, "fake-vision");
  writeFileSync(
    path,
    `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(json)}\nEOF\n`,
    { mode: 0o755 },
  );
  chmodSync(path, 0o755);
  return path;
}

/** Insert a (account, transaction) pair we can match against. */
function seedTxn(
  d: SplitLensDb,
  args: { date: string; amount: number; narration: string },
): { accountId: number; txnId: number } {
  d.run(sql`
    INSERT INTO accounts (bank, type, last4, customer_name)
    VALUES ('HDFC', 'savings', '0426', 'Prateek')
  `);
  const accountId = (d.get<{ id: number }>(sql`SELECT last_insert_rowid() AS id`) as { id: number }).id;
  d.run(sql`
    INSERT INTO transactions (account_id, txn_date, narration, withdrawal)
    VALUES (${accountId}, ${args.date}, ${args.narration}, ${args.amount})
  `);
  const txnId = (d.get<{ id: number }>(sql`SELECT last_insert_rowid() AS id`) as { id: number }).id;
  return { accountId, txnId };
}

const ZEPTO_OCR_JSON = {
  lines: [
    "Zepto",
    "Order #ZP9988776",
    "Delivered in 6 minutes",
    "Amul Butter 100g x 1     ₹62.00",
    "Eggs Brown x 1           ₹120.00",
    "Item Total               ₹182.00",
    "Delivery Charge           ₹0.00",
    "Grand Total              ₹182.00",
    "Paid via UPI",
  ],
  blocks: [],
};

describe("processScreenshotFile — happy path", () => {
  it("OCRs a Zepto screenshot, matches a canonical txn, and archives the file", async () => {
    const paths = setupDirs();
    const { txnId } = seedTxn(db, {
      date: "2026-05-15",
      amount: 182,
      narration: "UPI/ZEPTO MARKETPLACE",
    });

    fakeBin = makeFakeVision(ZEPTO_OCR_JSON);
    const src = join(paths.inboxScreenshots, "zepto-order.png");
    writeFileSync(src, "fake-png-bytes");

    const result = await processScreenshotFile(src, db, paths, {
      visionBinPath: fakeBin,
      receiptDateIso: "2026-05-15",
    });

    expect(result.outcome.kind).toBe("ingested");
    if (result.outcome.kind === "ingested") {
      expect(result.outcome.transactionId).toBe(txnId);
      expect(result.outcome.sourceType).toBe("zepto_ocr");
      expect(result.outcome.receipt.merchant).toBe("zepto");
      expect(result.outcome.receipt.amount).toBe(182);
    }

    expect(existsSync(src)).toBe(false);
    expect(existsSync(join(paths.archiveScreenshots, "zepto", "zepto-order.png"))).toBe(
      true,
    );

    // A transaction_sources row should now exist pointing at our seeded txn.
    const sources = db.all<{ transaction_id: number; source_type: string }>(sql`
      SELECT transaction_id, source_type FROM transaction_sources
    `);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.transaction_id).toBe(txnId);
    expect(sources[0]!.source_type).toBe("zepto_ocr");
  });
});

describe("processScreenshotFile — no canonical txn matches", () => {
  it("routes to unparsed/ with a .error.log when no txn fits the receipt", async () => {
    const paths = setupDirs();
    // Seed a txn that's >₹2 off so matchTxn rejects it.
    seedTxn(db, {
      date: "2026-05-15",
      amount: 999,
      narration: "UPI/ZEPTO MARKETPLACE",
    });
    fakeBin = makeFakeVision(ZEPTO_OCR_JSON);

    const src = join(paths.inboxScreenshots, "lonely-zepto.png");
    writeFileSync(src, "fake-png-bytes");

    const result = await processScreenshotFile(src, db, paths, {
      visionBinPath: fakeBin,
      receiptDateIso: "2026-05-15",
    });

    expect(result.outcome.kind).toBe("no_txn_match");
    expect(existsSync(src)).toBe(false);
    const dst = join(paths.unparsed, "lonely-zepto.png");
    expect(existsSync(dst)).toBe(true);
    expect(existsSync(dst + ".error.log")).toBe(true);
    expect(readFileSync(dst + ".error.log", "utf8")).toMatch(/no_txn_match/);
  });
});

describe("processScreenshotFile — no parser recognizes the OCR text", () => {
  it("routes to unparsed/ when none of the merchant parsers match", async () => {
    const paths = setupDirs();
    fakeBin = makeFakeVision({
      lines: ["Some random receipt", "Total ₹100"],
      blocks: [],
    });

    const src = join(paths.inboxScreenshots, "mystery.png");
    writeFileSync(src, "fake-png-bytes");

    const result = await processScreenshotFile(src, db, paths, {
      visionBinPath: fakeBin,
      receiptDateIso: "2026-05-15",
    });

    expect(result.outcome.kind).toBe("no_parser_match");
    expect(existsSync(join(paths.unparsed, "mystery.png"))).toBe(true);
    expect(existsSync(join(paths.unparsed, "mystery.png.error.log"))).toBe(true);
  });
});

describe("processScreenshotFile — Vision binary missing", () => {
  it("returns vision_unavailable and routes to unparsed/", async () => {
    const paths = setupDirs();
    const src = join(paths.inboxScreenshots, "no-vision.png");
    writeFileSync(src, "fake-png-bytes");

    const result = await processScreenshotFile(src, db, paths, {
      visionBinPath: "/tmp/definitely-no-binary-here",
    });

    expect(result.outcome.kind).toBe("vision_unavailable");
    expect(existsSync(join(paths.unparsed, "no-vision.png"))).toBe(true);
    const log = readFileSync(
      join(paths.unparsed, "no-vision.png.error.log"),
      "utf8",
    );
    expect(log).toMatch(/splitlens-vision binary not found/);
  });
});

describe("processScreenshotFile — unsupported extension", () => {
  it("routes a .pdf dropped into screenshots/ to unparsed/ as unsupported_image", async () => {
    const paths = setupDirs();
    const src = join(paths.inboxScreenshots, "oops.pdf");
    writeFileSync(src, "not an image");

    const result = await processScreenshotFile(src, db, paths, {
      visionBinPath: "/bin/sh", // doesn't matter — short-circuits before OCR
    });

    expect(result.outcome.kind).toBe("unsupported_image");
    expect(existsSync(join(paths.unparsed, "oops.pdf"))).toBe(true);
  });
});

describe("processScreenshotFile — re-dropping the same file is idempotent", () => {
  it("the second run still completes and produces no double-attached source row", async () => {
    const paths = setupDirs();
    const { txnId } = seedTxn(db, {
      date: "2026-05-15",
      amount: 182,
      narration: "UPI/ZEPTO MARKETPLACE",
    });
    fakeBin = makeFakeVision(ZEPTO_OCR_JSON);

    const src1 = join(paths.inboxScreenshots, "dup.png");
    writeFileSync(src1, "fake-png-bytes-stable");
    const r1 = await processScreenshotFile(src1, db, paths, {
      visionBinPath: fakeBin,
      receiptDateIso: "2026-05-15",
    });
    expect(r1.outcome.kind).toBe("ingested");

    // Drop the same byte-identical screenshot back into inbox. The unique
    // source_hash on statements + unique (statement_id, source_row_idx) on
    // transaction_sources should prevent a duplicate insert — the second run
    // ends in write_failed (caught + logged), not silently double-attaching.
    const src2 = join(paths.inboxScreenshots, "dup.png");
    writeFileSync(src2, "fake-png-bytes-stable");
    const r2 = await processScreenshotFile(src2, db, paths, {
      visionBinPath: fakeBin,
      receiptDateIso: "2026-05-15",
    });
    expect(r2.outcome.kind).toBe("write_failed");

    const sources = db.all<{ transaction_id: number }>(sql`
      SELECT transaction_id FROM transaction_sources
    `);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.transaction_id).toBe(txnId);
  });
});
