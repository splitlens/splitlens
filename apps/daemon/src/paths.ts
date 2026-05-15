/**
 * Resolved filesystem layout for the daemon. Defaults match the structure
 * laid down by the bank-folder triage script in @splitlens/ingest.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import type { SourceType } from "@splitlens/ingest";

export interface DaemonPaths {
  /** Root of the bank folder, e.g. ~/Documents/bank */
  root: string;
  inbox: string;
  unparsed: string;
  /** Per-source archive directories (archive/hdfc-savings, archive/phonepe, …) */
  archive: Record<SourceType, string>;
  /** Internal state directory — logs, processed-file markers, etc. */
  state: string;
}

const ARCHIVE_DIR_BY_SOURCE: Record<SourceType, string> = {
  hdfc_savings: "archive/hdfc-savings",
  hdfc_cc: "archive/hdfc-cc",
  hdfc_fd: "archive/hdfc-fd",
  phonepe: "archive/phonepe",
  gpay: "archive/gpay",
  cred: "archive/cred",
  swiggy: "archive/swiggy",
  zomato: "archive/zomato",
};

export function resolveDaemonPaths(root?: string): DaemonPaths {
  const r = root ?? process.env.SPLITLENS_BANK_ROOT ?? join(homedir(), "Documents", "bank");
  const archive = Object.fromEntries(
    (Object.entries(ARCHIVE_DIR_BY_SOURCE) as [SourceType, string][]).map(([k, v]) => [
      k,
      join(r, v),
    ]),
  ) as Record<SourceType, string>;
  return {
    root: r,
    inbox: join(r, "inbox"),
    unparsed: join(r, "unparsed"),
    archive,
    state: join(r, ".splitlens"),
  };
}
