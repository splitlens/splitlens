/**
 * HDFC Savings statement parser.
 *
 * Strategy: positional word extraction (NOT plain text), because the savings
 * statement uses two adjacent columns — Withdrawal vs Deposit — that cannot
 * be distinguished from plain text alone (only one column has a value per row,
 * and the empty column gets collapsed by text extractors).
 *
 * The header row gives us the x-positions of each column; the first transaction
 * row gives us the actual content x-extent of the date column. From those, we
 * derive 7 column boundary x-coordinates. Each subsequent word is bucketed
 * into a column by where its center falls.
 *
 * Faithful port of the Python prototype at ~/finance/src/extract.py.
 */

import type {
  ExtractedPage,
  ParseResult,
  ParsedStatement,
  PdfWord,
  RawTransaction,
} from "../types/index";
import type { ParseOptions } from "./index";

/** Footer y-cutoff: words below this on each page are page footer (bank GSTN/address). */
const FOOTER_Y_CUTOFF = 770;

/** DD/MM/YY transaction date pattern (HDFC short-date format). */
const DATE_RE = /^\d{2}\/\d{2}\/\d{2}$/;

/**
 * Period header — accepts both no-space ("StatementFrom") and spaced ("Statement From")
 * forms because pdfplumber and pdfjs render text differently.
 */
const PERIOD_RE = /Statement\s*From\s*:\s*(\d{2}\/\d{2}\/\d{4}).*?To\s*:\s*(\d{2}\/\d{2}\/\d{4})/;
const ACCT_NO_RE = /Account\s*No\s*:\s*(\d+)/;
const NAME_RE = /^MR\.?\s+([A-Z][A-Z ]+?)\s*$/m;

// HDFC's PDF actually renders these with internal spaces ("Value Dt", etc.).
// pdfplumber in Python glued them together (no spaces) — pdfjs preserves them.
// We accept the spaced form as canonical; any caller producing the no-space
// variant should normalize first, or we can fall back to no-space below.
const HEADER_KEYS = [
  "Date",
  "Narration",
  "Chq./Ref.No.",
  "Value Dt",
  "Withdrawal Amt.",
  "Deposit Amt.",
  "Closing Balance",
] as const;
// Aliases (no-space form, kept for backward compatibility with old fixtures)
const HEADER_ALIASES: Record<string, string> = {
  ValueDt: "Value Dt",
  "WithdrawalAmt.": "Withdrawal Amt.",
  "DepositAmt.": "Deposit Amt.",
  ClosingBalance: "Closing Balance",
};

type ColumnKey = "date" | "narration" | "ref" | "value_date" | "withdrawal" | "deposit" | "balance";
type ColumnRanges = Record<ColumnKey, [number, number]>;

const COLUMN_KEYS: ColumnKey[] = [
  "date",
  "narration",
  "ref",
  "value_date",
  "withdrawal",
  "deposit",
  "balance",
];

interface RowBuckets {
  date: string[];
  narration: string[];
  ref: string[];
  value_date: string[];
  withdrawal: string[];
  deposit: string[];
  balance: string[];
}

interface DraftTxn extends RowBuckets {
  /** narration accumulated across continuation lines */
  narrationParts: string[];
}

// ============================================================================
// Public entry point
// ============================================================================

export async function parseHdfcSavings(
  pdf: Uint8Array,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  if (!opts.extractPages) {
    // No extractor available (e.g. pure Node test without PDF.js wired).
    // Caller is expected to use parseHdfcSavingsPages directly with pre-extracted pages.
    return { statement: null, transactions: [] };
  }
  const pages = await opts.extractPages(pdf, opts.password);
  return parseHdfcSavingsPages(pages);
}

/**
 * Pure parser: takes already-extracted positional pages, returns structured txns.
 * Use this directly in tests with hand-crafted PdfWord arrays.
 */
