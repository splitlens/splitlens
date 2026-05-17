/**
 * Shared dispatch logic — used by both the CLI and the daemon.
 *
 * Given a path to a downloaded statement, classify it by filename, dispatch
 * to the right orchestrator, and return a structured result. Doesn't move
 * files or touch the filesystem beyond reading the input — that's the
 * caller's responsibility (CLI just prints; daemon moves to archive/).
 *
 * Passwords are pulled from the same env vars as the CLI so the daemon can
 * be configured by setting them in its launchd plist:
 *   PHONEPE_PWD, HDFC_PWD, HDFC_CC_PWD
 */
import type { SplitLensDb } from "@splitlens/db";

import { classifyByFilename, type SourceType } from "./classify";
import { ingestPhonePe } from "./phonepe";
import { ingestHdfcSavings } from "./hdfc-savings";
import { ingestHdfcCc } from "./hdfc-cc";
import type { IngestResult } from "./phonepe";

export type DispatchOutcome =
  | { kind: "ingested"; sourceType: SourceType; result: IngestResult }
  | { kind: "skipped_duplicate"; sourceType: SourceType; sourceHash: string }
  | { kind: "no_orchestrator"; sourceType: SourceType }
  | { kind: "unclassified" }
  | { kind: "failed"; error: Error };

export interface DispatchOptions {
  phonePePassword?: string;
  hdfcSavingsPassword?: string;
  hdfcCcPassword?: string;
}

/**
 * Drive one file through classification + ingestion. The caller decides what
 * to do with the outcome (e.g. CLI logs it; the daemon moves the file to
 * archive/<source>/ on `ingested`/`skipped_duplicate`/`no_orchestrator`, or
 * to unparsed/ on `unclassified`/`failed`).
 */
export async function dispatchFile(
  filePath: string,
  db: SplitLensDb,
  opts: DispatchOptions = {},
): Promise<DispatchOutcome> {
  const cls = classifyByFilename(filePath);
  if (!cls) return { kind: "unclassified" };

  const phonePePassword = opts.phonePePassword ?? process.env.PHONEPE_PWD;
  const hdfcSavingsPassword = opts.hdfcSavingsPassword ?? process.env.HDFC_PWD;
  const hdfcCcPassword = opts.hdfcCcPassword ?? process.env.HDFC_CC_PWD;

  try {
    let result: IngestResult;
    switch (cls.sourceType) {
      case "phonepe":
        result = await ingestPhonePe(filePath, db, { password: phonePePassword });
        break;
      case "hdfc_savings":
        result = await ingestHdfcSavings(filePath, db, { password: hdfcSavingsPassword });
        break;
      case "hdfc_cc":
        result = await ingestHdfcCc(filePath, db, { password: hdfcCcPassword });
        break;
      default:
        return { kind: "no_orchestrator", sourceType: cls.sourceType };
    }
    return result.status === "ingested"
      ? { kind: "ingested", sourceType: cls.sourceType, result }
      : {
          kind: "skipped_duplicate",
          sourceType: cls.sourceType,
          sourceHash: result.sourceHash,
        };
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e : new Error(String(e)) };
  }
}
