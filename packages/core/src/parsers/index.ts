/**
 * Bank statement PDF parsers. Each parser takes raw PDF bytes (and optional password)
 * and returns a normalized ParseResult. Parsers are pure: no I/O, no DOM, no Node-specific
 * imports — they take Uint8Array in, return ParseResult out, and may use a PDF text
 * extractor passed in via dependency injection.
 *
 * v1 parsers shipped: HDFC savings, HDFC credit card (v1.3 + v1.6 layouts).
 */
import type { ParseResult } from "../types/index.js";

export interface ParseOptions {
  password?: string;
  /** Pluggable PDF text extractor. Allows DI in tests + per-platform implementations
   *  (PDF.js for browser, pdf-parse for Node, etc.). */
  extractText?: (pdf: Uint8Array, password?: string) => Promise<string[]>;
}

/** Stub that future parsers will conform to. */
export type Parser = (pdf: Uint8Array, opts?: ParseOptions) => Promise<ParseResult>;

export { parseHdfcSavings } from "./hdfc-savings.js";
