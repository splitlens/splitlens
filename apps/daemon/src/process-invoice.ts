/**
 * Per-invoice processing — the order-PDF side of the daemon.
 *
 * Routes a file dropped into `inbox/invoices/` to the right orchestrator
 * (today: Zepto only), writes a `transaction_sources` row attaching the
 * invoice's items + total to the matching canonical UPI debit, then moves
 * the file to `archive/invoices/<merchant>/`. Failure modes land in
 * `unparsed/` with a sibling `.error.log` — same pattern as process-file
 * and process-screenshot.
 *
 * Decoupled from chokidar so it's unit-testable.
 */
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { ingestZeptoInvoice, type ZeptoInvoiceOutcome } from "@splitlens/ingest";
import type { SplitLensDb } from "@splitlens/db";

import type { DaemonPaths } from "./paths";

export type InvoiceOutcome =
  | { kind: "unsupported_filename"; reason: string }
  | { kind: "merchant_not_supported"; merchant: string }
  | { kind: "zepto"; merchant: "zepto"; result: ZeptoInvoiceOutcome };

export interface ProcessedInvoice {
  src: string;
  dst: string;
  outcome: InvoiceOutcome;
}

/** Filename → merchant key. Today only Zepto ships per-order invoice PDFs. */
function classifyInvoiceFilename(name: string): { merchant: "zepto" } | null {
  if (extname(name).toLowerCase() !== ".pdf") return null;
  if (/^zepto_invoice_/i.test(name)) return { merchant: "zepto" };
  return null;
}

export async function processInvoiceFile(
  filePath: string,
  db: SplitLensDb,
  paths: DaemonPaths,
): Promise<ProcessedInvoice> {
  const name = basename(filePath);
  const outcome = await runPipeline(filePath, db, name);
  const dst = destinationFor(name, outcome, paths);

  mkdirSync(dirname(dst), { recursive: true });
  renameSync(filePath, dst);

  if (shouldWriteErrorLog(outcome)) {
    const logPath = dst + ".error.log";
    appendFileSync(
      logPath,
      [
        `# ${new Date().toISOString()}`,
        `file: ${name}`,
        `outcome: ${describeOutcomeKind(outcome)}`,
        describeOutcome(outcome),
        "",
      ].join("\n"),
    );
  }

  return { src: filePath, dst, outcome };
}

async function runPipeline(
  filePath: string,
  db: SplitLensDb,
  name: string,
): Promise<InvoiceOutcome> {
  const cls = classifyInvoiceFilename(name);
  if (!cls) {
    return {
      kind: "unsupported_filename",
      reason:
        "filename doesn't match any known invoice pattern (expected: zepto_invoice_*.pdf)",
    };
  }
  switch (cls.merchant) {
    case "zepto": {
      const result = await ingestZeptoInvoice(filePath, db);
      return { kind: "zepto", merchant: "zepto", result };
    }
  }
}

function destinationFor(
  name: string,
  outcome: InvoiceOutcome,
  paths: DaemonPaths,
): string {
  switch (outcome.kind) {
    case "unsupported_filename":
    case "merchant_not_supported":
      return join(paths.unparsed, name);
    case "zepto": {
      const r = outcome.result;
      if (r.kind === "enriched" || r.kind === "skipped_duplicate") {
        return join(paths.archiveInvoices, "zepto", name);
      }
      // parse_failed or no_canonical_match → unparsed
      return join(paths.unparsed, name);
    }
  }
}

function shouldWriteErrorLog(outcome: InvoiceOutcome): boolean {
  if (outcome.kind === "unsupported_filename") return true;
  if (outcome.kind === "merchant_not_supported") return true;
  if (outcome.kind === "zepto") {
    return (
      outcome.result.kind === "parse_failed" ||
      outcome.result.kind === "no_canonical_match"
    );
  }
  return false;
}

function describeOutcomeKind(o: InvoiceOutcome): string {
  if (o.kind === "zepto") return `zepto.${o.result.kind}`;
  return o.kind;
}

function describeOutcome(o: InvoiceOutcome): string {
  switch (o.kind) {
    case "unsupported_filename":
      return o.reason;
    case "merchant_not_supported":
      return `no orchestrator for merchant: ${o.merchant}`;
    case "zepto": {
      const r = o.result;
      switch (r.kind) {
        case "enriched":
          return (
            `attached invoice to txn ${r.transactionId} ` +
            `(orderNo=${r.invoice.orderNo}, ₹${r.invoice.amount}, ` +
            `${r.invoice.items.length} items)`
          );
        case "skipped_duplicate":
          return `same PDF already ingested (sourceHash=${r.sourceHash.slice(0, 12)}…)`;
        case "parse_failed":
          return `parser couldn't read the invoice: ${r.reason}`;
        case "no_canonical_match":
          return (
            `parsed cleanly (orderNo=${r.invoice.orderNo}, ` +
            `date=${r.invoice.date}, ₹${r.invoice.amount}) but no UPI debit ` +
            `in the ±1 day / ±₹2 window has "zepto" in narration. ` +
            `${r.nearMisses} txn(s) were in the date window but out of amount range.`
          );
      }
    }
  }
}
