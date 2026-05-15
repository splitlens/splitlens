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

import { dispatchFile } from "./dispatch";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: splitlens-ingest <file.pdf> [more.pdf ...]");
    process.exit(2);
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
