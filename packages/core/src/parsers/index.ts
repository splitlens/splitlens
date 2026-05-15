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
   * Positional PDF extractor (words + bounding boxes). Used by parsers that
   * need column-level disambiguation (e.g. HDFC savings — Withdrawal vs Deposit).
   */
  extractPages?: (pdf: Uint8Array, password?: string) => Promise<ExtractedPage[]>;
  /**
   * Plain text extractor returning one string per page. Used by parsers that
   * work with regex on text (e.g. HDFC credit card v1.3 + v1.6).
   */
  extractTextPages?: (pdf: Uint8Array, password?: string) => Promise<string[]>;
}

/** Stub that future parsers will conform to. */
export type Parser = (pdf: Uint8Array, opts?: ParseOptions) => Promise<ParseResult>;

export { parseHdfcSavings, parseHdfcSavingsPages } from "./hdfc-savings.js";
export { parseHdfcCc, parseHdfcCcText } from "./hdfc-cc.js";
