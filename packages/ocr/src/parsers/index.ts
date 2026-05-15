/**
 * Receipt parsers — one per merchant. Each exposes `matches(lines)` so the
 * daemon can pick the right parser by content (not filename) and an
 * `extract(lines)` that returns a normalized ExtractedReceipt.
 */
import type { ExtractedReceipt, ReceiptParser } from "./types";

import { blinkitParser } from "./blinkit";
import { instamartParser } from "./instamart";
import { zeptoParser } from "./zepto";

export type { ExtractedReceipt, Merchant, ReceiptItem, ReceiptParser } from "./types";
export { blinkitParser } from "./blinkit";
export { instamartParser } from "./instamart";
export { zeptoParser } from "./zepto";

export const ALL_PARSERS: ReceiptParser[] = [zeptoParser, blinkitParser, instamartParser];

/**
 * Try each parser in order; first one whose `matches()` returns true gets
 * to extract. Returns null if no parser recognizes the screenshot.
 */
export function parseReceipt(lines: string[]): ExtractedReceipt | null {
  for (const parser of ALL_PARSERS) {
    if (parser.matches(lines)) {
      const result = parser.extract(lines);
      if (result !== null) return result;
    }
  }
  return null;
}
