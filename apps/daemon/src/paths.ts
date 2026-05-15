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
  /** Subdir of inbox for quick-commerce screenshots (Blinkit / Zepto / Instamart). */
  inboxScreenshots: string;
  /**
   * Subdir of inbox for per-order invoice PDFs (Zepto today; Blinkit /
   * BigBasket / Amazon as they ship downloadable invoices). These are
   * enrichment sources — they ATTACH to canonical txns instead of creating
   * new ones.
   */
  inboxInvoices: string;
  unparsed: string;
  /** Per-source archive directories (archive/hdfc-savings, archive/phonepe, …) */
  archive: Record<SourceType, string>;
  /**
   * Root archive directory for screenshot receipts. The OCR pipeline creates
   * per-merchant subdirs lazily: archive/screenshots/zepto/, …/blinkit/, …
   */
  archiveScreenshots: string;
  /**
   * Root archive directory for invoice PDFs. Per-merchant subdirs are
   * created lazily: archive/invoices/zepto/, …/blinkit/, …
   */
  archiveInvoices: string;
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
  const inbox = join(r, "inbox");
  return {
    root: r,
    inbox,
    inboxScreenshots: join(inbox, "screenshots"),
    inboxInvoices: join(inbox, "invoices"),
    unparsed: join(r, "unparsed"),
    archive,
    archiveScreenshots: join(r, "archive", "screenshots"),
    archiveInvoices: join(r, "archive", "invoices"),
    state: join(r, ".splitlens"),
  };
}
