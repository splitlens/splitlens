#!/usr/bin/env tsx
/**
 * splitlens-daemon — long-running file watcher.
 *
 * Two parallel pipelines:
 *
 *   1. <bank>/inbox/*.pdf  →  @splitlens/ingest  →  archive/<source-type>/
 *   2. <bank>/inbox/screenshots/*.{png,jpg,heic}
 *      → @splitlens/ocr (macOS Vision)
 *      → matchTxn against the canonical ledger
 *      → transaction_sources row + archive/screenshots/<merchant>/
 *
 * On any failure, files move to `unparsed/<name>` with a `.error.log` sibling
 * so the user can triage without consulting the daemon's main log.
 *
 * Plus a periodic email-backfill pass that fills `txn_time` from HDFC alerts
 * and attaches Swiggy / Zomato item-level breakdowns to canonical rows.
 *
 * Configuration (all optional, all via env):
 *   SPLITLENS_BANK_ROOT             Root of the bank folder (default: ~/Documents/bank)
 *   SPLITLENS_DB_PATH               SQLite path (default: ~/Library/Application Support/splitlens/splitlens.sqlite)
 *   SPLITLENS_EMAIL_POLL_MINUTES    Periodic email-backfill interval, minutes (default: 30, min: 5, `0` disables)
 *   SPLITLENS_VISION_BIN            Override the OCR helper binary path
 *   PHONEPE_PWD                     Password for PhonePe PDFs
 *   HDFC_PWD                        Password for HDFC savings PDFs
 *   HDFC_CC_PWD                     Password for HDFC credit-card PDFs
 *
 * Backlog: chokidar emits "add" events for every file already in inbox/ at
 * startup, so re-launching the daemon after a crash re-tries any unprocessed
 * files.
 */
import { mkdirSync } from "node:fs";
import { basename } from "node:path";

import chokidar from "chokidar";

import { openDb, closeDb, defaultDbPath } from "@splitlens/db";
import { loadEmailAccountsFromEnv } from "@splitlens/email-receipts";
import {
  backfillSwiggyZomatoItems,
  backfillTimesFromHdfcAlerts,
} from "@splitlens/ingest";
import { findVisionBinary } from "@splitlens/ocr";

import { resolveDaemonPaths, type DaemonPaths } from "./paths";
import { parsePollIntervalMs, schedulePoll, type ScheduleHandle } from "./poll";
import { processInboxFile } from "./process-file";
import { processScreenshotFile } from "./process-screenshot";

function log(msg: string, extra?: Record<string, unknown>) {
  const stamp = new Date().toISOString();
  if (extra) {
    console.log(`${stamp} [daemon] ${msg} ${JSON.stringify(extra)}`);
  } else {
    console.log(`${stamp} [daemon] ${msg}`);
  }
}

function ensureDirs(paths: DaemonPaths) {
  mkdirSync(paths.inbox, { recursive: true });
  mkdirSync(paths.inboxScreenshots, { recursive: true });
  mkdirSync(paths.unparsed, { recursive: true });
  mkdirSync(paths.state, { recursive: true });
  mkdirSync(paths.archiveScreenshots, { recursive: true });
  for (const dir of Object.values(paths.archive)) mkdirSync(dir, { recursive: true });
}

