/**
 * Apple receipt emails — App Store / iTunes Store / iCloud+ / Apple Music etc.
 *
 * No receipts observed; extractor written to spec. The user's Apple ID
 * receipts are likely landing in a different account. Apple's published
 * receipt format has been stable for years:
 *
 *   APPLE ID  prateek@icloud.com
 *   DATE      May 8, 2026
 *   ORDER ID  MLABCDEFGH
 *   DOCUMENT NO. 123456789012
 *
 *   <App or Subscription Name>
 *   <Developer or Publisher>
 *   Renewal / Yearly / Monthly etc.
 *   Report a Problem
 *   ₹999.00          (or $0.99, etc. — currency varies)
 *
 *   Subtotal       ₹999.00
 *   Tax            ₹179.82
 *   TOTAL          ₹1,178.82
 *
 * Sender: `no_reply@email.apple.com` (with optional `appstore@email.apple.com`
 * for some subscription-only renewals). We allowlist both. Subject typically
 * "Your receipt from Apple" or "Your Apple invoice".
 */
import type { FetchedEmail } from "../types";
import type { ExtractedInfo, MerchantExtractor } from "./types";

// No receipts observed; extractor written to spec.
const TOTAL_RE =
  /TOTAL\s+([₹$€£¥]|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/i;
const SUBTOTAL_RE =
  /Subtotal\s+([₹$€£¥]|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/i;
const TAX_RE =
  /Tax\s+([₹$€£¥]|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/i;
const ORDER_ID_RE = /ORDER\s+ID\s*[:\s]+([A-Z0-9]{8,})/i;
const DOC_NO_RE = /DOCUMENT\s+NO\.?\s*[:\s]+(\d{6,})/i;
const APPLE_ID_RE = /APPLE\s+ID\s*[:\s]+([\w.+-]+@[\w.-]+)/i;
// "DATE May 8, 2026" or "BILLED ON May 8, 2026"
const DATE_RE =
  /(?:DATE|BILLED\s+ON)\s*[:\s]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i;
// Per-line item: "<name> <developer> <type> Report a Problem ₹999.00"
// Type is one of: Yearly, Monthly, Weekly, Renewal, In-App Purchase, App.
const ITEM_RE =
  /([\w][\w &'.\-:!,()]{1,80}?)\s+([\w][\w &'.\-:]{1,60}?)\s+(Yearly|Monthly|Weekly|Renewal|In-App Purchase|App|iCloud\+)\s+Report a Problem\s+([₹$€£¥]|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/gi;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export const appleExtractor: MerchantExtractor = {
  id: "apple",
  senders: ["no_reply@email.apple.com", "appstore@email.apple.com"],
  // Apple receipts use both subjects; substring match catches either.
  subjectIncludes: "receipt",
  extract(email: FetchedEmail): ExtractedInfo | null {
    const body = email.text || "";
    const totalMatch = TOTAL_RE.exec(body);
    if (!totalMatch) return null;

    const currency = totalMatch[1]!.replace(/Rs\.?/i, "₹").trim();
    const amount = Number(totalMatch[2]!.replace(/,/g, ""));

    const subtotalMatch = SUBTOTAL_RE.exec(body);
    const subtotal = subtotalMatch
      ? Number(subtotalMatch[2]!.replace(/,/g, ""))
      : null;
    const taxMatch = TAX_RE.exec(body);
    const tax = taxMatch ? Number(taxMatch[2]!.replace(/,/g, "")) : null;

    const orderId = ORDER_ID_RE.exec(body)?.[1] ?? null;
    const documentNo = DOC_NO_RE.exec(body)?.[1] ?? null;
    const appleId = APPLE_ID_RE.exec(body)?.[1] ?? null;

    let receiptDate: string | null = null;
    const dm = DATE_RE.exec(body);
    if (dm) {
      const mon = MONTHS[dm[1]!.toLowerCase()];
      const day = Number(dm[2]);
      const year = Number(dm[3]);
      if (mon && day && year) {
        receiptDate = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }

    const items: { name: string; publisher: string; type: string; price: number }[] = [];
    ITEM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ITEM_RE.exec(body)) !== null) {
      items.push({
        name: m[1]!.trim(),
        publisher: m[2]!.trim(),
        type: m[3]!.trim(),
        price: Number(m[5]!.replace(/,/g, "")),
      });
    }

    const summary =
      `Apple: ${currency}${amount.toFixed(2)}` +
      (items.length === 1
        ? ` · ${items[0]!.name}`
        : items.length > 1
          ? ` · ${items.length} items`
          : "") +
      (orderId ? ` (${orderId})` : "");

    return {
      fields: {
        kind: "apple_receipt",
        amount,
        currency,
        subtotal,
        tax,
        orderId,
        documentNo,
        appleId,
        receiptDate,
        items,
      },
      summary,
    };
  },
};
