import { describe, it, expect } from "vitest";
import { rapidoExtractor } from "../../src/extractors/rapido";
import type { FetchedEmail } from "../../src/types";

function mkEmail(text: string): FetchedEmail {
  return {
    messageId: "<test@example>",
    date: "2025-12-22T05:37:43.000Z",
    fromRaw: "shoutout@rapido.bike",
    fromAddress: "shoutout@rapido.bike",
    subject: "Your trip with Rapido",
    text,
    html: null,
    size: text.length,
  };
}

describe("rapidoExtractor", () => {
  const sample =
    "Booking History Booking History " +
    "Customer Name Prateek Aryan " +
    "Ride ID RD17663794342262037 " +
    "Driver name DAVALASAB " +
    "Vehicle Number KA32EY1802 " +
    "Time of Ride Dec 22nd 2025, 10:31 AM " +
    "Selected Price ₹ 180 " +
    "55/5, Sakra Hospital Rd, Devarabisanahalli, Bellandur, Bengaluru. " +
    "BLOCK-Q, MS Ramaiah North City, Manayata Tech Park, Nagavara, Bengaluru.";

  it("extracts price, driver, vehicle, ride id, trip date/time", () => {
    const r = rapidoExtractor.extract(mkEmail(sample));
    expect(r).not.toBeNull();
    expect(r!.fields).toEqual({
      kind: "rapido_ride",
      amount: 180,
      rideId: "RD17663794342262037",
      driver: "DAVALASAB",
      vehicle: "KA32EY1802",
      tripDate: "2025-12-22",
      tripTime: "10:31 AM",
    });
  });

  it("handles multi-word driver names", () => {
    const multi = sample.replace("Driver name DAVALASAB", "Driver name Anand M N Anand");
    const r = rapidoExtractor.extract(mkEmail(multi));
    expect(r?.fields.driver).toBe("Anand M N Anand");
  });

  it("parses 'st' / 'nd' / 'rd' ordinals on the date", () => {
    const t1 = sample.replace("Dec 22nd 2025", "Jan 1st 2026");
    expect(rapidoExtractor.extract(mkEmail(t1))?.fields.tripDate).toBe("2026-01-01");
    const t2 = sample.replace("Dec 22nd 2025", "Mar 3rd 2026");
    expect(rapidoExtractor.extract(mkEmail(t2))?.fields.tripDate).toBe("2026-03-03");
  });

  it("returns null when 'Selected Price' is absent", () => {
    const broken =
      "Booking History Customer Name Prateek Aryan Ride ID RD123 " +
      "Driver name X Vehicle Number Y";
    expect(rapidoExtractor.extract(mkEmail(broken))).toBeNull();
  });
});
