/**
 * Blinkit receipt parser.
 *
 * Blinkit's order summary (formerly Grofers, as of 2026):
 *   ┌──────────────────────────────────┐
 *   │  blinkit                         │
 *   │  Order ID: 1234567890            │
 *   │  Delivered                       │
 *   │                                  │
 *   │  Item Name (Pack size)           │
 *   │  Qty: N    ₹ NN                  │
 *   │  ...                             │
 *   │                                  │
 *   │  MRP                     ₹ NN    │
 *   │  Product discount        -₹ NN   │
 *   │  Item Total              ₹ NN    │
 *   │  Delivery charge         ₹ NN    │
 *   │  Handling charge         ₹ NN    │
 *   │  Bill Total              ₹ NN    │
 *   └──────────────────────────────────┘
 *
 * Blinkit's main quirk: item name and "Qty: N  ₹ price" sit on separate
 * lines, so we pair lines [i] (name) with [i+1] (qty/price).
 */
import type { ExtractedReceipt, ReceiptItem, ReceiptParser } from "./types";
import {
  containsAny,
  findAmountNearLabel,
  findFirstMatch,
  parseInr,
} from "./_util";

const TOTAL_LABELS = [
  /^Bill\s*Total\b/i,
  /^Grand\s*Total\b/i,
  /^Order\s*Total\b/i,
  /^Total\s*Paid\b/i,
];

const ITEM_END_LABELS = [
  /^MRP\b/i,
  /^Item\s*Total\b/i,
  /^Bill\s*Details\b/i,
  /^Sub[\s-]?Total\b/i,
];

export const blinkitParser: ReceiptParser = {
  merchant: "blinkit",
  matches(lines: string[]): boolean {
    return containsAny(lines, ["blinkit", "grofers"]);
  },
  extract(lines: string[]): ExtractedReceipt | null {
    const amount = findAmountNearLabel(lines, TOTAL_LABELS);
    if (amount === null) return null;

    const orderId = findFirstMatch(lines, [
      /Order\s*ID[:\s]+([A-Z0-9-]{6,})/i,
      /Order\s*#\s*([A-Z0-9-]{6,})/i,
    ]);

    const items = extractItems(lines);

    return {
      merchant: "blinkit",
      amount,
      orderId,
      items,
      rawLines: lines,
    };
  },
};

function extractItems(lines: string[]): ReceiptItem[] {
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^delivered/i.test(lines[i]!) || /^order\s*id/i.test(lines[i]!)) {
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

  const window = lines.slice(startIdx, endIdx).map((l) => l.trim()).filter(Boolean);

  const items: ReceiptItem[] = [];
  let i = 0;
  while (i < window.length) {
    const line = window[i]!;

    // Look for a "Qty: N ₹ NN" line. If found, the previous non-Qty line is
    // the item name.
    const qtyLine = line.match(/^Qty[:\s]+(\d+)\s*(?:₹|Rs\.?|INR|[7{Z])?\s*(\d+(?:\.\d{1,2})?)?/i);
    if (qtyLine) {
      const quantity = Number.parseInt(qtyLine[1] ?? "1", 10);
      let amount = qtyLine[2] ? parseInr(qtyLine[2]) : null;
      // If price wasn't on the same line, it's likely the next line.
      if (amount === null && i + 1 < window.length) {
        const next = window[i + 1]!;
        const p = parseInr(next);
        if (p !== null && p >= 1) {
          amount = p;
          i++;
        }
      }

      // Walk back for the most recent non-empty, non-Qty line as the name.
      let name = "(unknown)";
      for (let k = items.length === 0 ? 0 : i - 1; k >= 0; k--) {
        const candidate = window[k]!;
        if (/^Qty[:\s]/i.test(candidate)) continue;
        if (parseInr(candidate) !== null && candidate.length < 10) continue;
        name = candidate;
        break;
      }

      items.push({ name, quantity, amount });
      i++;
      continue;
    }

    i++;
  }

  return items;
}
