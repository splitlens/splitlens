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

    const words: PdfWord[] = [];
    for (const item of textContent.items) {
      // PDF.js TextItem has `str`, `transform` (matrix), `width`, `height`
      if (!("str" in item) || !item.str) continue;
      if (typeof item.str !== "string" || item.str.trim() === "") continue;

      // Transform[5] is the y-coordinate in PDF space (origin bottom-left).
      // Convert to top-down origin to match pdfplumber convention.
      const x0 = item.transform[4];
      const yPdf = item.transform[5]; // PDF y from bottom
      const top = viewport.height - yPdf - item.height;
      words.push({
        text: item.str,
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
