/**
 * Rapido bike/auto/cab trip receipts. Senders:
 *   - shoutout@rapido.bike   — primary, "Your trip with Rapido" subject
 *   - partner@rapido.bike    — same shape, less common
 *
 * Body is extremely consistent across samples:
 *   Booking History Booking History
 *   Customer Name Prateek Aryan
 *   Ride ID RD17663794342262037
 *   Driver name DAVALASAB
 *   Vehicle Number KA32EY1802
 *   Time of Ride Dec 22nd 2025, 10:31 AM
 *   Selected Price ₹ 180
 *   <pickup address>
 *   <drop address>
 *
 * "Selected Price" is the agreed-upon fare; Rapido doesn't show a separate
 * total because they don't add platform fees/toll like Uber does.
 */
import type { FetchedEmail } from "../types";
import type { ExtractedInfo, MerchantExtractor } from "./types";

const RIDE_ID_RE = /Ride\s+ID\s+(RD\d+)/i;
const DRIVER_RE = /Driver\s+name\s+(.+?)\s+Vehicle\s+Number/i;
const VEHICLE_RE = /Vehicle\s+Number\s+([A-Z0-9]+)/i;
// "Time of Ride Dec 22nd 2025, 10:31 AM" — month abbrev, "Xst/Xnd/Xrd/Xth", year, 12-hour HH:MM AM/PM.
const TIME_RE =
  /Time\s+of\s+Ride\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:st|nd|rd|th)\s+(\d{4}),\s+(\d{1,2}:\d{2}\s*[AP]M)/i;
// "Selected Price ₹ 180" — there can be a space between ₹ and the number.
const PRICE_RE = /Selected\s+Price\s+₹\s*([\d,]+(?:\.\d{2})?)/i;

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export const rapidoExtractor: MerchantExtractor = {
  id: "rapido",
  senders: ["shoutout@rapido.bike", "partner@rapido.bike"],
  subjectIncludes: "Rapido",
  extract(email: FetchedEmail): ExtractedInfo | null {
    const body = email.text || "";

    const priceMatch = PRICE_RE.exec(body);
    if (!priceMatch) return null;
    const amount = Number(priceMatch[1]!.replace(/,/g, ""));

    const rideId = RIDE_ID_RE.exec(body)?.[1] ?? null;
    const driver = DRIVER_RE.exec(body)?.[1]?.trim() ?? null;
    const vehicle = VEHICLE_RE.exec(body)?.[1] ?? null;

    let tripDate: string | null = null;
    let tripTime: string | null = null;
    const tm = TIME_RE.exec(body);
    if (tm) {
      const mon = MONTHS[tm[1]!];
      const day = Number(tm[2]);
      const year = Number(tm[3]);
      if (mon && day && year) {
        tripDate = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      tripTime = tm[4]!.replace(/\s+/g, " ").trim();
    }

    const summary =
      `Rapido: ₹${amount.toFixed(2)}` +
      (driver ? ` · ${driver}` : "") +
      (vehicle ? ` (${vehicle})` : "") +
      (rideId ? ` · ${rideId}` : "");

    return {
      fields: {
        kind: "rapido_ride",
        amount,
        rideId,
        driver,
        vehicle,
        tripDate,
        tripTime,
      },
      summary,
    };
  },
};
