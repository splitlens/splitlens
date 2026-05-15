/**
 * Swiggy order-delivered email. Sender `noreply@swiggy.in` covers both:
 *
 *   "Your Swiggy <segment> order was delivered" — restaurant food, has the
 *       full ORDER JOURNEY block + bill line items + "Paid Via Bank ₹X.XX"
 *   "Your Instamart order was successfully delivered" — quick commerce,
 *       cleaner format with explicit "Grand Total ₹X.XX"
 *
 * We treat them as one extractor that yields slightly different `fields`
 * depending on which sub-format matches.
 */
import type { FetchedEmail } from "../types";
import type { ExtractedInfo, MerchantExtractor } from "./types";

// "Paid Via Bank ₹403.00" / "Paid Via Wallet ₹120.00" / etc.
const SWIGGY_FOOD_TOTAL_RE = /Paid Via [A-Za-z ]+₹([\d,]+(?:\.\d{2})?)/;
// Instamart's bill block: "Grand Total ₹333.00"
const SWIGGY_INSTAMART_TOTAL_RE = /Grand Total\s+₹([\d,]+(?:\.\d{2})?)/i;
const ORDER_ID_RE = /Order\s*[Ii][Dd]\s*:?\s*(\d{8,})/;
// Items line, both formats: "1 x Tender Coconut (Elaneer) ₹65.00"
const ITEM_LINE_RE = /(\d+)\s*[xX]\s+([^₹\n]+?)\s+₹([\d,]+(?:\.\d{2})?)/g;
// Restaurant block (food only): "ORDER JOURNEY <name> <addr> Apr 12, 11:54 PM"
const RESTAURANT_RE = /ORDER JOURNEY\s+(.+?)\s+(?:[A-Z][a-z]{2}\s+\d{1,2},)/s;

export const swiggyExtractor: MerchantExtractor = {
  id: "swiggy",
  senders: ["noreply@swiggy.in", "no-reply@swiggy.in"],
  subjectIncludes: "delivered",
  extract(email: FetchedEmail): ExtractedInfo | null {
    const body = email.text || "";
    if (!/delivered/i.test(body) && !/delivered/i.test(email.subject)) return null;

    const isInstamart = /Instamart/i.test(email.subject);
    const totalMatch = isInstamart
      ? SWIGGY_INSTAMART_TOTAL_RE.exec(body)
      : SWIGGY_FOOD_TOTAL_RE.exec(body);
    if (!totalMatch) return null;
    const amount = Number(totalMatch[1]!.replace(/,/g, ""));

    const orderIdMatch = ORDER_ID_RE.exec(body);
    const orderId = orderIdMatch?.[1] ?? null;

    const items: { qty: number; name: string; price: number }[] = [];
    // .matchAll doesn't have a captureGroups bug — fine. Reset RE state.
    ITEM_LINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ITEM_LINE_RE.exec(body)) !== null) {
      items.push({
        qty: Number(m[1]!),
        name: m[2]!.trim(),
        price: Number(m[3]!.replace(/,/g, "")),
      });
    }

    let restaurant: string | null = null;
    const rm = RESTAURANT_RE.exec(body);
    if (rm) restaurant = rm[1]!.trim();

    const summary = isInstamart
      ? `Instamart: ${items.length} items · ₹${amount.toFixed(2)}` +
        (orderId ? ` (order ${orderId})` : "")
      : `Swiggy${restaurant ? ` @ ${restaurant.split(",")[0]}` : ""}: ` +
        `${items.length} items · ₹${amount.toFixed(2)}` +
        (orderId ? ` (order ${orderId})` : "");

    return {
      fields: {
        kind: isInstamart ? "instamart" : "food_delivery",
        amount,
        orderId,
        restaurant,
        items,
      },
      summary,
    };
  },
};
