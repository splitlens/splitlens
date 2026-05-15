/**
 * Zepto invoice (GST tax invoice PDF) parser.
 *
 * Each Zepto order can be downloaded as a single-page PDF with a stable
 * structure: a header (Order No., Date), a tabular items section (SR No,
 * Item & Description, MRP, HSN, Qty, Taxable Amt, CGST, SGST, Total), and a
 * footer (Item Total, Invoice Value).
 *
 * Two extraction modes:
 *   - parseZeptoInvoiceText(pages)        — text-only; cheap, gets the
 *     order id / date / total reliably. Items returned as `null` because
 *     pdfjs reading-order text interleaves item names with row data in
 *     ways that aren't safe to disambiguate without coordinates.
 *
 *   - parseZeptoInvoicePositional(pages)  — needs positional words; can
 *     attribute name fragments to the right item by clustering rows by y
 *     and reading the "Item & Description" column (x ∈ [50, 200]).
 *
 * The orchestrator (@splitlens/ingest/zepto-invoice.ts) prefers the
 * positional form and falls back to text when positional extraction yields
 * nothing useful.
 */

import type { ExtractedPage, ISODate, PdfWord } from "../types/index";

export interface ZeptoInvoiceItem {
  /** 1-based position within the invoice's items table. */
  seq: number;
  /** Full item name, joining every Description-column fragment for this row. */
  name: string;
  /** Qty cell on the data row; defaults to 1 when missing. */
  qty: number;
  /** Final line total in INR (rightmost number on the data row). */
  amount: number | null;
}

export interface ZeptoInvoice {
  /** "Order No." — Zepto's internal order id (e.g. HQUUKBCNI14442A). */
  orderNo: string;
  /** "Invoice No." — GST invoice id (separate from order id). */
  invoiceNo: string | null;
  /** Invoice date in ISO YYYY-MM-DD form (PDF prints DD-MM-YYYY). */
  date: ISODate;
  /** Total billed amount in INR — sourced from "Invoice Value" (fallback "Item Total"). */
  amount: number;
  /** Items list. Empty if neither positional nor text mode could attribute names. */
  items: ZeptoInvoiceItem[];
  /** The raw extracted text (joined pages) — kept so consumers can grep for fields we didn't lift. */
  rawText: string;
}

// ============================================================================
// Header-field regexes — these survive intact across both extraction modes
// ============================================================================

const ORDER_NO_RE = /Order\s+No\.?\s*:\s*([A-Z0-9]{8,})/i;
const INVOICE_NO_RE = /Invoice\s+No\.?\s*:\s*([A-Z0-9]{8,})/i;
const DATE_RE = /Date\s*:\s*(\d{2})-(\d{2})-(\d{4})/i;
/** Prefer "Invoice Value" — that's the post-tax billed amount that hits the card. */
const INVOICE_VALUE_RE = /Invoice\s+Value\s+([\d,]+\.\d{2})/i;
const ITEM_TOTAL_RE = /Item\s+Total\s+([\d,]+\.\d{2})/i;