export function parseHdfcSavingsPages(pages: ExtractedPage[]): ParseResult {
  if (pages.length === 0) {
    return { statement: null, transactions: [] };
  }

  // Statement metadata from page 1's text (joined from words)
  const page1Text = pageText(pages[0]!);
  const statement = parseMetadata(page1Text);

  // Walk all pages, parse transactions positionally
  let ranges: ColumnRanges | null = null;
  const transactions: RawTransaction[] = [];
  let rowIdx = 0;

  for (const page of pages) {
    const filteredWords = page.words.filter((w) => w.top < FOOTER_Y_CUTOFF);
    const lines = clusterLines(filteredWords);
    if (ranges === null) {
      ranges = findHeaderColumns(lines);
      if (ranges === null) continue; // no header on this page; skip
    }
    const pageTxns = parseTxnRows(lines, ranges);
    for (const t of pageTxns) {
      transactions.push({ ...t, sourceRowIdx: rowIdx });
      rowIdx += 1;
    }
  }

  return { statement, transactions };
}

// ============================================================================
// Positional logic — ported faithfully from extract.py
// ============================================================================

/** Combined text of a page's words in line order. Used for metadata regexes. */
function pageText(page: ExtractedPage): string {
  const lines = clusterLines(page.words);
  return lines.map((line) => line.map((w) => w.text).join(" ")).join("\n");
}

/**
 * Group words into lines by y-coordinate proximity.
 * Words within `yTol` of each other on the y-axis belong to the same line.
 * Each line's words are sorted left-to-right.
 */
export function clusterLines(words: PdfWord[], yTol = 2.0): PdfWord[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => {
    const yDiff = roundTo(a.top, 1) - roundTo(b.top, 1);
    if (yDiff !== 0) return yDiff;
    return a.x0 - b.x0;
  });
  const lines: PdfWord[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i]!;
    const last = lines[lines.length - 1]!;
    const lastWord = last[last.length - 1]!;
    if (Math.abs(w.top - lastWord.top) <= yTol) {
      last.push(w);
    } else {
      lines.push([w]);
    }
  }
  for (const line of lines) {
    line.sort((a, b) => a.x0 - b.x0);
  }
  return lines;
}

/**
 * Locate the header row, then derive 7 column x-boundaries.
 *
 * Tricky bit: the header label "Narration" centers around x=144, but actual
 * narration content starts around x=68 (left-aligned). Using the header
 * midpoint as the date/narration boundary would push short narrations like
 * "SALARY" into the date column. So we sniff the *first* transaction line
 * (whose first word is a date) and use that date word's x1 + 3 as the boundary.
 */
export function findHeaderColumns(lines: PdfWord[][]): ColumnRanges | null {
  let headerIdx = -1;
  let headerPos: Record<string, [number, number]> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Normalize each word to canonical (spaced) form via the alias map
    const normalize = (t: string): string => HEADER_ALIASES[t] ?? t;
    const texts = new Set(line.map((w) => normalize(w.text)));
    if (HEADER_KEYS.every((k) => texts.has(k))) {
      headerIdx = i;
      headerPos = {};
      for (const w of line) {
        const canonical = normalize(w.text);
        headerPos[canonical] = [w.x0, w.x1];
      }
      break;
    }
  }
  if (headerIdx === -1 || headerPos === null) return null;

  // Sniff the first transaction line's date x1 to anchor narration's left edge
  let dateX1: number | null = null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const first = line[0];
    if (first && DATE_RE.test(first.text)) {
      dateX1 = first.x1;
      break;
    }
  }
  const narrationLeft = dateX1 !== null ? dateX1 + 3 : headerPos["Date"]![1] + 3;

  // Boundaries between successive header columns are midpoints between
  // current.x1 and next.x0. First boundary is 0; narrationLeft overrides
  // boundaries[1]; last extends past the final header.
  const order: (keyof typeof headerPos)[] = [
    "Narration",
    "Chq./Ref.No.",
    "Value Dt",
    "Withdrawal Amt.",
    "Deposit Amt.",
    "Closing Balance",
  ];
  const boundaries: number[] = [0, narrationLeft];
  for (let i = 0; i < order.length - 1; i++) {
    const curX1 = headerPos[order[i]!]![1];
    const nextX0 = headerPos[order[i + 1]!]![0];
    boundaries.push((curX1 + nextX0) / 2);
  }
  boundaries.push(headerPos["Closing Balance"]![1] + 100);

  const ranges = {} as ColumnRanges;
  for (let i = 0; i < COLUMN_KEYS.length; i++) {
    ranges[COLUMN_KEYS[i]!] = [boundaries[i]!, boundaries[i + 1]!];
  }
  return ranges;
}

