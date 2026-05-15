import { describe, it, expect } from "vitest";
import { instamartParser } from "../../src/parsers/instamart";

const INSTAMART_FIXTURE = [
  "Instamart",
  "Order #IM456789012",
  "Delivered on 12 May, 10:23 AM",
  "Britannia Marie Gold",
  "2 x ₹30        ₹60.00",
  "Dabur Honey 500g",
  "1 x ₹245       ₹245.00",
  "Lays Classic Salted",
  "3 x ₹20        ₹60.00",
  "Item Total              ₹365.00",
  "Delivery Fee             ₹25.00",
  "GST & Charges            ₹10.00",
  "Total                   ₹400.00",
];

describe("instamartParser.matches", () => {
  it("recognizes an Instamart receipt", () => {
    expect(instamartParser.matches(INSTAMART_FIXTURE)).toBe(true);
  });
  it("rejects non-Instamart text", () => {
    expect(instamartParser.matches(["Zepto", "Total ₹100"])).toBe(false);
  });
});

describe("instamartParser.extract", () => {
  it("extracts total, order id, and items", () => {
    const r = instamartParser.extract(INSTAMART_FIXTURE);
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(400);
    expect(r!.orderId).toBe("IM456789012");
    expect(r!.items.length).toBeGreaterThanOrEqual(3);

    const honey = r!.items.find((i) => /Honey/i.test(i.name));
    expect(honey).toBeDefined();
    expect(honey!.quantity).toBe(1);
    expect(honey!.amount).toBe(245);

    const lays = r!.items.find((i) => /Lays/i.test(i.name));
    expect(lays).toBeDefined();
    expect(lays!.quantity).toBe(3);
    expect(lays!.amount).toBe(60);
  });

  it("returns null when no total label is visible", () => {
    const noTotal = INSTAMART_FIXTURE.filter((l) => !/^Total/i.test(l));
    expect(instamartParser.extract(noTotal)).toBeNull();
  });
});
