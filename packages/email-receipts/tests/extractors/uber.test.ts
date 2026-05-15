import { describe, it, expect } from "vitest";
import { uberExtractor } from "../../src/extractors/uber";
import type { FetchedEmail } from "../../src/types";

function mkEmail(
  text: string,
  subject = "[Personal] Your Saturday morning trip with Uber",
): FetchedEmail {
  return {
    messageId: "<test@example>",
    date: "2026-02-06T22:07:42.000Z",
    fromRaw: '"Uber Receipts" <noreply@uber.com>',
    fromAddress: "noreply@uber.com",
    subject,
    text,
    html: null,
    size: text.length,
  };
}

describe("uberExtractor", () => {
  const sample =
    "Feb 7, 2026 2:36 am Feb 7, 2026 , 2:36 am Thanks for riding, Prateek " +
    "We hope you enjoyed your ride this morning. Total ₹663.96 " +
    "Suggested fare ₹513.76 BIAL Airport South Toll ₹120.00 " +
    "Booking fee ₹28.00 Wait Time ₹2.20 Payments Cash ₹663.96 " +
    "2/7/26 3:37 am Download the receipt in a PDF format Download PDF " +
    "Trip details Go Non AC 40.83 kilometres, 47 minutes " +
    "License Plate: KA04AE0714 2:50 am pickup address. " +
    "3:37 am drop address. You rode with SATISH 4.97";

  it("extracts amount, fare breakdown, trip details, driver, payment", () => {
    const r = uberExtractor.extract(mkEmail(sample));
    expect(r).not.toBeNull();
    expect(r!.fields).toEqual({
      kind: "uber_ride",
      amount: 663.96,
      suggestedFare: 513.76,
      service: "Go Non AC",
      distanceKm: 40.83,
      durationMinutes: 47,
      licensePlate: "KA04AE0714",
      driver: "SATISH",
      paymentMethod: "Cash",
    });
  });

  it("parses duration with hours + minutes", () => {
    const hourly = sample.replace(
      "40.83 kilometres, 47 minutes",
      "44.04 kilometres, 1 hours 19 minutes",
    );
    const r = uberExtractor.extract(mkEmail(hourly));
    expect(r?.fields.durationMinutes).toBe(79); // 1h 19m
  });

  it("returns null for Uber marketing email lacking 'Thanks for riding'", () => {
    const promo =
      "New city, same app for all your travel. Book bus tickets in-app. " +
      "Total ₹100.00";
    expect(uberExtractor.extract(mkEmail(promo, "New city, same app"))).toBeNull();
  });

  it("returns null when no total amount present", () => {
    const broken =
      "Thanks for riding, Prateek. Trip details Go Non AC 10 kilometres, 10 minutes.";
    expect(uberExtractor.extract(mkEmail(broken))).toBeNull();
  });
});
