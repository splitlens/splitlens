#!/usr/bin/env tsx
/**
 * Spike for `findEmailsForTransaction`.
 *
 * Picks N real transactions from the local SQLite (default: 5 high-amount
 * outgoing UPI txns from the last 90 days), runs the function for each, and
 * dumps the results to /tmp so we can see what matches.
 *
 * Usage:
 *   GMAIL_USER=… GMAIL_APP_PASSWORD=… pnpm spike-find [--n 5]
 *
 *   --n N        : how many txns to test (default 5)
 *   --txn-id ID  : just this one txn id (overrides --n)
 *   --user / --password : as in spike-fetch
 *
 * Prints a one-line-per-match summary to stdout and writes full details to
 * /tmp/splitlens-find-emails-<account>.json.
 */
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { openDb, closeDb } from "@splitlens/db";
import { findEmailsForTransaction } from "../src/find-emails";
import type { TxnSearchInput } from "../src/find-emails";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface TxnRow {
  id: number;
  txn_date: string;
  withdrawal: number | null;
  counterparty: string | null;
  narration: string | null;
  ref_no: string | null;
}

async function main() {
  const user = arg("--user") ?? process.env.GMAIL_USER;
  const password = arg("--password") ?? process.env.GMAIL_APP_PASSWORD;
  if (!user || !password) {
    console.error("Pass --user / --password or set GMAIL_USER / GMAIL_APP_PASSWORD.");
    process.exit(2);
  }
  const n = Number(arg("--n") ?? 5);
  const onlyId = arg("--txn-id");

  const db = openDb();
  let txns: TxnRow[];
  if (onlyId) {
    txns = db.all<TxnRow>(sql`
      SELECT id, txn_date, withdrawal, counterparty, narration, ref_no
      FROM transactions WHERE id = ${Number(onlyId)}
    `);
  } else {
    // High-amount UPI outgoings from the last 90 days — these have refNos
    // (so UTR matching gets exercised) and they're worth caring about.
    txns = db.all<TxnRow>(sql`
      SELECT id, txn_date, withdrawal, counterparty, narration, ref_no
      FROM transactions
      WHERE withdrawal IS NOT NULL AND withdrawal >= 500
        AND ref_no IS NOT NULL
        AND txn_date >= date('now', '-90 days')
      ORDER BY withdrawal DESC
      LIMIT ${n}
    `);
  }
  closeDb(db);

  if (txns.length === 0) {
    console.log("[spike-find] no txns matched the picker query.");
    return;
  }
  console.log(`[spike-find] testing ${txns.length} transactions for ${user}`);

  const results: Array<{
    txn: TxnRow;
    matches: Array<{ score: number; reasons: string[]; subject: string; from: string; extractorId: string | null; extracted: unknown }>;
  }> = [];

  for (const t of txns) {
    const input: TxnSearchInput = {
      txnDate: t.txn_date,
      amount: t.withdrawal ?? 0,
      counterparty: t.counterparty,
      narration: t.narration,
      refNo: t.ref_no,
    };
    console.log(
      `\n[spike-find] txn #${t.id}  ${t.txn_date}  ₹${t.withdrawal}  ` +
        `cp=${t.counterparty ?? "—"}  utr=${t.ref_no ?? "—"}`,
    );
    const t0 = Date.now();
    let matches;
    try {
      matches = await findEmailsForTransaction({ user, password }, input, {
        windowDays: 7,
        maxMatches: 5,
      });
    } catch (e) {
      console.error(`  FAILED: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const dt = Date.now() - t0;
    console.log(`  → ${matches.length} match(es) in ${dt}ms`);

    for (const m of matches) {
      console.log(
        `    [${m.score.toFixed(2)}] ${m.email.fromAddress} · ${m.email.subject.slice(0, 60)}` +
          (m.extractorId ? `   [extractor=${m.extractorId}]` : ""),
      );
      console.log(`         reasons: ${m.reasons.join("; ")}`);
      if (m.extracted) {
        console.log(`         extracted: ${m.extracted.summary}`);
      }
    }

    results.push({
      txn: t,
      matches: matches.map((m) => ({
        score: m.score,
        reasons: m.reasons,
        subject: m.email.subject,
        from: m.email.fromAddress,
        extractorId: m.extractorId,
        extracted: m.extracted,
      })),
    });
  }

  const safeAccount = user.split("@")[0]!.replace(/[^a-z0-9._-]/gi, "_");
  const outPath = `/tmp/splitlens-find-emails-${safeAccount}.json`;
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n[spike-find] wrote ${outPath}`);
}

main().catch((e) => {
  console.error("[spike-find] FATAL:", e);
  process.exit(1);
});
