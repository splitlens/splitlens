/**
 * Browser-side PDF text extraction using pdfjs-dist.
 *
 * Exposes two functions matching @splitlens/core's ParseOptions hooks:
 *   - extractPagesPositional(pdf): positional words for HDFC savings parser
 *   - extractTextPages(pdf): plain text per page for HDFC CC parser
 *
 * pdfjs-dist needs a worker. We use the bundled worker module — modern bundlers
 * (Next.js webpack/turbopack) handle the URL import via `?url`.
 */
import type { ExtractedPage, PdfWord } from "@splitlens/core";

// Lazily load pdfjs-dist + configure worker on first use.
type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsCached: PdfjsModule | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (pdfjsCached) return pdfjsCached;
  const pdfjs = await import("pdfjs-dist");
  // The browser-bundled worker. `new URL(..., import.meta.url)` tells webpack/turbopack
  // to emit the worker as a separate asset; both bundlers honor this pattern.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  pdfjsCached = pdfjs;
  return pdfjs;
}

/**
 * Extract positional words from each page. Used by the HDFC savings parser
 * to disambiguate the Withdrawal vs Deposit columns.
 *
 * pdfjs returns "TextItems" — atomic text fragments at given positions. These
 * may contain multiple whitespace-separated words. We split each item on
 * whitespace and apportion the bounding box proportionally so each emitted
 * PdfWord has an approximate x range matching what pdfplumber would produce.
 */
export async function extractPagesPositional(
  pdf: Uint8Array,
  password?: string,
): Promise<ExtractedPage[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: pdf, password }).promise;

  const pages: ExtractedPage[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    // Each pdfjs TextItem corresponds to a contiguous text fragment as drawn
    // by the PDF. HDFC emits each "word" as a separate item (with whitespace-
    // only items between them as kerning), so we treat each non-empty item as
    // one PdfWord, preserving any internal spaces. This matches what the
    // positional parser expects (header text like "Value Dt" with the space).
    const words: PdfWord[] = [];
    for (const item of textContent.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const text = item.str.trim();
      if (text === "") continue;
      const x0 = item.transform[4];
      const yPdf = item.transform[5];
      const top = viewport.height - yPdf - item.height;
      words.push({
        text,
        x0,
        x1: x0 + item.width,
        top,
        bottom: top + item.height,
      });
    }

    pages.push({
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
      words,
    });
  }

  // Dev-mode diagnostic: log a sample of page-1 words so we can debug coordinate
  // mismatches in the browser. Toggleable via window.SPLITLENS_DEBUG_PDF=true.
  if (
    typeof window !== "undefined" &&
    (window as unknown as { SPLITLENS_DEBUG_PDF?: boolean }).SPLITLENS_DEBUG_PDF
  ) {
    const p1 = pages[0];
    if (p1) {
      console.log("[SplitLens] Page 1 dimensions:", { width: p1.width, height: p1.height });
      console.log("[SplitLens] First 50 words from page 1:");
      console.table(p1.words.slice(0, 50));
      // Header detection check
      const headerKeys = [
        "Date",
        "Narration",
        "Chq./Ref.No.",
        "ValueDt",
        "WithdrawalAmt.",
        "DepositAmt.",
        "ClosingBalance",
      ];
      for (const k of headerKeys) {
        const found = p1.words.find((w) => w.text === k);
        console.log(`[SplitLens] Header word '${k}':`, found ?? "(missing)");
      }
    }
  }

  return pages;
}

/**
 * Extract plain text per page. Used by the HDFC CC parser.
 * Lines are reconstructed by clustering text items by y-coordinate.
 */
export async function extractTextPages(pdf: Uint8Array, password?: string): Promise<string[]> {
  const positional = await extractPagesPositional(pdf, password);
  return positional.map((page) => {
    // Group words by approximate y, sort each group left-to-right, join lines.
    const sorted = [...page.words].sort((a, b) => {
      const yDiff = Math.round(a.top * 10) - Math.round(b.top * 10);
      if (yDiff !== 0) return yDiff;
      return a.x0 - b.x0;
    });
    if (sorted.length === 0) return "";
    const lines: PdfWord[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
      const w = sorted[i]!;
      const last = lines[lines.length - 1]!;
      if (Math.abs(w.top - last[0]!.top) <= 2) {
        last.push(w);
      } else {
        lines.push([w]);
      }
    }
    return lines
      .map((line) =>
        line
          .sort((a, b) => a.x0 - b.x0)
          .map((w) => w.text)
          .join(" "),
      )
      .join("\n");
  });
}
