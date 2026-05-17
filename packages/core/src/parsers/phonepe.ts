/**
 * PhonePe transaction-statement parser.
 *
 * Every transaction in the exported PDF is a 4-line block in one of two layouts:
 *
 *   Variant A (the common case, amount fits on the date line):
 *     <Date> <Action> <Counterparty> <Type> INR <Amount>
 *     <Time> Transaction ID : <id>
 *     UTR No : <utr>
 *     {Debited from|Credited to} XX<last4>
 *
 *   Variant B (≥5-digit amounts: amount wraps to the time line):
 *     <Date> <Action> <Counterparty> <Type> INR
 *     <Time> <Amount> Transaction ID : <id>
 *     UTR No : <utr>
 *     {Debited from|Credited to} XX<last4>
 *
 * Actions seen in the wild: "Paid to", "Received from", "Bill paid -".
 * Type column is "Debit" or "Credit" — this is the authoritative direction
 * signal (action verb just informs `kind`).
 */

import type {
  Direction,
  ISODate,
  PhonePeParseResult,
  PhonePeRawTransaction,
  PhonePeStatement,
} from "../types/index";
import type { ParseOptions } from "./index";

// ============================================================================
// Patterns
// ============================================================================

// Line 1 — amount on line (Variant A):
//   "Apr 01, 2026 Paid to KRISHNA BEKARY Debit INR 48.00"
const TXN_HEADER_WITH_AMOUNT_RE =
  /^([A-Z][a-z]{2} \d{2}, \d{4}) (Paid to|Received from|Bill paid -) (.+?) (Debit|Credit) INR ([\d,]+\.\d{2})$/;

// Line 1 — amount absent, will appear on line 2 (Variant B):
//   "May 04, 2023 Paid to ******0669 Debit INR"
const TXN_HEADER_NO_AMOUNT_RE =
  /^([A-Z][a-z]{2} \d{2}, \d{4}) (Paid to|Received from|Bill paid -) (.+?) (Debit|Credit) INR$/;

// Line 2 — Variant A (time + txn id):
//   "08:53 AM Transaction ID : AC232604010853361289256546"
const TXN_TIME_RE = /^(\d{2}:\d{2}) (AM|PM) Transaction ID : (\S+)$/;

// Line 2 — Variant B (time + amount + txn id):
//   "02:01 AM 11216.00 Transaction ID : T2305040201054810135940"
const TXN_TIME_AMT_RE = /^(\d{2}:\d{2}) (AM|PM) ([\d,]+\.\d{2}) Transaction ID : (\S+)$/;

// Line 3 — UTR:
const TXN_UTR_RE = /^UTR No : (\d+)$/;

// Line 4 — source account. Optional split suffix captures cases like
//   "Debited from XX0426 INR 20.24 | Wallet INR 39.76"
//   "Debited from XX2491 INR 395.00 | Account INR 67.00"
const TXN_SOURCE_RE =
  /^(Debited from|Credited to) XX(\d{4})( INR [\d,]+\.\d{2} \| .+? INR [\d,]+\.\d{2})?$/;

// Page-1 statement metadata
const HEADER_PHONE_RE = /Transaction Statement for (\+\d{10,15})/;
const HEADER_PERIOD_RE = /^([A-Z][a-z]{2} \d{2}, \d{4}) - ([A-Z][a-z]{2} \d{2}, \d{4})$/;

// Non-transaction lines we silently skip (appears on every page or in the
// disclaimer block).
const SKIP_PATTERNS: RegExp[] = [
  /^Date Transaction Details Type Amount$/,
  /^Page \d+ of \d+$/,
  /^This is (?:a system generated|an automatically generated) statement\b/,
  /^Visit https:\/\//,
  /^\/privacy-policy/,
  /^Do not fall prey\b/,
  /^emails and calls\.$/,
  /^The contents of this email\b/,
  /^received this message\b/,
  /^the recipient's details\b/,
  /^errors in the statement\b/,
];

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

// ============================================================================
// Public entry points
// ============================================================================

export async function parsePhonePe(
  pdf: Uint8Array,
  opts: ParseOptions = {},
): Promise<PhonePeParseResult> {
  if (!opts.extractTextPages) {
    return { statement: null, transactions: [] };
  }
  const pages = await opts.extractTextPages(pdf, opts.password);
  return parsePhonePeText(pages);
}

/**
 * Pure parser: one string per page in, normalized result out.
 * Use directly in tests with hand-crafted text fixtures.
 */
export function parsePhonePeText(pageTexts: string[]): PhonePeParseResult {
  if (pageTexts.length === 0) {
    return { statement: null, transactions: [] };
  }

  const statement = parseHeader(pageTexts[0]!);

  // Flatten all non-empty, non-skipped lines across pages
  const lines: string[] = [];
  for (const pageText of pageTexts) {
    for (const raw of pageText.split("\n")) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (SKIP_PATTERNS.some((re) => re.test(line))) continue;
      // Skip the page-1 statement header lines (already consumed for metadata)
      if (HEADER_PHONE_RE.test(line)) continue;
      if (HEADER_PERIOD_RE.test(line)) continue;
      lines.push(line);
    }
  }

  const txns: PhonePeRawTransaction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Try Variant A header (amount on this line)
    const a = TXN_HEADER_WITH_AMOUNT_RE.exec(line);
    if (a) {
      const txn = consumeBlockVariantA(lines, i, a, txns.length);
      if (txn) {
        txns.push(txn);
        i += 3; // skip the next 3 consumed lines
      }
      continue;
    }

    // Try Variant B header (amount missing, will be on the next line)
    const b = TXN_HEADER_NO_AMOUNT_RE.exec(line);
    if (b) {
      const txn = consumeBlockVariantB(lines, i, b, txns.length);
      if (txn) {
        txns.push(txn);
        i += 3;
      }
      continue;
    }
  }

  return { statement, transactions: txns };
}

