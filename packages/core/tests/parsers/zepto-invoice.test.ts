import { describe, it, expect } from "vitest";
import { parseZeptoInvoiceText, parseZeptoInvoicePositional } from "../../src/parsers/zepto-invoice";
import type { ExtractedPage, PdfWord } from "../../src/types/index";

// ============================================================================
// Text-mode parser — covers header-field extraction. Items are not extractable
// from reading-order text (the Zepto table column-major layout doesn't
// preserve item-name → row associations), so the text parser always returns
// items: []. That's verified here so future refactors don't accidentally
// "fix" the empty-array contract.
// ============================================================================

const NEWER_INVOICE_TEXT = `Seller Name: Geddit Convenience Private Limited
TAX INVOICE/BILL OF SUPPLY
Invoice No.: 260529G006536991 Place Of Supply : KARNATAKA (29)
Order No.: HQUUKBCNI14442A Date : 14-05-2026
Item Total 345.01
Invoice Value 345.01`;

const OLDER_INVOICE_TEXT = `Seller Name: Geddit Convenience Private Limited
TAX INVOICE/BILL OF SUPPLY
Invoice No.: 260529G005184429 Place Of Supply : KARNATAKA (29)
Order No.: SLTKJBCNN42993A Date : 11-05-2026
Item Total 568.99
Round off to 0.01
Invoice Value 569.00`;

describe("parseZeptoInvoiceText", () => {
  it("extracts orderNo, date (ISO), amount from a single-page invoice", () => {
    const r = parseZeptoInvoiceText([NEWER_INVOICE_TEXT]);
    expect(r).not.toBeNull();
    expect(r!.orderNo).toBe("HQUUKBCNI14442A");
    expect(r!.invoiceNo).toBe("260529G006536991");
    expect(r!.date).toBe("2026-05-14");
    expect(r!.amount).toBe(345.01);
    expect(r!.items).toEqual([]);
  });

  it("prefers 'Invoice Value' over 'Item Total' when both are present", () => {
    // OLDER_INVOICE_TEXT has Item Total=568.99 + Invoice Value=569.00 (the
    // 0.01 round-off goes into Invoice Value). Parser should pick the
    // post-round-off total since that's what hit the card.
    const r = parseZeptoInvoiceText([OLDER_INVOICE_TEXT]);
    expect(r!.amount).toBe(569);
  });

  it("falls back to 'Item Total' when 'Invoice Value' is absent", () => {
    const text = `Order No.: ABC12345 Date : 01-01-2026
Item Total 100.00`;
    const r = parseZeptoInvoiceText([text]);
    expect(r!.amount).toBe(100);
  });

  it("returns null when Order No is missing", () => {
    const text = `Date : 14-05-2026
Invoice Value 100.00`;
    expect(parseZeptoInvoiceText([text])).toBeNull();
  });

  it("returns null when Date is missing", () => {
    const text = `Order No.: ABC12345
Invoice Value 100.00`;
    expect(parseZeptoInvoiceText([text])).toBeNull();
  });

  it("returns null when neither total field is present", () => {
    const text = `Order No.: ABC12345 Date : 14-05-2026`;
    expect(parseZeptoInvoiceText([text])).toBeNull();
  });
});

// ============================================================================
// Positional parser — items extraction with realistic two-page layout.
// Coords below mirror the real PDF (header at y≈297, items at y=349+, footer
// "Item Total" at y=767, "Invoice Value" spilling to page 2).
// ============================================================================

function word(
  text: string,
  x: number,
  top: number,
  pageWidth = 600,
): PdfWord {
  // x1 / bottom are derived; only x0 + top matter for the parser logic.
  void pageWidth;
  const charWidth = 6;
  return {
    text,
    x0: x,
    x1: x + text.length * charWidth,
    top,
    bottom: top + 10,
  };
}

function page(pageNumber: number, words: PdfWord[]): ExtractedPage {
  return {
    pageNumber,
    width: 600,
    height: 842,
    words,
  };
}

