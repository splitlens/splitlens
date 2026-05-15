/**
 * Zomato receipt emails — three observed sub-shapes from noreply@zomato.com:
 *
 *   "Your Zomato order from <restaurant>" — delivery; full items + total
 *   "Your bill payment at <restaurant>"  — Dining (pay-at-restaurant) success
 *   "Payment of ₹X at <restaurant> failed" — Dining failure, SKIP
 *
 * Plus annual "Your Zomato Gold has been renewed" emails which we'd ignore
 * here (no real txn to match — Gold renewals show on the card statement,
 * not as a UPI debit).
 */
import type { FetchedEmail } from "../types";
import type { ExtractedInfo, MerchantExtractor } from "./types";

const DELIVERY_TOTAL_RE = /Total paid\s*-\s*₹([\d,]+(?:\.\d{2})?)/i;
const DELIVERY_RESTAURANT_RE = /ordering from\s+(.+?)(?:\s+ORDER ID|!)/i;
const DELIVERY_ORDER_ID_RE = /ORDER ID:\s*(\d+)/i;
// Both delivery and dining use lines like "1 X Triple Chocolate Brownie".
const ITEM_LINE_RE = /(\d+)\s*X\s+([^₹\n]+?)(?=\n|$|1\s*X\s)/g;

const DINING_TOTAL_RE = /Total Amount Paid\s*₹([\d,]+(?:\.\d{2})?)/i;
const DINING_RESTAURANT_RE = /bill payment at\s+([^\n]+?)$/im;
const DINING_TXN_ID_RE = /Transaction ID:\s*(\d+)\s*\|\s*Code:\s*(\d+)/i;
const DINING_PAID_FAILED = /Payment failed/i;

export const zomatoExtractor: MerchantExtractor = {
  id: "zomato",
  senders: ["noreply@zomato.com"],
  // Skip the "noreply@mailers.zomato.com" promo subdomain — covered nowhere.
  extract(email: FetchedEmail): ExtractedInfo | null {
    const subject = email.subject || "";
    const body = email.text || "";

    // Failed Dining payments — explicitly ignore so they don't ever get
    // attached to a successful txn.
    if (DINING_PAID_FAILED.test(body) && !/Payment completed/i.test(body)) {
      return null;
    }

    // Delivery
    if (/Your Zomato order from/i.test(subject)) {
      const tot = DELIVERY_TOTAL_RE.exec(body);
      if (!tot) return null;
      const amount = Number(tot[1]!.replace(/,/g, ""));
      const order = DELIVERY_ORDER_ID_RE.exec(body)?.[1] ?? null;
      const restaurant =
        DELIVERY_RESTAURANT_RE.exec(subject)?.[1]?.trim() ?? null;
      const items: { qty: number; name: string }[] = [];
      ITEM_LINE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ITEM_LINE_RE.exec(body)) !== null) {
        const name = m[2]!.trim();
        if (name.length < 2 || name.length > 200) continue;
        items.push({ qty: Number(m[1]!), name });
      }
      return {
        fields: {
          kind: "zomato_delivery",
          amount,
          orderId: order,
          restaurant,
          items,
        },
        summary: `Zomato @ ${restaurant ?? "?"}: ${items.length} items · ₹${amount.toFixed(2)}`,
      };
    }

    // Dining — pay-at-restaurant
    if (/Your bill payment at/i.test(subject)) {
      const tot = DINING_TOTAL_RE.exec(body);
      if (!tot) return null;
      const amount = Number(tot[1]!.replace(/,/g, ""));
      const restaurant =
        DINING_RESTAURANT_RE.exec(subject)?.[1]?.trim() ?? null;
      const txnId = DINING_TXN_ID_RE.exec(body);
      return {
        fields: {
          kind: "zomato_dining",
          amount,
          restaurant,
          zomatoTxnId: txnId?.[1] ?? null,
          zomatoCode: txnId?.[2] ?? null,
        },
        summary: `Zomato Dining @ ${restaurant ?? "?"} · ₹${amount.toFixed(2)}`,
      };
    }

    return null;
  },
};