async function main() {
  const paths = resolveDaemonPaths();
  ensureDirs(paths);

  const dbPath = process.env.SPLITLENS_DB_PATH ?? defaultDbPath();
  const db = openDb(dbPath);

  log("starting", { inbox: paths.inbox, db: dbPath });

  const watcher = chokidar.watch(paths.inbox, {
    persistent: true,
    ignoreInitial: false, // process backlog on startup
    depth: 0, // only the top of inbox/, not any subdirs
    awaitWriteFinish: {
      // Wait until the file size has been stable for 500ms before treating
      // it as fully written. Critical for browser downloads that land as
      // partial `.crdownload` then get renamed.
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("add", async (filePath) => {
    const name = basename(filePath);
    log("file detected", { name });
    try {
      const t0 = Date.now();
      const processed = await processInboxFile(filePath, db, paths);
      const dt = Date.now() - t0;
      log(`processed in ${dt}ms`, {
        name,
        outcome: processed.outcome.kind,
        sourceType:
          "sourceType" in processed.outcome ? processed.outcome.sourceType : undefined,
      });
    } catch (e) {
      log("unhandled error", {
        name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  watcher.on("error", (e) => log("watcher error", { error: String(e) }));

  // Screenshot watcher: a parallel watcher rooted at inbox/screenshots/ feeds
  // images through @splitlens/ocr. Kept separate from the PDF watcher so we
  // don't accidentally pick up images dropped at the inbox root (which would
  // confuse the filename classifier), and so the chokidar tunables (e.g.
  // stabilityThreshold) can diverge later if image-save behavior demands it.
  const visionBin = findVisionBinary();
  if (visionBin) {
    log("vision binary available", { path: visionBin });
  } else {
    log(
      "WARNING: splitlens-vision binary not found — screenshot OCR will move " +
        "files to unparsed/. Build with: pnpm --filter @splitlens/ocr build:swift",
    );
  }
  const screenshotWatcher = chokidar.watch(paths.inboxScreenshots, {
    persistent: true,
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  screenshotWatcher.on("add", async (filePath) => {
    const name = basename(filePath);
    log("screenshot detected", { name });
    try {
      const t0 = Date.now();
      const processed = await processScreenshotFile(filePath, db, paths);
      const dt = Date.now() - t0;
      log(`screenshot processed in ${dt}ms`, {
        name,
        outcome: processed.outcome.kind,
        merchant:
          "receipt" in processed.outcome ? processed.outcome.receipt.merchant : undefined,
        txnId:
          processed.outcome.kind === "ingested"
            ? processed.outcome.transactionId
            : undefined,
      });
    } catch (e) {
      log("screenshot unhandled error", {
        name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  screenshotWatcher.on("error", (e) =>
    log("screenshot watcher error", { error: String(e) }),
  );

  // Fire the email-driven time-backfill once at startup, then keep polling
  // on an interval. Skips silently when no GMAIL_USER_* env vars are set.
  // Runs after the watcher is up so it doesn't block file-add events;
  // failures don't bring the daemon down.
  const pollIntervalMs = parsePollIntervalMs(process.env.SPLITLENS_EMAIL_POLL_MINUTES);
  let pollHandle: ScheduleHandle | null = null;
  void (async () => {
    await runEmailBackfillOnce(db);
    if (pollIntervalMs === null) {
      log("email backfill polling disabled (SPLITLENS_EMAIL_POLL_MINUTES=0)");
      return;
    }
    const minutes = Math.round(pollIntervalMs / 60_000);
    log(`next email sync in ${minutes}m`);
    pollHandle = schedulePoll(pollIntervalMs, () => runEmailBackfillOnce(db), {
      onSkip: () =>
        log("email backfill tick skipped (previous cycle still running)"),
      onError: (e) =>
        log("email backfill scheduler error", {
          error: e instanceof Error ? e.message : String(e),
        }),
    });
  })();

  // Trap SIGTERM/SIGINT so launchd can stop us cleanly.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, shutting down`);
    pollHandle?.cancel();
    await Promise.all([watcher.close(), screenshotWatcher.close()]);
    closeDb(db);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("watching for new files (Ctrl+C to stop)");
}

async function runEmailBackfillOnce(db: ReturnType<typeof openDb>) {
  const accounts = loadEmailAccountsFromEnv();
  if (accounts.length === 0) {
    log("email backfill skipped: no GMAIL_USER_N / GMAIL_APP_PWD_N env vars configured");
    return;
  }
  log("email backfill starting", { accounts: accounts.map((a) => a.user) });

  // Pass 1 — fill txn_time on bank txns from HDFC InstaAlerts. Cheap (alerts
  // are small) and high yield (every UPI debit gets one), so we always run it
  // first.
  try {
    const t0 = Date.now();
    const result = await backfillTimesFromHdfcAlerts(db, accounts, {
      verbose: false,
    });
    const dt = Date.now() - t0;
    log(`time-backfill done in ${dt}ms`, {
      candidates: result.candidates,
      filled: result.filled,
      perAccount: result.perAccount,
    });
  } catch (e) {
    log("time-backfill failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Pass 2 — attach Swiggy / Zomato item-level breakdowns. Heavier (per-order
  // HTML emails), so we run it after the cheap pass. Errors here don't break
  // the daemon — we just log and move on.
  try {
    const t0 = Date.now();
    const result = await backfillSwiggyZomatoItems(db, accounts, {
      verbose: false,
    });
    const dt = Date.now() - t0;
    log(`item-enrichment done in ${dt}ms`, {
      candidates: result.candidates,
      alreadyEnriched: result.alreadyEnriched,
      matched: result.matched,
      unmatched: result.unmatched,
      perAccount: result.perAccount,
    });
  } catch (e) {
    log("item-enrichment failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

main().catch((e) => {
  console.error("[daemon] fatal:", e);
  process.exit(1);
});
