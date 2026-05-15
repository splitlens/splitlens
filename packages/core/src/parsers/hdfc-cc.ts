/**
 * HDFC Credit Card statement parser.
 *
 * HDFC has shipped TWO PDF formats over time:
 *   - v1.3 (older, 2024 → mid-2025): no 'C' marker before amounts, 'Cr' suffix
 *     for credits, time format HH:MM:SS, rewards inline before amount
 *   - v1.6 (newer, late 2025+): 'C' marker before amounts (rupee glyph misread),
 *     trailing 'l' (PI indicator), time format HH:MM, rewards prefixed with '+',
 *     IGST/charge entries split across 3 lines (description above + below)
 *
 * Format detection: scan for any line where ' C ' precedes an amount → v1.6.
 *
 * Faithful port of the Python prototype at ~/finance/src/cc_extract.py.
 */

import type { CcParseResult, CcRawTransaction, CcStatement } from "../types/index";
import type { ParseOptions } from "./index";

// === v1.6 format (late 2025+) ===
// Full line: DD/MM/YYYY[ |] HH:MM DESCRIPTION [+ rewards] C amount [trailing 'l']
const TXN_LINE_RE =
  /^(\d{2}\/\d{2}\/\d{4})\s*\|?\s*(\d{2}:\d{2})\s+(.+?)\s+C\s*([\d,]+\.\d{2})\s*l?\s*$/;
// Charge amount-only: DD/MM/YYYY HH:MM C amount  (description on prev/next line)
const CHARGE_AMT_ONLY_RE =
  /^(\d{2}\/\d{2}\/\d{4})\s*\|?\s*(\d{2}:\d{2})\s+C\s*([\d,]+\.\d{2})\s*l?\s*$/;

// === v1.3 format (older) ===
const V13_FULL_REWARDS_RE =
  /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)\s+(\d+)\s+([\d,]+\.\d{2})(Cr)?\s*$/;
const V13_FULL_NOREWARDS_RE =
  /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)\s+([\d,]+\.\d{2})(Cr)?\s*$/;
const V13_CHARGE_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)(?:\s+-\s+\d+)?\s+([\d,]+\.\d{2})(Cr)?\s*$/;

// Common patterns
const FCY_RE = /\b([A-Z]{3})\s+([\d,]+\.\d{2})\b/;
const REWARDS_TAIL_RE = /\+\s*(\d+)\s*$/;

// Header regexes (for statement metadata) — both v1.6 and v1.3 layouts
// v1.6: "Credit Card No. 552260XXXXXX3969"
// v1.3: "Card No: 5522 60XX XXXX 3969"  (spaces between groups)
const CARD_RE_V16 = /Credit Card No\.\s*(\d{6}X+(\d{4}))/;
const CARD_RE_V13 = /Card No:\s*\d{4}\s*\d{2}XX\s*XXXX\s*(\d{4})/;
const CARD_TYPE_RE = /^(\w+)\s+(?:MasterCard\s+)?Credit Card Statement/m;
const NAME_RE = /^([A-Z][A-Z ]+?)\s+Credit Card No\./m;
const STMT_DATE_V16 = /Statement Date\s+(\d{1,2}\s+[A-Z][a-z]{2},?\s*\d{4})/;
// v1.3 uses "Statement Date:DD/MM/YYYY" (no space after colon, slash format)
const STMT_DATE_V13 = /Statement Date:(\d{2}\/\d{2}\/\d{4})/;
const PERIOD_RE =
  /Billing Period\s+(\d{1,2}\s+[A-Z][a-z]{2},?\s*\d{4})\s*-\s*(\d{1,2}\s+[A-Z][a-z]{2},?\s*\d{4})/;

const SKIP_PREFIXES = [
  "DATE & TIME",
  "Page ",
  "PRATEEK ARYAN",
  "PROGRAMS",
  "GST Summary",
  "*Transaction time",
  "*Note",
  "Important Information",
  "Reward",
  "DUPLICATE",
  "HSN Code",
  "Statement Date",
  "Billing Period",
  "PAYMENTS/CREDITS",
  "PREVIOUS STATEMENT",
  "RECEIVED",
  "TOTAL CREDIT",
  "(Including",
  "Past Dues",
  "(if any)",
  "Benefits",
  "IMPORTANT",
  "WEF",
  "BANK WILL",
  "DUE DATE",
  "COMPLIMENTARY",
  "BANKCLAIMS",
  "YOUR NOMINATED",
  "* All",
  "* The",
  "Your Card",
  "Domestic Transaction",
  "Online",
  "ENABLED",
  "Purchase Indicator",
  "100%",
  "_ C",
  "REDEEM",
  "offers on",
  "Date Transaction",
  "Points",
  "Feature ",
  "Opening",
  "Smart EMI",
  "Loan Number",
  "GST No",
  "Email :",
  "Address :",
  "Note :",
  "BENGALURU",
  "Pre-closure",
  "For HDFC",
  "To Hotlist",
  "Credit Information",
  "0 Layout",
  "Srno",
  "IGST CGST",
  "Total",
];

