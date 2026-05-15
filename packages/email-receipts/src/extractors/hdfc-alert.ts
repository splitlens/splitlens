/**
 * HDFC InstaAlerts UPI debit alert.
 *
 * Two body shapes have shipped over the years. They differ in three separate
 * places (verb, counterparty wrapping, reference-number phrase), so we keep
 * them as two explicit regexes rather than one mega-pattern:
 *
 *   Format A (newer, 2026+):
 *     Rs.345.00 is debited from your account ending 2491 towards VPA
 *     zeptomarketplac744706.rzp@rxaxis (ZEPTO MARKETPLACE PRIVATE LIMITED)
 *     on 14-05-26. UPI transaction reference no.: 613414367509.
 *
 *   Format B (older bulk, 2024-2025):
 *     Rs.180.00 has been debited from account 2491 to VPA
 *     BHARATPE90727380920@yesbankltd KUSHAL
 *     on 29-01-26. Your UPI transaction reference number is 278812942209.
 *
 * The email's Date: header is the moment the alert fired (HDFC pushes them
 * within seconds), doubling as wall-clock time for the underlying txn.
 */
import type { FetchedEmail } from "../types";
import type { ExtractedInfo, MerchantExtractor } from "./types";

// Format A: parens around counterparty, "UPI transaction reference no.:"
const FORMAT_A =
  /Rs\.([\d,]+\.\d{2})\s+is\s+debited\s+from\s+your\s+account\s+ending\s+\**(\d{4})\s+towards\s+VPA\s+(\S+)\s+\((.+?)\)\s+on\s+(\d{2}-\d{2}-\d{2})\.\s+UPI\s+transaction\s+reference\s+no\.\s*:?\s*(\d{12})/i;

// Format B: counterparty bare (no parens), "Your UPI transaction reference number is"
const FORMAT_B =
  /Rs\.([\d,]+\.\d{2})\s+has\s+been\s+debited\s+from\s+account\s+\**(\d{4})\s+to\s+VPA\s+(\S+)\s+(.+?)\s+on\s+(\d{2}-\d{2}-\d{2})\.\s+Your\s+UPI\s+transaction\s+reference\s+number\s+is\s+(\d{12})/i;

export const hdfcAlertExtractor: MerchantExtractor = {
  id: "hdfc_alert",
  senders: ["alerts@hdfcbank.bank.in", "alerts@hdfcbank.net"],
  subjectIncludes: "UPI txn",
  extract(email: FetchedEmail): ExtractedInfo | null {
    const body = email.text || "";
    // Try the newer Format A first, then fall back to Format B.
    const m = FORMAT_A.exec(body) ?? FORMAT_B.exec(body);
    if (!m) return null;
    const [, amountS, last4Raw, vpa, counterparty, istDateS, utr] = m;
    const last4 = last4Raw!.replace(/\D/g, "");
    const amount = Number(amountS!.replace(/,/g, ""));
    // The email's Date: is UTC; HDFC alerts are sent at IST moment of debit.
    const utc = new Date(email.date);
    const istTime = utcToIst(utc);
    return {
      fields: {
        amount,
        accountLast4: last4,
        vpa: vpa!,
        counterparty: counterparty!.trim(),
        istDate: parseDdMmYy(istDateS!),
        istTime,
        utr: utr!,
      },
      summary: `HDFC: ₹${amountS} → ${counterparty!.trim()} @ ${istTime} IST (UTR ${utr})`,
    };
  },
};

function utcToIst(d: Date): string {
  // IST = UTC + 5h30m
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseDdMmYy(s: string): string {
  // "14-05-26" → "2026-05-14". HDFC's 2-digit year is always 20xx.
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}
