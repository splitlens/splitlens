#!/usr/bin/env tsx
/**
 * splitlens-ingest CLI — point at a statement file (or several) and let it
 * pick the right parser, write to the canonical SQLite, and report counts.
 *
 * Usage:
 *   pnpm ingest <file.pdf> [more.pdf ...]
 *   SPLITLENS_DB_PATH=/tmp/x.sqlite pnpm ingest <pdf>
 *   PHONEPE_PWD=<pwd> pnpm ingest <PhonePe_Transaction_Statement_*.pdf>
 *   HDFC_PWD=<pwd>    pnpm ingest <Acct_Statement_*.pdf>
 *   HDFC_CC_PWD=<pwd> pnpm ingest <*_Billedstatements_*.pdf>
 *
 * Dispatch logic lives in src/dispatch.ts so the daemon shares it.
 */
import { basename } from "node:path";
import { openDb, defaultDbPath } from "@splitlens/db";
import { loadEmailAccountsFromEnv } from "@splitlens/email-receipts";

import { dispatchFile } from "./dispatch";
import {
  backfillSwiggyZomatoItems,
  backfillTimesFromHdfcAlerts,
} from "./email-backfill";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "usage:\n" +
        "  splitlens-ingest <file.pdf> [more.pdf ...]   # ingest statement PDFs\n" +
        "  splitlens-ingest backfill-times              # fill txn_time from HDFC alert emails\n" +
        "  splitlens-ingest enrich-items                # attach Swiggy/Zomato item lists from emails",
    );
    process.exit(2);
  }

  // Subcommand: backfill-times — uses HDFC InstaAlerts emails to fill in
  // wall-clock time for canonical txns where txn_time IS NULL.
  if (args[0] === "backfill-times") {
    const dbPath = process.env.SPLITLENS_DB_PATH ?? defaultDbPath();
    console.log(`[ingest] db: ${dbPath}`);
    const db = openDb(dbPath);
    const accounts = loadEmailAccountsFromEnv();
    if (accounts.length === 0) {
      console.error(
        "[ingest] no email accounts configured. Set GMAIL_USER_1 / GMAIL_APP_PWD_1 " +
          "(and optionally _2 / _3 / _4) in env or in the daemon's launchd plist.",
      );
      process.exit(2);
    }
    console.log(
      `[ingest] backfilling times from ${accounts.length} email account(s): ` +
        accounts.map((a) => a.user).join(", "),
    );
    const result = await backfillTimesFromHdfcAlerts(db, accounts, {
      verbose: true,
    });
    console.log("\n[ingest] backfill summary:");
    console.log(`  candidates:   ${result.candidates}`);
    console.log(`  filled:       ${result.filled}`);
    console.log("  per account:");
    for (const a of result.perAccount) {
      console.log(`    ${a.user}: ${a.alertsFetched} alerts fetched, ${a.matched} unique UTRs`);
    }
    process.exit(0);
  }

  // Subcommand: enrich-items — pull Swiggy + Zomato receipt emails and
  // attach item-level breakdowns to matching canonical txns.
  if (args[0] === "enrich-items") {
    const dbPath = process.env.SPLITLENS_DB_PATH ?? defaultDbPath();
    console.log(`[ingest] db: ${dbPath}`);
    const db = openDb(dbPath);
    const accounts = loadEmailAccountsFromEnv();
    if (accounts.length === 0) {
      console.error(
        "[ingest] no email accounts configured. Set GMAIL_USER_1 / GMAIL_APP_PWD_1 " +
          "(and optionally _2 / _3 / _4) in env or in the daemon's launchd plist.",
      );
      process.exit(2);
    }
    console.log(
      `[ingest] enriching Swiggy/Zomato items from ${accounts.length} email account(s): ` +
        accounts.map((a) => a.user).join(", "),
    );
    const result = await backfillSwiggyZomatoItems(db, accounts, {
      verbose: true,
    });
    console.log("\n[ingest] item-enrichment summary:");
    console.log(`  candidates:        ${result.candidates}`);
    console.log(`  already enriched:  ${result.alreadyEnriched}`);
    console.log(`  newly matched:     ${result.matched}`);
    console.log(`  unmatched:         ${result.unmatched}`);
    console.log("  per account:");
    for (const a of result.perAccount) {
      console.log(
        `    ${a.user}: ${a.swiggyEmailsFetched} swiggy emails (${a.swiggyParsed} parsed), ${a.zomatoEmailsFetched} zomato emails (${a.zomatoParsed} parsed)`,
      );
    }
    process.exit(0);
  }

  const dbPath = process.env.SPLITLENS_DB_PATH ?? defaultDbPath();
  console.log(`[ingest] db: ${dbPath}`);
  const db = openDb(dbPath);

  let exitCode = 0;
  for (const filePath of args) {
    const t0 = Date.now();
    const outcome = await dispatchFile(filePath, db);
    const dt = Date.now() - t0;
    const name = basename(filePath);

    switch (outcome.kind) {
      case "unclassified":
        console.error(`[ingest] SKIP unrecognized filename: ${name}`);
        exitCode = 1;
        break;
      case "no_orchestrator":
        console.error(
          `[ingest] SKIP no orchestrator yet for sourceType=${outcome.sourceType}: ${name}`,
        );
        exitCode = 1;
        break;
      case "failed":
        console.error(`[ingest] FAILED on ${name}:`, outcome.error);
        exitCode = 1;
        break;
      case "skipped_duplicate":
        console.log(`[ingest] ${name}`);
        console.log(`         status:           skipped_duplicate`);
        console.log(`         sourceHash:       ${outcome.sourceHash}`);
        console.log(`         elapsed:          ${dt}ms`);
        break;
      case "ingested": {
        const r = outcome.result;
        console.log(`[ingest] ${name}`);
        console.log(`         status:           ingested`);
        console.log(`         statementId:      ${r.statementId}`);
        console.log(`         parsed rows:      ${r.txnCount}`);
        console.log(`         new canonical:    ${r.newTransactions}`);
        console.log(`         matched existing: ${r.matchedExisting}`);
        const linked = (r as { linkedAutopayPairs?: number }).linkedAutopayPairs;
        if (linked !== undefined) {
          console.log(`         autopay links:    ${linked}`);
        }
        console.log(`         elapsed:          ${dt}ms`);
        break;
      }
    }
  }

  process.exit(exitCode);
}

main();
