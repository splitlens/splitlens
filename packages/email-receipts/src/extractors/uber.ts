/**
 * Uber ride receipts. Sender `noreply@uber.com` (display name "Uber Receipts").
 *
 * The same address ALSO sends pure marketing — e.g. "New city, same app for
 * all your travel" — so we body-filter on "Thanks for riding" which only
 * appears on real trip receipts. The marketing sub-sender `uber.india@uber.com`
 * is intentionally NOT in the allowlist (we don't want to attach marketing
 * blasts to UPI debits).
 *
 * Body shape (HTML, but mailparser flattens to text — sometimes one long line,
 * sometimes broken). Real example shape:
 *
 *   Feb 7, 2026 2:36 am
 *   Feb 7, 2026 , 2:36 am
 *   Thanks for riding, Prateek
 *   We hope you enjoyed your ride this morning.
 *   Total ₹663.96
 *   Suggested fare ₹513.76
 *   BIAL Airport South Toll ₹120.00
 *   Booking fee ₹28.00
 *   Wait Time ₹2.20
 *   Payments
 *   Cash ₹663.96
 *   2/7/26 3:37 am
 *   ...
 *   Trip details
 *   Go Non AC 40.83 kilometres, 47 minutes
 *   License Plate: KA04AE0714
 *   ...
 *   You rode with SATISH
 *
 * Payment method (Cash / wallet / card) lives under a "Payments" header
 * followed by one or more "<method> ₹X" lines. We capture the first.
 */
import type { FetchedEmail } from "../types";
import type { ExtractedInfo, MerchantExtractor } from "./types";

const TOTAL_RE = /Total\s*₹\s*([\d,]+(?:\.\d{2})?)/i;
// "Suggested fare ₹513.76" — what Uber claims is the algorithm price before fees/toll.
const SUGGESTED_RE = /Suggested\s+fare\s*₹\s*([\d,]+(?:\.\d{2})?)/i;
// "Trip details Go Non AC 40.83 kilometres, 47 minutes" — service + distance + duration.
const TRIP_DETAILS_RE =
  /Trip\s+details\s+([A-Za-z][A-Za-z0-9 ]+?)\s+([\d.]+)\s*kilometres,\s*(?:(\d+)\s*hours?\s*)?(\d+)\s*minutes/i;
const LICENSE_PLATE_RE = /License\s+Plate:\s*([A-Z0-9]+)/i;
// "You rode with SATISH 4.97" — driver name, followed by their rating.
// We capture greedily up to (but not including) the rating decimal that
// Uber always appends ("4.97", "5.00", etc.).
const DRIVER_RE = /You\s+rode\s+with\s+(.+?)\s+\d\.\d{2}\b/i;
// First payment-method line after the "Payments" header.
const PAYMENTS_RE =
  /Payments\s+(Cash|Wallet|Amazon Pay|Credit Card|Debit Card|UPI|GPay|Paytm)\s*₹\s*([\d,]+(?:\.\d{2})?)/i;

export const uberExtractor: MerchantExtractor = {
  id: "uber",
  // Marketing-side `uber.india@uber.com` and `uber@uber.com` excluded; their
  // bodies don't have "Thanks for riding" anyway, but allowlisting them would
  // spam findEmailsForTransaction with false candidates.
  senders: ["noreply@uber.com"],
  subjectIncludes: "trip with Uber",
  extract(email: FetchedEmail): ExtractedInfo | null {
    const body = email.text || "";
    // Reject the "New city, same app" / "save on Diwali gift delivery" style
    // marketing emails that occasionally come from noreply@uber.com.
    if (!/Thanks for riding/i.test(body)) return null;

    const totalMatch = TOTAL_RE.exec(body);
    if (!totalMatch) return null;
    const amount = Number(totalMatch[1]!.replace(/,/g, ""));

    const suggestedMatch = SUGGESTED_RE.exec(body);
    const suggestedFare = suggestedMatch
      ? Number(suggestedMatch[1]!.replace(/,/g, ""))
      : null;

    const tripMatch = TRIP_DETAILS_RE.exec(body);
    const service = tripMatch?.[1]?.trim() ?? null;
    const distanceKm = tripMatch?.[2] ? Number(tripMatch[2]) : null;
    const durationMinutes = tripMatch
      ? (Number(tripMatch[3] ?? 0) * 60) + Number(tripMatch[4] ?? 0)
      : null;

    const plate = LICENSE_PLATE_RE.exec(body)?.[1] ?? null;
    const driver = DRIVER_RE.exec(body)?.[1]?.trim() ?? null;
    const payments = PAYMENTS_RE.exec(body);
    const paymentMethod = payments?.[1] ?? null;

    const summary =
      `Uber${service ? ` (${service})` : ""}: ₹${amount.toFixed(2)}` +
      (distanceKm ? ` · ${distanceKm}km` : "") +
      (driver ? ` · ${driver}` : "") +
      (paymentMethod ? ` · ${paymentMethod}` : "");

    return {
      fields: {
        kind: "uber_ride",
        amount,
        suggestedFare,
        service,
        distanceKm,
        durationMinutes,
        licensePlate: plate,
        driver,
        paymentMethod,
      },
      summary,
    };
  },
};
