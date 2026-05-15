/**
 * Swiggy Instamart receipt parser.
 *
 * Instamart's order summary (as of 2026):
 *   ┌──────────────────────────────────┐
 *   │  Instamart                       │
 *   │  Order #123456789012             │
 *   │  Delivered on DD MMM, HH:MM AM   │
 *   │                                  │
 *   │  Item Name                       │
 *   │  N x ₹NN                ₹ NN     │
 *   │  ...                             │
 *   │                                  │
 *   │  Item Total              ₹ NN    │
 *   │  Delivery Fee            ₹ NN    │
 *   │  GST & Charges           ₹ NN    │
 *   │  Total                   ₹ NN    │
 *   └──────────────────────────────────┘
 *
 * The "N x ₹unit ₹line-price" row makes per-item parsing relatively clean —
 * we pair item names with the next "N x ₹..." line.
 */
import type { ExtractedReceipt, ReceiptItem, ReceiptParser } from "./types";
import {
  containsAny,
  findAmountNearLabel,
  findFirstMatch,
  parseInr,
  splitNameAndPrice,
} from "./_util";

const TOTAL_LABELS = [
  /^Total\b(?!\s*Saved)/i,
  /^Grand\s*Total\b/i,
  /^Bill\s*Total\b/i,
  /^Order\s*Total\b/i,
];

const ITEM_END_LABELS = [
  /^Item\s*Total\b/i,
  /^Bill\s*Details\b/i,
  /^Sub[\s-]?Total\b/i,
];

export const instamartParser: ReceiptParser = {
  merchant: "instamart",
  matches(lines: string[]): boolean {
    return containsAny(lines, ["instamart", "swiggy instamart"]);
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
      merchant: "instamart",
      amount,
      orderId,
      items,
      rawLines: lines,
    };
  },
};

const QTY_PRICE = /^(\d+)\s*[x×X]\s*(?:₹|Rs\.?|INR|[7{Z])?\s*(\d+(?:\.\d{1,2})?)/i;

function extractItems(lines: string[]): ReceiptItem[] {
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

  const window = lines.slice(startIdx, endIdx).map((l) => l.trim()).filter(Boolean);

  const items: ReceiptItem[] = [];
  let i = 0;
  while (i < window.length) {
    const line = window[i]!;
    const qtyMatch = line.match(QTY_PRICE);
    if (qtyMatch) {
      const quantity = Number.parseInt(qtyMatch[1] ?? "1", 10);
      const unitPrice = parseInr(qtyMatch[2] ?? "");
      // Try to read the line-price off the tail of the same line, falling
      // back to qty × unit price.
      const { amount: trailing } = splitNameAndPrice(line);
      let amount: number | null = trailing;
      if (amount === null && unitPrice !== null) {
        amount = +(quantity * unitPrice).toFixed(2);
      }

      // Item name is the previous non-empty line (skipping any qty/price
      // tokens that snuck in).
      let name = "(unknown)";
      for (let k = i - 1; k >= 0; k--) {
        const candidate = window[k]!;
        if (QTY_PRICE.test(candidate)) continue;
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