// ============================================================================
// Public entry points
// ============================================================================

export async function parseHdfcCc(
  pdf: Uint8Array,
  opts: ParseOptions = {},
): Promise<CcParseResult> {
  if (!opts.extractTextPages) {
    return { statement: null, transactions: [] };
  }
  const pages = await opts.extractTextPages(pdf, opts.password);
  return parseHdfcCcText(pages);
}

/**
 * Pure parser: takes one string per page, returns structured CC txns.
 * Use directly in tests with hand-crafted text fixtures.
 */
export function parseHdfcCcText(pageTexts: string[]): CcParseResult {
  if (pageTexts.length === 0) {
    return { statement: null, transactions: [] };
  }

  const statement = parseHeader(pageTexts[0]!);

  // Flatten all non-empty lines across pages
  const allLines: string[] = [];
  for (const pageText of pageTexts) {
    for (const raw of pageText.split("\n")) {
      const line = raw.trim();
      if (line.length > 0) allLines.push(line);
    }
  }

  // Detect version: v1.6 has ' C ' marker before amounts
  const isV16 = allLines.some((ln) => /\d{2}\/\d{2}\/\d{4}.*C\s*[\d,]+\.\d{2}/.test(ln));

  let inIntl = false;
  const txns: CcRawTransaction[] = [];

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i]!;

    // Section markers — used for is_international flag
    if (line.includes("International Transactions")) {
      inIntl = true;
      continue;
    }
    if (line.includes("Domestic Transactions")) {
      inIntl = false;
      continue;
    }
    // Skip non-transaction headers/footers (CRITICAL: don't include short prefixes
    // like "0" that would match date-prefixed lines)
    if (SKIP_PREFIXES.some((p) => line.startsWith(p))) continue;

    if (isV16) {
      const m = TXN_LINE_RE.exec(line);
      if (m) {
        txns.push(processV16FullLine(m[1]!, m[2]!, m[3]!, m[4]!, inIntl, txns.length));
        continue;
      }
      const c = CHARGE_AMT_ONLY_RE.exec(line);
      if (c) {
        const prevLine = i > 0 ? allLines[i - 1]! : "";
        const nextLine = i + 1 < allLines.length ? allLines[i + 1]! : "";
        const looksLikeCharge =
          /^(IGST-|CGST-|SGST-|CONSOLIDATED FCY|FINANCE CHARGE)/.test(prevLine) ||
          prevLine.includes("(Ref#");
        if (looksLikeCharge) {
          txns.push(
            processV16ChargeLines(c[1]!, c[2]!, c[3]!, prevLine, nextLine, inIntl, txns.length),
          );
        }
      }
    } else {
      // v1.3: try with-rewards first (more specific)
      let m = V13_FULL_REWARDS_RE.exec(line);
      if (m) {
        txns.push(
          processV13Line(
            m[1]!,
            m[2]!,
            m[3]!,
            m[5]!,
            !!m[6],
            parseInt(m[4]!, 10),
            inIntl,
            txns.length,
          ),
        );
        continue;
      }
      m = V13_FULL_NOREWARDS_RE.exec(line);
      if (m) {
        txns.push(processV13Line(m[1]!, m[2]!, m[3]!, m[4]!, !!m[5], null, inIntl, txns.length));
        continue;
      }
      m = V13_CHARGE_RE.exec(line);
      if (m) {
        txns.push(processV13Line(m[1]!, null, m[2]!, m[3]!, !!m[4], null, inIntl, txns.length));
      }
    }
  }

  return { statement, transactions: txns };
}

// ============================================================================
// Per-format processors
// ============================================================================

function processV16FullLine(
  dateS: string,
  timeS: string,
  desc: string,
  amtS: string,
  inIntl: boolean,
  rowIdx: number,
): CcRawTransaction {
  const amount = parseAmount(amtS)!;
  const txnDate = ddmmyyyyToISO(dateS);
  let descClean = desc.trim();

  const isPayment =
    /AUTOPAY/i.test(descClean) || (/PAYMENT/i.test(descClean) && /THANK YOU/i.test(descClean));
  const isCharge =
    /^(IGST-|CGST-|SGST-|CONSOLIDATED FCY|FINANCE CHARGE)/.test(descClean) ||
    /MARKUP/i.test(descClean);

  // Foreign currency token (e.g. "USD 118.00")
  const fcyMatch = FCY_RE.exec(descClean);
  let foreignAmount: string | undefined;
  if (fcyMatch) {
    foreignAmount = `${fcyMatch[1]} ${fcyMatch[2]}`;
    descClean = descClean.replace(FCY_RE, "").trim();
  }

  // Trailing rewards "+ N"
  let rewards: number | undefined;
  const rwdMatch = REWARDS_TAIL_RE.exec(descClean);
  if (rwdMatch) {
    rewards = parseInt(rwdMatch[1]!, 10);
    descClean = descClean.replace(REWARDS_TAIL_RE, "").trim();
  }
  // Strip any leftover trailing '+'
  descClean = descClean.replace(/\s*\+\s*$/, "").trim();

  return {
    txnDate,
    txnTime: timeS === "00:00" ? null : timeS,
    description: descClean,
    amount,
    isPayment,
    isInternational: inIntl,
    foreignAmount,
    isCharge,
    rewards,
    sourceRowIdx: rowIdx,
  };
}

