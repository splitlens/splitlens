/**
 * Per-file processing — the testable core of the daemon. Takes a file path in
 * the inbox, dispatches it through @splitlens/ingest, then moves the file to
 * the right destination based on the outcome. No chokidar coupling here so
 * tests can drive it directly.
 */
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { SplitLensDb } from "@splitlens/db";
import {
  dispatchFile,
  type DispatchOutcome,
  type DispatchOptions,
} from "@splitlens/ingest";

import type { DaemonPaths } from "./paths";

export interface ProcessedFile {
  src: string;
  dst: string;
  outcome: DispatchOutcome;
}

export async function processInboxFile(
  filePath: string,
  db: SplitLensDb,
  paths: DaemonPaths,
  opts: DispatchOptions = {},
): Promise<ProcessedFile> {
  const name = basename(filePath);
  const outcome = await dispatchFile(filePath, db, opts);
  const dst = destinationFor(name, outcome, paths);

  // Make sure the destination dir exists before the rename.
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(filePath, dst);

  // On failure, write a sibling .error.log next to the moved file so the user
  // can see exactly what broke without consulting the daemon's main log.
  if (outcome.kind === "failed") {
    const logPath = dst + ".error.log";
    appendFileSync(
      logPath,
      [
        `# ${new Date().toISOString()}`,
        `file: ${name}`,
        `error: ${outcome.error.message}`,
        outcome.error.stack ?? "",
        "",
      ].join("\n"),
    );
  }

  return { src: filePath, dst, outcome };
}

function destinationFor(name: string, outcome: DispatchOutcome, paths: DaemonPaths): string {
  switch (outcome.kind) {
    case "ingested":
    case "skipped_duplicate":
    case "no_orchestrator":
      return join(paths.archive[outcome.sourceType], name);
    case "unclassified":
    case "failed":
      return join(paths.unparsed, name);
  }
}