// ============================================================================
// Block consumers
// ============================================================================

function consumeBlockVariantA(
  lines: string[],
  i: number,
  header: RegExpExecArray,
  rowIdx: number,
): PhonePeRawTransaction | null {
  const timeMatch = i + 1 < lines.length ? TXN_TIME_RE.exec(lines[i + 1]!) : null;
  const utrMatch = i + 2 < lines.length ? TXN_UTR_RE.exec(lines[i + 2]!) : null;
  const srcMatch = i + 3 < lines.length ? TXN_SOURCE_RE.exec(lines[i + 3]!) : null;
  if (!timeMatch || !utrMatch || !srcMatch) return null;

  const [, dateS, actionS, counterpartyS, typeS, amountS] = header;
  return makeTxn({
    dateS: dateS!,
    timeHH: timeMatch[1]!,
    timeAmPm: timeMatch[2]!,
    actionS: actionS!,
    counterpartyS: counterpartyS!,
    typeS: typeS!,
    amountS: amountS!,
    transactionId: timeMatch[3]!,
    utr: utrMatch[1]!,
    sourceVerb: srcMatch[1]!,
    sourceLast4: srcMatch[2]!,
    splitSuffix: srcMatch[3] ?? null,
    rowIdx,
  });
}

function consumeBlockVariantB(
  lines: string[],
  i: number,
  header: RegExpExecArray,
  rowIdx: number,
): PhonePeRawTransaction | null {
  const timeMatch = i + 1 < lines.length ? TXN_TIME_AMT_RE.exec(lines[i + 1]!) : null;
  const utrMatch = i + 2 < lines.length ? TXN_UTR_RE.exec(lines[i + 2]!) : null;
  const srcMatch = i + 3 < lines.length ? TXN_SOURCE_RE.exec(lines[i + 3]!) : null;
  if (!timeMatch || !utrMatch || !srcMatch) return null;

  const [, dateS, actionS, counterpartyS, typeS] = header;
  return makeTxn({
    dateS: dateS!,
    timeHH: timeMatch[1]!,
    timeAmPm: timeMatch[2]!,
    actionS: actionS!,
    counterpartyS: counterpartyS!,
    typeS: typeS!,
    amountS: timeMatch[3]!,
    transactionId: timeMatch[4]!,
    utr: utrMatch[1]!,
    sourceVerb: srcMatch[1]!,
    sourceLast4: srcMatch[2]!,
    splitSuffix: srcMatch[3] ?? null,
    rowIdx,
  });
}

interface MakeTxnInput {
  dateS: string;
  timeHH: string;
  timeAmPm: string;
  actionS: string;
  counterpartyS: string;
  typeS: string;
  amountS: string;
  transactionId: string;
  utr: string;
  sourceVerb: string;
  sourceLast4: string;
  splitSuffix: string | null;
  rowIdx: number;
}

function makeTxn(x: MakeTxnInput): PhonePeRawTransaction {
  const counterparty = x.counterpartyS.trim();
  return {
    txnDate: parseDateMonDayYear(x.dateS),
    txnTime: to24h(x.timeHH, x.timeAmPm),
    direction: x.typeS === "Credit" ? "in" : "out",
    counterparty,
    amount: parseAmount(x.amountS),
    utr: x.utr,
    transactionId: x.transactionId,
    sourceAccountLast4: x.sourceLast4,
    kind: classifyKind(x.actionS, counterparty),
    splitSourceRaw: x.splitSuffix ? x.splitSuffix.trim() : null,
    sourceRowIdx: x.rowIdx,
  };
}

// ============================================================================
// Statement header
// ============================================================================

function parseHeader(pageText: string): PhonePeStatement | null {
  let phoneNumber: string | undefined;
  let periodFrom: ISODate | undefined;
  let periodTo: ISODate | undefined;

  for (const raw of pageText.split("\n")) {
    const line = raw.trim();
    const ph = HEADER_PHONE_RE.exec(line);
    if (ph) phoneNumber = ph[1];
    const pd = HEADER_PERIOD_RE.exec(line);
    if (pd) {
      periodFrom = parseDateMonDayYear(pd[1]!);
      periodTo = parseDateMonDayYear(pd[2]!);
    }
  }

  if (!phoneNumber && !periodFrom) return null;
  return { phoneNumber, periodFrom, periodTo };
}

// ============================================================================
// Helpers
// ============================================================================

function parseAmount(s: string): number {
  return Number(s.replace(/,/g, ""));
}

/** "Apr 01, 2026" → "2026-04-01" */
function parseDateMonDayYear(s: string): ISODate {
  const m = /^([A-Z][a-z]{2}) (\d{2}), (\d{4})$/.exec(s.trim());
  if (!m) return s;
  const month = MONTHS[m[1]!];
  if (!month) return s;
  return `${m[3]}-${month}-${m[2]}`;
}

/** ("04", "AM") → "04:00"; ("01:26", "PM") → "13:26"; ("12:00", "AM") → "00:00" */
function to24h(hhmm: string, amPm: string): string {
  const [hh, mm] = hhmm.split(":");
  let h = Number(hh);
  if (amPm === "AM" && h === 12) h = 0;
  else if (amPm === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:${mm}`;
}

function classifyKind(actionS: string, counterparty: string): PhonePeRawTransaction["kind"] {
  if (actionS === "Bill paid -") return "bill";
  if (/^\*{2,}\d{3,}$/.test(counterparty)) return "self_transfer";
  if (counterparty.includes("@")) return "vpa";
  return "named";
}

// Re-export the Direction type for downstream consumers convenience
export type { Direction };