function processV16ChargeLines(
  dateS: string,
  timeS: string,
  amtS: string,
  prevLine: string,
  nextLine: string,
  inIntl: boolean,
  rowIdx: number,
): CcRawTransaction {
  const description = `${prevLine.trim()} ${nextLine.trim()}`.trim().replace(/\s+l$/, "").trim();
  return {
    txnDate: ddmmyyyyToISO(dateS),
    txnTime: timeS === "00:00" ? null : timeS,
    description,
    amount: parseAmount(amtS)!,
    isPayment: false,
    isInternational: inIntl,
    foreignAmount: undefined,
    isCharge: true,
    rewards: undefined,
    sourceRowIdx: rowIdx,
  };
}

function processV13Line(
  dateS: string,
  timeS: string | null,
  desc: string,
  amtS: string,
  isCr: boolean,
  rewards: number | null,
  inIntl: boolean,
  rowIdx: number,
): CcRawTransaction {
  const amount = parseAmount(amtS)!;
  let descClean = desc.trim();

  const isPayment = isCr && (/AUTOPAY/i.test(descClean) || /THANK YOU/i.test(descClean));
  const isCharge =
    /^(IGST-|CGST-|SGST-|CONSOLIDATED FCY|FINANCE CHARGE|OFFUS EMI)/.test(descClean) ||
    /MARKUP/i.test(descClean) ||
    (/AGGREGATOR/i.test(descClean) && /EMI/i.test(descClean));

  const fcyMatch = FCY_RE.exec(descClean);
  let foreignAmount: string | undefined;
  if (fcyMatch) {
    foreignAmount = `${fcyMatch[1]} ${fcyMatch[2]}`;
    descClean = descClean.replace(FCY_RE, "").trim();
  }

  return {
    txnDate: ddmmyyyyToISO(dateS),
    txnTime: timeS,
    description: descClean,
    amount,
    isPayment,
    isInternational: inIntl,
    foreignAmount,
    isCharge,
    rewards: rewards ?? undefined,
    sourceRowIdx: rowIdx,
  };
}

// ============================================================================
// Statement-level metadata
// ============================================================================

function parseHeader(text: string): CcStatement | null {
  // Try v1.6 card format first, fall back to v1.3
  const cardV16 = CARD_RE_V16.exec(text);
  const cardV13 = cardV16 ? null : CARD_RE_V13.exec(text);
  const cardLast4 = cardV16?.[2] ?? cardV13?.[1] ?? "";

  const typeMatch = CARD_TYPE_RE.exec(text);
  const nameMatch = NAME_RE.exec(text);

  // Statement date: try v1.6 ("20 Apr, 2026") first, then v1.3 ("20/08/2024")
  const sdV16 = STMT_DATE_V16.exec(text);
  const sdV13 = sdV16 ? null : STMT_DATE_V13.exec(text);
  const statementDate = sdV16
    ? parseDateMonYear(sdV16[1]!)
    : sdV13
      ? ddmmyyyyToISO(sdV13[1]!)
      : undefined;

  const perMatch = PERIOD_RE.exec(text);

  if (!cardLast4 && !statementDate) return null;

  return {
    bank: "HDFC",
    // "Regal0ia MasterCard" is a v1.3 OCR artifact — normalize to "Regalia"
    cardType: typeMatch?.[1]?.replace(/Regal0ia/, "Regalia") ?? "Regalia",
    cardLast4,
    customerName: nameMatch?.[1]?.trim(),
    statementDate,
    periodFrom: perMatch ? parseDateMonYear(perMatch[1]!) : undefined,
    periodTo: perMatch ? parseDateMonYear(perMatch[2]!) : undefined,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function parseAmount(s: string): number | null {
  const cleaned = (s ?? "").trim().replace(/,/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function ddmmyyyyToISO(s: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

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

function parseDateMonYear(s: string): string {
  // "20 Apr, 2026" or "20 Apr 2026" → ISO YYYY-MM-DD
  const m = /^(\d{1,2})\s+([A-Z][a-z]{2}),?\s*(\d{4})$/.exec(s.trim());
  if (!m) return s;
  const day = m[1]!.padStart(2, "0");
  const month = MONTHS[m[2]!];
  if (!month) return s;
  return `${m[3]}-${month}-${day}`;
}