function isoDate(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm}-${dd}`;
}

function parseInr(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function extractHeaderFields(text: string): {
  orderNo: string;
  invoiceNo: string | null;
  date: ISODate;
  amount: number;
} | null {
  const orderMatch = ORDER_NO_RE.exec(text);
  if (!orderMatch) return null;
  const dateMatch = DATE_RE.exec(text);
  if (!dateMatch) return null;
  const amount =
    INVOICE_VALUE_RE.exec(text)?.[1] ?? ITEM_TOTAL_RE.exec(text)?.[1];
  if (!amount) return null;
  return {
    orderNo: orderMatch[1]!,
    invoiceNo: INVOICE_NO_RE.exec(text)?.[1] ?? null,
    date: isoDate(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!),
    amount: parseInr(amount),
  };
}

/**
 * Text-only parser. Returns header fields + an empty `items` list.
 *
 * Use when you only need to match the invoice to a canonical txn — date +
 * amount are enough for that. Items will be empty; callers that want item
 * detail should use the positional form.
 */
export function parseZeptoInvoiceText(pages: string[]): ZeptoInvoice | null {
  const rawText = pages.join("\n");
  const header = extractHeaderFields(rawText);
  if (!header) return null;
  return { ...header, items: [], rawText };
}

// ============================================================================
// Positional parser
// ============================================================================

/** Tolerance (in PDF points) for grouping words into the same row. */
const ROW_Y_TOLERANCE = 3;
/** x-range that the Item & Description column lives in.
 *  - On non-data rows the cell stretches all the way to where MRP would be
 *    (x≈180), so multi-line names fill the wider window.
 *  - On the data row itself, MRP starts at x≈110 — so we narrow the window
 *    to avoid eating "125.00" / "22029999" as if they were part of the name. */
const NAME_COL_X_MIN = 50;
const NAME_COL_X_MAX_CONTINUATION = 180;
const NAME_COL_X_MAX_DATAROW = 110;
/** SR (sequence number) column. */
const SEQ_COL_X_MAX = 50;

interface PositionalRow {
  /** 1-based page this row is on — preserved so multi-page invoices stay in document order. */
  page: number;
  /** Top y for this row (per-page coordinate system). */
  y: number;
  /** Words in this row, sorted left-to-right. */
  words: PdfWord[];
}

/**
 * Group words into rows page-by-page, in document order.
 *
 * Important: we don't flatten across pages before sorting — multi-page Zepto
 * invoices have the items table on page 1 but the "Invoice Value" footer
 * spilling onto page 2, and a flat y-sort would surface the page-2 footer
 * (y≈32) before the page-1 header (y≈297).
 */
function groupIntoRows(pages: ExtractedPage[]): PositionalRow[] {
  const rows: PositionalRow[] = [];
  for (const p of pages) {
    const sorted = [...p.words].sort((a, b) => a.top - b.top || a.x0 - b.x0);
    let cur: PositionalRow | null = null;
    for (const w of sorted) {
      if (cur && Math.abs(w.top - cur.y) <= ROW_Y_TOLERANCE) {
        cur.words.push(w);
      } else {
        cur = { page: p.pageNumber, y: w.top, words: [w] };
        rows.push(cur);
      }
    }
  }
  for (const r of rows) r.words.sort((a, b) => a.x0 - b.x0);
  return rows;
}

/**
 * A row is a "data row" iff it starts with a small integer in the SR-column
 * x-range. Header rows also start with words at x<50 ("SR", "No"), but those
 * are non-numeric so they're filtered out.
 */
function isDataRow(row: PositionalRow): { seq: number } | null {
  const first = row.words[0];
  if (!first || first.x0 > SEQ_COL_X_MAX) return null;
  const seq = Number(first.text);
  if (!Number.isInteger(seq) || seq < 1 || seq > 99) return null;
  // Must also have at least one more word at a meaningful x — header rows
  // ("No", "Description") fail this check because the second word would be
  // outside the data-row column layout. Empirically Zepto data rows have
  // ≥ 8 columns visible.
  if (row.words.length < 5) return null;
  return { seq };
}

/**
 * Rightmost INR-shaped token on a row. Data rows end with the line total in
 * the rightmost x-position. We accept "NNN.NN" (decimal) since every Zepto
 * amount has paise even when zero.
 */
function rightmostInr(row: PositionalRow): number | null {
  for (let i = row.words.length - 1; i >= 0; i--) {
    const t = row.words[i]!.text;
    if (/^[\d,]+\.\d{2}$/.test(t)) {
      return parseInr(t);
    }
  }
  return null;
}

/**
 * Pull words from a row whose x falls inside the Item & Description column.
 * Used both for the data row (gets the leading name fragment) and for
 * non-data rows in the same item band (gets continuation fragments).
 *
 * The two name-column windows differ because the data row has MRP/HSN/Qty
 * columns starting at x≈110, while a non-data continuation row's name cell
 * extends past that point.
 */
function nameColumnText(row: PositionalRow, isDataRow: boolean): string {
  const xMax = isDataRow ? NAME_COL_X_MAX_DATAROW : NAME_COL_X_MAX_CONTINUATION;
  return row.words
    .filter((w) => w.x0 >= NAME_COL_X_MIN && w.x0 < xMax)
    .map((w) => w.text)
    .join(" ")
    .trim();
}

/**
 * Find the bounds of the items table as positional row indices into the
 * flat document-ordered `rows` array. The header row contains the column
 * titles ("No Description MRP/RSP …"); the footer is the first row at or
 * after the header carrying "Item Total" or "Invoice Value".
 *
 * Multi-page friendly: the header may be on page 1 while the footer spills
 * to page 2 — `rows` is already in (page, y) order, so a linear scan
 * preserves that ordering.
 */
function findTableBounds(rows: PositionalRow[]): { headerIdx: number; footerIdx: number } | null {
  let headerIdx: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i]!.words.map((w) => w.text).join(" ");
    if (headerIdx === null && /\bDescription\b.*\bMRP\/RSP\b/i.test(text)) {
      headerIdx = i;
      continue;
    }
    if (headerIdx !== null && (/Item\s*Total/i.test(text) || /Invoice\s*Value/i.test(text))) {
      return { headerIdx, footerIdx: i };
    }
  }
  return null;
}

/**
 * Positional parser — extracts header fields + items list.
 *
 * Returns null if header fields are missing. If items can't be reconstructed
 * (e.g. unfamiliar layout), returns the header with an empty items array
 * rather than failing the whole parse.
 */
export function parseZeptoInvoicePositional(
  pages: ExtractedPage[],
): ZeptoInvoice | null {
  const rawText = pages
    .map((p) => p.words.map((w) => w.text).join(" "))
    .join("\n");

  const header = extractHeaderFields(rawText);
  if (!header) return null;

  const rows = groupIntoRows(pages);
  const bounds = findTableBounds(rows);
  if (!bounds) return { ...header, items: [], rawText };

  // Rows that sit between the header and footer ROW INDICES in document
  // order. We use indices (not y) because the table can span pages and y
  // resets per page.
  const tableRows = rows.slice(bounds.headerIdx + 1, bounds.footerIdx);

  // First pass — identify data rows + their seq + line total.
  interface DataRowInfo {
    seq: number;
    /** Index into tableRows. Used as the item's anchor for name attribution. */
    rowIndex: number;
    lineTotal: number | null;
    qty: number;
  }
  const dataRows: DataRowInfo[] = [];
  for (let i = 0; i < tableRows.length; i++) {
    const dr = isDataRow(tableRows[i]!);
    if (!dr) continue;
    const lineTotal = rightmostInr(tableRows[i]!);
    // Qty column is around x≈205 on the data row. Empirical from samples;
    // a tolerance window around it picks up either 1-digit ("1") or 2-digit
    // ("12") qty without colliding with adjacent percent / amount columns.
    let qty = 1;
    const qtyWord = tableRows[i]!.words.find(
      (w) => w.x0 >= 195 && w.x0 < 225 && /^\d+$/.test(w.text),
    );
    if (qtyWord) qty = Number(qtyWord.text);
    dataRows.push({
      seq: dr.seq,
      rowIndex: i,
      lineTotal,
      qty,
    });
  }

  // Second pass — for each data row, collect name-column text from itself
  // plus the surrounding non-data rows on the same page. We define an
  // item's "band" by ROW INDEX (midpoint between adjacent data rows) so the
  // page boundary doesn't matter; rows are already in document order.
  const items: ZeptoInvoiceItem[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const here = dataRows[i]!;
    const prev = dataRows[i - 1];
    const next = dataRows[i + 1];
    const bandStartIdx = prev
      ? Math.floor((prev.rowIndex + here.rowIndex) / 2) + 1
      : 0;
    const bandEndIdx = next
      ? Math.ceil((here.rowIndex + next.rowIndex) / 2) - 1
      : tableRows.length - 1;

    const fragments: string[] = [];
    for (let j = bandStartIdx; j <= bandEndIdx; j++) {
      const r = tableRows[j];
      if (!r) continue;
      const isOnDataRow = j === here.rowIndex;
      const txt = nameColumnText(r, isOnDataRow);
      if (!txt) continue;
      // Skip the "0.00%" / "+ 0.00" cess-column entries that landed inside
      // the name column window when their x is on the border.
      if (/^\+?\s*\d+\.\d{2}%?$/.test(txt)) continue;
      fragments.push(txt);
    }
    const name = fragments.join(" ").replace(/\s+/g, " ").trim();
    items.push({
      seq: here.seq,
      name: name || `Item ${here.seq}`,
      qty: here.qty,
      amount: here.lineTotal,
    });
  }

  return { ...header, items, rawText };
}