function assignColumn(word: PdfWord, ranges: ColumnRanges): ColumnKey | null {
  const cx = (word.x0 + word.x1) / 2;
  for (const key of COLUMN_KEYS) {
    const [lo, hi] = ranges[key];
    if (cx >= lo && cx < hi) return key;
  }
  return null;
}

function emptyBuckets(): RowBuckets {
  return {
    date: [],
    narration: [],
    ref: [],
    value_date: [],
    withdrawal: [],
    deposit: [],
    balance: [],
  };
}

/**
 * Walk lines in order. A line whose first word is a date starts a new transaction.
 * Continuation lines (no date) append to the running transaction's narration / ref.
 */
function parseTxnRows(
  lines: PdfWord[][],
  ranges: ColumnRanges,
): Omit<RawTransaction, "sourceRowIdx">[] {
  const drafts: DraftTxn[] = [];
  let current: DraftTxn | null = null;
  let inTable = false;

  for (const line of lines) {
    const first = line[0];
    if (!first) continue;

    if (!inTable) {
      if (assignColumn(first, ranges) === "date" && DATE_RE.test(first.text)) {
        inTable = true;
      } else {
        continue;
      }
    }

    const isNewTxn = assignColumn(first, ranges) === "date" && DATE_RE.test(first.text);

    if (isNewTxn) {
      if (current !== null) drafts.push(current);
      const buckets = emptyBuckets();
      for (const w of line) {
        const col = assignColumn(w, ranges);
        if (col !== null) buckets[col].push(w.text);
      }
      current = {
        ...buckets,
        narrationParts: buckets.narration.length > 0 ? [buckets.narration.join(" ")] : [],
      };
    } else if (current !== null) {
      // Continuation line — append narration words; if ref column has a value
      // and we don't already have one, accept it
      for (const w of line) {
        const col = assignColumn(w, ranges);
        if (col === "narration") {
          current.narrationParts.push(w.text);
        } else if (col === "ref" && current.ref.length === 0) {
          current.ref.push(w.text);
        }
      }
    }
  }

  if (current !== null) drafts.push(current);

  // Materialize: parse amounts, normalize dates, drop rows without a balance
  const out: Omit<RawTransaction, "sourceRowIdx">[] = [];
  for (const d of drafts) {
    const balance = parseAmount(d.balance.join(" "));
    if (balance === null) continue;

    const narration = d.narrationParts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(" ");

    out.push({
      txnDate: ddmmyyToISO(d.date[0] ?? ""),
      valueDate: d.value_date[0] ? ddmmyyToISO(d.value_date[0]) : undefined,
      narration,
      refNo: d.ref.join(" ").trim() || undefined,
      withdrawal: parseAmount(d.withdrawal.join(" ")),
      deposit: parseAmount(d.deposit.join(" ")),
      closingBalance: balance,
    });
  }
  return out;
}

// ============================================================================
// Statement-level metadata
// ============================================================================

function parseMetadata(text: string): ParsedStatement | null {
  const flat = text.replace(/\n/g, " ");
  const periodMatch = PERIOD_RE.exec(flat);
  const acctMatch = ACCT_NO_RE.exec(flat);
  const nameMatch = NAME_RE.exec(text);

  if (!acctMatch && !periodMatch) return null;

  const accountNo = acctMatch?.[1] ?? "";
  return {
    bank: "HDFC",
    accountType: "savings",
    accountLast4: accountNo.length >= 4 ? accountNo.slice(-4) : accountNo,
    customerName: nameMatch?.[1]?.trim(),
    periodFrom: periodMatch ? ddmmyyyyToISO(periodMatch[1]!) : undefined,
    periodTo: periodMatch ? ddmmyyyyToISO(periodMatch[2]!) : undefined,
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

function ddmmyyToISO(s: string): string {
  // "DD/MM/YY" → "YYYY-MM-DD" (assume 20YY)
  if (!DATE_RE.test(s)) return s;
  const [dd, mm, yy] = s.split("/");
  return `20${yy}-${mm}-${dd}`;
}

function ddmmyyyyToISO(s: string): string {
  // "DD/MM/YYYY" → "YYYY-MM-DD"
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
