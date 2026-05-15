/**
 * Filename-based classifier: maps a downloaded statement file to its source
 * type so the orchestrator knows which parser to call.
 *
 * Patterns are deliberately narrow — false positives are worse than false
 * negatives here. Files that don't match anything become `null` and the
 * caller's responsibility (the daemon moves them to Documents/bank/unparsed/).
 *
 * Today: PhonePe only. HDFC savings / CC / GPay / Cred / Swiggy / Zomato will
 * be added as their parsers come online.
 */
import { basename } from "node:path";

export type SourceType =
  | "phonepe"
  | "gpay"
  | "hdfc_savings"
  | "hdfc_cc"
  | "hdfc_fd"
  | "cred"
  | "swiggy"
  | "zomato";

export interface ClassifyResult {
  sourceType: SourceType;
}

const PHONEPE_RE = /^PhonePe_Transaction_Statement.*\.pdf$/i;
// HDFC savings download filename: "Acct_Statement_XXXXXXXX<last4>_<DDMMYYYY>.{pdf,txt,xls}"
const HDFC_SAVINGS_RE = /^Acct_Statement_X+\d{4}_\d{8}\.(?:pdf|txt|xls|xlsx)$/i;
// HDFC credit card: "<Mon><Year>_Billedstatements_<cardlast4>_<DD-MM-YY>_<HH-MM>.pdf"
const HDFC_CC_RE = /^[A-Z][a-z]{2}\d{4}_Billedstatements_\d{4}_[\d_-]+\.pdf$/;
// GPay statement export: "gpay_statement_<YYYYMMDD>_<YYYYMMDD>.pdf"
const GPAY_RE = /^gpay_statement_\d{8}_\d{8}\.pdf$/i;
// HDFC FD maturity advice — not a transaction statement; classified so the
// triage script can route it to archive/hdfc-fd/ instead of unparsed/.
const HDFC_FD_RE = /^FDAdvice_\d+\.pdf$/i;

export function classifyByFilename(filePath: string): ClassifyResult | null {
  const name = basename(filePath);
  if (PHONEPE_RE.test(name)) return { sourceType: "phonepe" };
  if (HDFC_SAVINGS_RE.test(name)) return { sourceType: "hdfc_savings" };
  if (HDFC_CC_RE.test(name)) return { sourceType: "hdfc_cc" };
  if (GPAY_RE.test(name)) return { sourceType: "gpay" };
  // HDFC FD advice is classified for organization but no ingestion orchestrator
  // exists — the CLI will skip it and the triage script will archive it.
  if (HDFC_FD_RE.test(name)) return { sourceType: "hdfc_fd" };
  return null;
}
