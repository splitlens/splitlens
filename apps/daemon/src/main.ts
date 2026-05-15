#!/usr/bin/env tsx
/**
 * splitlens-daemon — long-running file watcher.
 *
 * Watches `<bank>/inbox/` for new statement PDFs and feeds them through the
 * @splitlens/ingest pipeline. On success, the file is moved to
 * `archive/<source-type>/`; on classification failure or ingest error, it's
 * moved to `unparsed/` with a sibling `.error.log`.
 *
 * Configuration (all optional, all via env):
 *   SPLITLENS_BANK_ROOT             Root of the bank folder (default: ~/Documents/bank)
 *   SPLITLENS_DB_PATH               SQLite path (default: ~/Library/Application Support/splitlens/splitlens.sqlite)
 *   SPLITLENS_EMAIL_POLL_MINUTES    Periodic email-backfill interval, minutes (default: 30, min: 5, `0` disables)
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
import { backfillTimesFromHdfcAlerts } from "@splitlens/ingest";

import { resolveDaemonPaths, type DaemonPaths } from "./paths";
import { parsePollIntervalMs, schedulePoll, type ScheduleHandle } from "./poll";
import { processInboxFile } from "./process-file";

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
  mkdirSync(paths.unparsed, { recursive: true });
  mkdirSync(paths.state, { recursive: true });
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
    await watcher.close();
    closeDb(db);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("watching for new files (Ctrl+C to stop)");
}

async function runEmailBackfillOnce(db: ReturnType<typeof openDb>) {
  try {
    const accounts = loadEmailAccountsFromEnv();
    if (accounts.length === 0) {
      log("email backfill skipped: no GMAIL_USER_N / GMAIL_APP_PWD_N env vars configured");
      return;
    }
    log("email backfill starting", {
      accounts: accounts.map((a) => a.user),
    });
    const t0 = Date.now();
    const result = await backfillTimesFromHdfcAlerts(db, accounts, {
      verbose: false,
    });
    const dt = Date.now() - t0;
    log(`email backfill done in ${dt}ms`, {
      candidates: result.candidates,
      filled: result.filled,
      perAccount: result.perAccount,
    });
  } catch (e) {
    log("email backfill failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

main().catch((e) => {
  console.error("[daemon] fatal:", e);
  process.exit(1);
});
