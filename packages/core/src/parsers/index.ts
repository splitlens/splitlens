/**
 * Bank statement PDF parsers. Each parser takes raw PDF bytes (and optional password)
 * and returns a normalized ParseResult. Parsers are pure: no I/O, no DOM, no Node-specific
 * imports — they take Uint8Array in, return ParseResult out, and may use a PDF text
 * extractor passed in via dependency injection.
 *
 * v1 parsers shipped: HDFC savings, HDFC credit card (v1.3 + v1.6 layouts).
 */
import type { ExtractedPage, ParseResult } from "../types/index.js";

export interface ParseOptions {
  password?: string;
  /**
   * Pluggable positional PDF extractor. Returns pages with words + bounding boxes.
   * Implementations:
   *   - browser: pdfjs-dist getTextContent (returns positional items)
   *   - node test: pdfplumber-equivalent or hand-crafted fixtures
   *   - mobile (Phase 2): native PDFKit on iOS, PdfRenderer on Android
   */
  extractPages?: (pdf: Uint8Array, password?: string) => Promise<ExtractedPage[]>;
}

/** Stub that future parsers will conform to. */
export type Parser = (pdf: Uint8Array, opts?: ParseOptions) => Promise<ParseResult>;

export { parseHdfcSavings, parseHdfcSavingsPages } from "./hdfc-savings.js";
