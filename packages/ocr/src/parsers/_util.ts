/**
 * Shared utilities for screenshot receipt parsers.
 *
 * These deal with the recurring OCR-noise issues we see on real receipts:
 *   - The ₹ glyph reads as "7", "{", "Z", or just gets dropped entirely
 *     depending on font weight and size.
 *   - Prices and item names land in separate Vision blocks (because they're
 *     left- and right-aligned in the screenshot).
 *   - "Qty" multipliers ("x2", "× 2") show up before or after the item name.
 *   - Indian number formatting uses lakhs separators ("1,23,456.78").
 */

/** Strip Vision's rupee-glyph misreads and locale separators from a number candidate. */
export function parseInr(s: string): number | null {
  if (!s) return null;
  // We accept an optional currency/glyph prefix from a whitelist of things
  // Vision actually emits, then digits with optional locale separators and
  // an optional decimal. Anything else fails — we don't want "x2" or
  // "Tata Salt 1kg" to parse as a number.
  const m = s
    .trim()
    .match(/^(?:₹|Rs\.?|INR|[7{ZZ])?\s*(-?\d{1,3}(?:[,]\d{2,3})*(?:\.\d{1,2})?)\s*$/);
  if (!m) return null;
  const stripped = (m[1] ?? "").replace(/,/g, "");
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

/**
 * Find a price-like token at the end of a string. Returns both the price and
 * the cleaned-up "name" half. Handles all the rupee-glyph misreads we've seen
 * from Vision so far.
 */
export function splitNameAndPrice(
  line: string,
): { name: string; amount: number | null } {
  // Match the trailing money token. We accept an optional rupee-glyph
  // (or its misread chars 7 / { / Z / ₹ / Rs / INR) followed by digits and an
  // optional decimal.
  const m = line.match(/^(.*?)[\s]*(?:₹|Rs\.?|INR|[7{Z])?\s*(-?\d{1,3}(?:[,]\d{2,3})*(?:\.\d{1,2})?)\s*$/);
  if (!m) return { name: line.trim(), amount: null };

  const namePart = (m[1] ?? "").trim();
  const amountStr = m[2] ?? "";
  const amount = parseInr(amountStr);
  // Sanity: if the "amount" is just a tiny integer like "1" or "2" and the
  // name still has content, it's almost certainly a quantity, not a price.
  if (amount !== null && amount < 5 && namePart.length > 0 && !/\./.test(amountStr)) {
    return { name: line.trim(), amount: null };
  }
  return { name: namePart, amount };
}

/** Extract a quantity multiplier from an item line. Strips it from the name. */
export function extractQuantity(name: string): { name: string; quantity: number } {
  // Patterns: "x2", "X 2", "× 2", "(2)", or a leading "2 x ". Conservative —
  // we don't want to eat numbers that are part of the product name (e.g. "Amul
  // Milk 500ml" must keep the 500ml).
  const trailing = name.match(/\s+[x×X]\s*(\d+)\s*$/);
  if (trailing) {
    return {
      name: name.slice(0, trailing.index!).trim(),
      quantity: Number.parseInt(trailing[1] ?? "1", 10),
    };
  }
  const leading = name.match(/^\(?(\d+)\)?\s*[x×X]\s+(.*)$/);
  if (leading) {
    return {
      name: (leading[2] ?? "").trim(),
      quantity: Number.parseInt(leading[1] ?? "1", 10),
    };
  }
  return { name, quantity: 1 };
}

/** Case-insensitive contains-any. Used by merchant detectors. */
export function containsAny(lines: string[], needles: string[]): boolean {
  const joined = lines.join("\n").toLowerCase();
  return needles.some((n) => joined.includes(n.toLowerCase()));
}

/**
 * Find a numeric value adjacent to a label, e.g. "Grand Total ₹ 154.00".
 * Returns the first match.
 *
 * Three matching shapes — in order of preference:
 *   1. Same line:    "Grand Total 154.00"
 *   2. Next line:    "Grand Total" \n "154.00"   (Vision often splits these)
 *   3. Column-paired: the labels appear in one column followed by a block of
 *      prices in another column. We find the label's position among all
 *      label-bearing lines and grab the price at the same position in the
 *      bare-number block. This is how Vision lays out wide right-aligned
 *      receipt summaries.
 */
export function findAmountNearLabel(
  lines: string[],
  labels: RegExp[],
): number | null {
  // 1 + 2: same-line / next-line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!labels.some((re) => re.test(line))) continue;

    const { amount } = splitNameAndPrice(line);
    if (amount !== null && amount > 0) return amount;

    for (let j = 1; j <= 2 && i + j < lines.length; j++) {
      const candidate = lines[i + j]!.trim();
      const n = parseInr(candidate);
      if (n !== null && n > 0) return n;
    }
  }

  // 3: column-paired fallback. Vision often emits a wide right-aligned
  // receipt as two columns — labels on the left, prices on the right — and
  // the prices read AFTER all the labels. We pair them by ordinal:
  //   labels:  ..., Item Total, Delivery Charge, Grand Total, ...
  //   prices:  ..., 139,        15,              154,         ...
  // The Nth summary-block label maps to the Nth price in the first
  // contiguous numeric run after the labels.
  //
  // We find both the label positions and a sibling "summary label" list
  // (Item Total, Sub Total, Delivery, Handling, etc.) so we know how many
  // summary rows exist; then we count that many numbers in a numeric tail
  // and pick by ordinal.
  const summaryLabels: RegExp[] = [
    ...labels,
    /^Item\s*Total\b/i,
    /^Sub[\s-]?Total\b/i,
    /^Delivery/i,
    /^Handling/i,
    /^GST\b/i,
    /^MRP\b/i,
    /^Product\s*discount/i,
  ];

  // Ordered list of summary-row labels we actually see in this receipt.
  const summaryLabelHits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (summaryLabels.some((re) => re.test(lines[i]!))) {
      summaryLabelHits.push(i);
    }
  }
  if (summaryLabelHits.length === 0) return null;

  // Which ordinal is the grand-total label among the summary hits?
  const grandTotalOrdinal = summaryLabelHits.findIndex((idx) =>
    labels.some((re) => re.test(lines[idx]!)),
  );
  if (grandTotalOrdinal < 0) return null;

  // Collect every bare numeric line in the document, in order. The first
  // `summaryLabelHits.length` of them are (heuristically) the summary
  // column prices.
  const numericLines: number[] = [];
  for (const l of lines) {
    const stripped = l.trim();
    // Heuristic: a "bare price" line is short, parses as a number, and
    // doesn't contain alphabetic characters.
    if (/[a-z]/i.test(stripped)) continue;
    const n = parseInr(stripped);
    if (n !== null && n > 0) numericLines.push(n);
  }

  if (numericLines.length > grandTotalOrdinal) {
    return numericLines[grandTotalOrdinal] ?? null;
  }
  return null;
}

/** Pull the first match of one of these regexes out of the OCR lines. */
export function findFirstMatch(lines: string[], patterns: RegExp[]): string | null {
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m) return m[1] ?? m[0];
    }
  }
  return null;
}
