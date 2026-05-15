/**
 * CRED bill payment receipts.
 *
 * No actual bill-payment receipts were observed on this account during onboarding
 * (the user's CRED senders only sent CC perks updates + due-date reminders);
 * this extractor is written to the documented Cred receipt format and will
 * trigger when receipts do appear. Two body shapes per Cred's public copy:
 *
 *   Shape A — "Your credit card bill payment was successful":
 *     bill paid successfully
 *     amount paid ₹12,345.67
 *     paid towards HDFC Bank credit card XX1234
 *     on 08 May 2026
 *     transaction id CRED1A2B3C4D5E
 *
 *   Shape B — Bharat Connect rail (utility / loan EMI):
 *     payment successful
 *     ₹2,345.00 paid to <biller>
 *     reference id BBPSXXXXXXXXXXXX
 *
 * Cred also fires bill-due REMINDERS from the same address. We reject those
 * with a "successful|paid|completed" body filter so reminders never get
 * attached to a real debit by mistake.
 *
 * Senders observed: protect@cred.club, from@cred.club, talk@cred.club.
 */
import type { FetchedEmail } from "../types";
import type { ExtractedInfo, MerchantExtractor } from "./types";

// "₹12,345.67" or "₹ 12345" — Cred sometimes spaces the symbol.
const AMOUNT_RE = /₹\s*([\d,]+(?:\.\d{2})?)/;
// Shape A — explicit "paid towards <Bank> credit card XX1234"
const CARD_RE =
  /paid\s+towards\s+([A-Z][A-Za-z &.]+?)\s+credit\s+card(?:\s+ending)?\s+(?:XX|x{2,})?(\d{4})/i;
// Shape A — "transaction id CRED..." or "txn id CRED..."
const CRED_TXN_RE = /(?:transaction|txn)\s+id\s*:?\s*(CRED[A-Z0-9]+)/i;
// Shape B — Bharat Connect reference id
const BBPS_RE = /(?:reference|ref)\s+id\s*:?\s*(BBPS[A-Z0-9]+)/i;
// Shape B — biller name: "paid to <biller>" up to terminator (period, newline,
// or one of the trailing-section keywords Cred emits after the biller name).
const BILLER_RE =
  /paid\s+(?:to|towards)\s+([A-Z][A-Za-z0-9 &.()-]{2,60}?)\s*(?:\.|\n|$|reference\b|ref\b|transaction\b|txn\b|on\s+\d)/i;
// "on 08 May 2026" — DD Mon YYYY (Cred's preferred date format).
const PAID_DATE_RE =
  /on\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i;

// Reject reminders, marketing, and other non-receipt mail.
const RECEIPT_INDICATORS = /(payment\s+successful|bill\s+paid\s+successfully|payment\s+completed|paid\s+successfully)/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export const credExtractor: MerchantExtractor = {
  id: "cred",
  senders: ["protect@cred.club", "from@cred.club", "talk@cred.club"],
  // No subject filter — Cred's receipt subjects vary ("Your credit card bill
  // payment was successful", "Payment of ₹X to <biller> successful", etc.).
  // We rely on the body indicator instead.
  extract(email: FetchedEmail): ExtractedInfo | null {
    const body = email.text || "";
    const subject = email.subject || "";

    // Only treat as a receipt if the body actually says payment succeeded.
    // Reminders ("your credit card bill is due on…") fail this check and
    // return null so they don't get attached to a real debit txn.
    const isReceiptBody = RECEIPT_INDICATORS.test(body);
    const isReceiptSubject =
      /payment.*successful/i.test(subject) || /bill\s+paid/i.test(subject);
    if (!isReceiptBody && !isReceiptSubject) return null;

    const amountMatch = AMOUNT_RE.exec(body);
    if (!amountMatch) return null;
    const amount = Number(amountMatch[1]!.replace(/,/g, ""));

    // Shape A signals
    const cardMatch = CARD_RE.exec(body);
    const credTxnId = CRED_TXN_RE.exec(body)?.[1] ?? null;
    // Shape B signals
    const bbpsId = BBPS_RE.exec(body)?.[1] ?? null;

    let kind: "cred_cc_payment" | "cred_bbps" | "cred_payment";
    let biller: string | null = null;
    let cardBank: string | null = null;
    let cardLast4: string | null = null;

    if (cardMatch) {
      kind = "cred_cc_payment";
      cardBank = cardMatch[1]!.trim();
      cardLast4 = cardMatch[2]!;
    } else if (bbpsId) {
      kind = "cred_bbps";
      const billerMatch = BILLER_RE.exec(body);
      biller = billerMatch?.[1]?.trim() ?? null;
    } else {
      kind = "cred_payment";
      const billerMatch = BILLER_RE.exec(body);
      biller = billerMatch?.[1]?.trim() ?? null;
    }

    let paidDate: string | null = null;
    const dm = PAID_DATE_RE.exec(body);
    if (dm) {
      const day = Number(dm[1]);
      const mon = MONTHS[dm[2]!.toLowerCase()];
      const year = Number(dm[3]);
      if (mon && day && year) {
        paidDate = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }

    let summary: string;
    if (kind === "cred_cc_payment") {
      summary = `CRED: ₹${amount.toFixed(2)} → ${cardBank ?? "card"} XX${cardLast4 ?? "?"}`;
    } else {
      summary = `CRED: ₹${amount.toFixed(2)}${biller ? ` → ${biller}` : ""}`;
    }
    if (credTxnId) summary += ` (${credTxnId})`;
    else if (bbpsId) summary += ` (${bbpsId})`;

    return {
      fields: {
        kind,
        amount,
        cardBank,
        cardLast4,
        biller,
        credTxnId,
        bbpsRefId: bbpsId,
        paidDate,
      },
      summary,
    };
  },
};
