import { describe, it, expect } from "vitest";
import { zeptoParser } from "../../src/parsers/zepto";

// These fixtures mimic actual Vision output: left-aligned text and
// right-aligned prices land in separate blocks, the rupee glyph reads as "7"
// or "{" depending on font, and quantities get their own block.
const ZEPTO_FIXTURE_BASIC = [
  "Zepto",
  "Order #ZP12345",
  "Delivered in 8 minutes",
  "Amul Milk 500ml",
  "Tata Salt 1kg",
  "Brown Bread",
  "Item Total",
  "Delivery Charge",
  "Grand Total",
  "Paid via UPI",
  "x2",
  "x1",
  "x1",
  "7139.00", // ₹139.00 (rupee misread)
  "715.00",  // ₹15.00
  "{154.00", // ₹154.00
  "766.00",
  "728.00",
  "745.00",
];

// Clean fixture with names+prices on the same lines.
const ZEPTO_FIXTURE_CLEAN = [
  "Zepto",
  "Order #ZP9988776",
  "Delivered in 6 minutes",
  "Amul Butter 100g x 1     ₹62.00",
  "Eggs Brown x 1           ₹120.00",
  "Item Total               ₹182.00",
  "Delivery Charge           ₹0.00",
  "Grand Total              ₹182.00",
  "Paid via UPI",
];

describe("zeptoParser.matches", () => {
  it("recognizes a Zepto receipt", () => {
    expect(zeptoParser.matches(ZEPTO_FIXTURE_CLEAN)).toBe(true);
  });

  it("rejects unrelated text", () => {
    expect(zeptoParser.matches(["Some other receipt", "Grand Total ₹100"])).toBe(false);
  });
});

describe("zeptoParser.extract — clean fixture", () => {
  it("returns total amount, order id, and items", () => {
    const r = zeptoParser.extract(ZEPTO_FIXTURE_CLEAN);
    expect(r).not.toBeNull();
    expect(r!.merchant).toBe("zepto");
    expect(r!.amount).toBe(182);
    expect(r!.orderId).toBe("ZP9988776");
    expect(r!.items.length).toBeGreaterThanOrEqual(2);

    const names = r!.items.map((i) => i.name);
    expect(names.some((n) => /Amul Butter/i.test(n))).toBe(true);
    expect(names.some((n) => /Eggs/i.test(n))).toBe(true);
  });
});

describe("zeptoParser.extract — Vision-shaped fixture", () => {
  it("survives rupee-glyph misreads in the total", () => {
    const r = zeptoParser.extract(ZEPTO_FIXTURE_BASIC);
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(154);
    expect(r!.orderId).toBe("ZP12345");
  });

  it("returns null total if no grand total label is visible", () => {
    const noTotal = ZEPTO_FIXTURE_CLEAN.filter((l) => !/Grand Total/i.test(l));
    expect(zeptoParser.extract(noTotal)).toBeNull();
  });
});
