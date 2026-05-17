/**
 * Common types for screenshot receipt parsers.
 *
 * Each parser takes the OCR lines (in reading order) and returns a normalized
 * ExtractedReceipt — or null if it can't recognize the screenshot.
 */

export type Merchant = "zepto" | "blinkit" | "instamart";

export interface ReceiptItem {
  name: string;
  /** Unit count if visible on the receipt, else 1. */
  quantity: number;
  /**
   * Line price in INR (the printed price, typically quantity × unit price).
   * `null` when OCR was confident enough to find the item name but not the price.
   */
  amount: number | null;
}

export interface ExtractedReceipt {
  merchant: Merchant;
  /** Total in INR — what hit the user's card / UPI. */
  amount: number;
  /** Order ID if printed on screen; otherwise null. */
  orderId: string | null;
  items: ReceiptItem[];
  /**
   * Raw OCR lines that produced this — kept so the daemon can persist them
   * with the source row for debugging.
   */
  rawLines: string[];
}

/**
 * Detector lives alongside parsers so the daemon can classify a screenshot
 * by content rather than filename.
 */
export interface ReceiptParser {
  merchant: Merchant;
  /** Returns true if this parser recognizes the OCR output. */
  matches(lines: string[]): boolean;
  /** Extracts a receipt; returns null if matches() said true but parsing fails. */
  extract(lines: string[]): ExtractedReceipt | null;
}
