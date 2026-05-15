/**
 * Zepto receipt parser.
 *
 * Zepto's in-app order receipt has a fairly stable layout (as of 2026):
 *   ┌──────────────────────────────────┐
 *   │  Zepto                           │
 *   │  Order #ZP1234567890             │
 *   │  Delivered in N minutes          │
 *   │                                  │
 *   │  Item Name        x N    ₹ NN.NN │
 *   │  ...                             │
 *   │                                  │
 *   │  Item Total              ₹ NN.NN │
 *   │  Delivery Charge         ₹ NN.NN │
 *   │  Handling Fee            ₹ NN.NN │
 *   │  Grand Total             ₹ NN.NN │
 *   │  Paid via UPI                    │
 *   └──────────────────────────────────┘
 *
 * Item rows split into separate Vision blocks because they're left/right
 * aligned. We use the order of OCR lines (top→bottom, left→right) to stitch
 * them back together.
 */

import type { ExtractedReceipt, ReceiptItem, ReceiptParser } from "./types";
import {
  containsAny,
  extractQuantity,
  findAmountNearLabel,
  findFirstMatch,
  parseInr,
} from "./_util";

const TOTAL_LABELS = [/^Grand\s*Total\b/i, /^Total\s*Amount\b/i, /^Total\s*Paid\b/i];

const ITEM_END_LABELS = [
  /^Item\s*Total\b/i,
  /^Sub[\s-]?Total\b/i,
  /^Cart\s*Total\b/i,
  /^Bill\s*Details\b/i,
];

const NON_ITEM_LINES = [
  /^delivered/i,
  /^delivery/i,
  /^handling/i,
  /^paid/i,
  /^order\s*#/i,
  /^zepto\b/i,
];

export const zeptoParser: ReceiptParser = {
  merchant: "zepto",
  matches(lines: string[]): boolean {
    return containsAny(lines, ["zepto"]);
  },
  extract(lines: string[]): ExtractedReceipt | null {
    const amount = findAmountNearLabel(lines, TOTAL_LABELS);
    if (amount === null) return null;

    const orderId = findFirstMatch(lines, [
      /Order\s*#\s*([A-Z0-9-]{6,})/i,
      /Order\s*ID[:\s]+([A-Z0-9-]{6,})/i,
    ]);

    const items = extractItems(lines);

    return {
      merchant: "zepto",
      amount,
      orderId,
      items,
      rawLines: lines,
    };
  },
};

function extractItems(lines: string[]): ReceiptItem[] {
  // Find the window of lines between the header and the "Item Total" / bill
  // summary section. Items live in there.
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^delivered/i.test(lines[i]!) || /^order\s*#/i.test(lines[i]!)) {
      startIdx = i + 1;
    }
  }

  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (ITEM_END_LABELS.some((re) => re.test(lines[i]!))) {
      endIdx = i;
      break;
    }
  }

  // The window has a mix of: item names, "xN" quantity tokens, and prices.
  // Vision typically emits them in reading order (left→right, then top→bottom),
  // so a "name, then qty, then price" triplet is the common shape.
  const window = lines.slice(startIdx, endIdx).filter((l) => {
    const trimmed = l.trim();
    if (!trimmed) return false;
    if (NON_ITEM_LINES.some((re) => re.test(trimmed))) return false;
    return true;
  });

  const items: ReceiptItem[] = [];
  let i = 0;
  while (i < window.length) {
    const line = window[i]!;

    // Skip lone quantity tokens — they belong to the previous item.
    if (/^x\s*\d+$/i.test(line.trim())) {
      i++;
      continue;
    }
    // Skip lone price tokens at the start of the window (no item to attach to).
    const standalonePrice = parseInr(line);
    if (standalonePrice !== null && /^[^a-z]+$/i.test(line.replace(/[a-z]/gi, ""))) {
      // If this is a bare price and the previous item is missing one, attach it.
      if (items.length > 0 && items[items.length - 1]!.amount === null) {
        items[items.length - 1]!.amount = standalonePrice;
      }
      i++;
      continue;
    }

    // It's an item name. Look ahead 1–2 lines for the quantity and price.
    let { name, quantity } = extractQuantity(line);
    let amount: number | null = null;

    for (let look = 1; look <= 2 && i + look < window.length; look++) {
      const next = window[i + look]!.trim();
      const qtyMatch = next.match(/^x\s*(\d+)$/i);
      if (qtyMatch) {
        quantity = Number.parseInt(qtyMatch[1] ?? "1", 10);
        continue;
      }
      const priceCandidate = parseInr(next);
      if (priceCandidate !== null && priceCandidate >= 5) {
        amount = priceCandidate;
        break;
      }
    }

    items.push({ name: name.trim(), quantity, amount });
    // Advance past name + (qty?) + (price?).
    i += 1;
    while (
      i < window.length &&
      (/^x\s*\d+$/i.test(window[i]!.trim()) ||
        parseInr(window[i]!) !== null)
    ) {
      i++;
    }
  }

  return items;
}
