import { describe, it, expect } from "vitest";
import { blinkitParser } from "../../src/parsers/blinkit";

const BLINKIT_FIXTURE = [
  "blinkit",
  "Order ID: BL876543210",
  "Delivered",
  "Maggi Noodles (70g)",
  "Qty: 3   ₹42.00",
  "Mother Dairy Curd 400g",
  "Qty: 1   ₹45.00",
  "Onion 1kg",
  "Qty: 1   ₹38.00",
  "MRP                    ₹125.00",
  "Item Total             ₹125.00",
  "Delivery charge         ₹15.00",
  "Handling charge          ₹2.00",
  "Bill Total             ₹142.00",
];

const BLINKIT_FIXTURE_GROFERS = [
  "grofers (now blinkit)",
  "Order ID: GR123456789",
  "Delivered",
  "Aashirvaad Atta 5kg",
  "Qty: 1   ₹290.00",
  "Bill Total             ₹290.00",
];

describe("blinkitParser.matches", () => {
  it("recognizes a blinkit receipt", () => {
    expect(blinkitParser.matches(BLINKIT_FIXTURE)).toBe(true);
  });

  it("also recognizes legacy Grofers receipts", () => {
    expect(blinkitParser.matches(BLINKIT_FIXTURE_GROFERS)).toBe(true);
  });
});

describe("blinkitParser.extract", () => {
  it("extracts bill total, order id, and items", () => {
    const r = blinkitParser.extract(BLINKIT_FIXTURE);
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(142);
    expect(r!.orderId).toBe("BL876543210");
    expect(r!.items.length).toBeGreaterThanOrEqual(3);

    const maggi = r!.items.find((i) => /Maggi/i.test(i.name));
    expect(maggi).toBeDefined();
    expect(maggi!.quantity).toBe(3);
    expect(maggi!.amount).toBe(42);
  });

  it("returns null when no total is visible", () => {
    const noTotal = BLINKIT_FIXTURE.filter((l) => !/Bill Total/i.test(l));
    expect(blinkitParser.extract(noTotal)).toBeNull();
  });
});