describe("parseZeptoInvoicePositional — single-page invoice", () => {
  // Synthetic Red Bull + Gold Flake — same shape as the real newer invoice
  // we tested by hand. Column x's match the real layout (within tolerance).
  const page1 = page(1, [
    // header line
    word("TAX", 226, 134),
    word("INVOICE/BILL", 250, 134),
    word("OF", 320, 134),
    word("SUPPLY", 335, 134),
    word("Invoice", 42, 155),
    word("No.:", 70, 155),
    word("260529G006536991", 95, 155),
    word("Order", 42, 171),
    word("No.:", 70, 171),
    word("HQUUKBCNI14442A", 95, 171),
    word("Date", 297, 171),
    word(":", 325, 171),
    word("14-05-2026", 335, 171),
    // table headers (multi-row)
    word("SR", 38, 279),
    word("Item", 67, 279),
    word("Description", 60, 297),
    word("MRP/RSP", 113, 297),
    word("Rate", 234, 297),
    // item 1 name fragments (above data row)
    word("Red", 64, 318),
    word("Bull", 90, 318),
    word("Energy", 67, 331),
    word("Drink", 68, 345),
    // item 1 data row
    word("1", 42, 358),
    word("Ready", 64, 358),
    word("to", 90, 358),
    word("125.00", 119, 358),
    word("22029999", 160, 358),
    word("1", 210, 358),
    word("89.29", 233, 358),
    word("16.00%", 267, 358),
    word("75.00", 309, 358),
    word("105.00", 537, 358),
    // item 1 name continuation (below data row)
    word("Drink", 70, 372),
    word("Beverage", 60, 385),
    word("1", 100, 385),
    word("pc", 60, 399),
    word("(250", 70, 399),
    word("ml)", 95, 399),
    // item 2 name fragments
    word("Gold", 60, 417),
    word("Flake", 90, 417),
    word("Cigarette", 64, 430),
    // item 2 data row
    word("2", 42, 457),
    word("(Gold", 59, 457),
    word("Flake", 90, 457),
    word("240.00", 119, 457),
    word("24022090", 160, 457),
    word("1", 210, 457),
    word("171.43", 231, 457),
    word("240.00", 537, 457),
    // item 2 continuation
    word("Lights)", 64, 471),
    word("1", 100, 471),
    word("pack", 65, 485),
    // footer
    word("Item", 33, 540),
    word("Total", 60, 540),
    word("345.01", 537, 540),
    word("Invoice", 33, 557),
    word("Value", 80, 557),
    word("345.01", 537, 557),
  ]);

  it("extracts header + items with correct names + totals", () => {
    const r = parseZeptoInvoicePositional([page1]);
    expect(r).not.toBeNull();
    expect(r!.orderNo).toBe("HQUUKBCNI14442A");
    expect(r!.date).toBe("2026-05-14");
    expect(r!.amount).toBe(345.01);
    expect(r!.items).toHaveLength(2);
    expect(r!.items[0]!.seq).toBe(1);
    expect(r!.items[0]!.amount).toBe(105);
    expect(r!.items[0]!.name).toContain("Red Bull Energy Drink");
    expect(r!.items[1]!.seq).toBe(2);
    expect(r!.items[1]!.amount).toBe(240);
    expect(r!.items[1]!.name).toContain("Gold Flake");
  });
});

describe("parseZeptoInvoicePositional — multi-page invoice with footer overflow", () => {
  // Mirrors the real older invoice: items table on page 1, "Item Total" at
  // page-1 bottom, "Invoice Value" spilling onto page 2. The fix here is
  // that we don't flat-sort across pages; if we did, "Invoice Value" at
  // page-2 y=32 would beat the page-1 header at y=297 and findTableBounds
  // would never lock onto the header.
  const page1 = page(1, [
    word("Order", 42, 171),
    word("No.:", 70, 171),
    word("SLTKJBCNN42993A", 95, 171),
    word("Date", 297, 171),
    word(":", 325, 171),
    word("11-05-2026", 335, 171),
    word("No", 39, 297),
    word("Description", 59, 297),
    word("MRP/RSP", 113, 297),
    word("Liquid", 61, 349),
    word("Gel", 90, 349),
    word("1", 42, 349),
    word("199.00", 120, 349),
    word("34022010", 162, 349),
    word("1", 212, 349),
    word("169.00", 539, 349),
    word("Item", 33, 540),
    word("Total", 60, 540),
    word("568.99", 536, 540),
  ]);
  const page2 = page(2, [
    word("Invoice", 33, 32),
    word("Value", 80, 32),
    word("569.00", 537, 32),
  ]);

  it("finds the header on page 1 and the footer on page 2 in document order", () => {
    const r = parseZeptoInvoicePositional([page1, page2]);
    expect(r).not.toBeNull();
    expect(r!.orderNo).toBe("SLTKJBCNN42993A");
    expect(r!.amount).toBe(569); // post-round-off
    expect(r!.items).toHaveLength(1);
    expect(r!.items[0]!.amount).toBe(169);
    expect(r!.items[0]!.name).toContain("Liquid Gel");
  });
});

describe("parseZeptoInvoicePositional — header missing", () => {
  it("returns null when Order No / Date / Invoice Value can't be found", () => {
    const p = page(1, [word("not a zepto invoice", 100, 100)]);
    expect(parseZeptoInvoicePositional([p])).toBeNull();
  });
});

describe("parseZeptoInvoicePositional — header fields present, table absent", () => {
  it("returns header fields with empty items array (graceful degradation)", () => {
    const p = page(1, [
      word("Order", 42, 100),
      word("No.:", 70, 100),
      word("ABC12345", 95, 100),
      word("Date", 200, 100),
      word(":", 240, 100),
      word("01-01-2026", 250, 100),
      word("Invoice", 33, 200),
      word("Value", 80, 200),
      word("100.00", 537, 200),
    ]);
    const r = parseZeptoInvoicePositional([p]);
    expect(r).not.toBeNull();
    expect(r!.orderNo).toBe("ABC12345");
    expect(r!.amount).toBe(100);
    expect(r!.items).toEqual([]);
  });
});
