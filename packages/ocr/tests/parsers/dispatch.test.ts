import { describe, it, expect } from "vitest";
import { parseReceipt } from "../../src/parsers/index";

describe("parseReceipt — merchant dispatch", () => {
  it("routes to the Zepto parser", () => {
    const r = parseReceipt([
      "Zepto",
      "Order #ZP1",
      "Item Total ₹50.00",
      "Grand Total ₹50.00",
    ]);
    expect(r?.merchant).toBe("zepto");
  });

  it("routes to the Blinkit parser", () => {
    const r = parseReceipt([
      "blinkit",
      "Order ID: BL1",
      "Bill Total ₹75.00",
    ]);
    expect(r?.merchant).toBe("blinkit");
  });

  it("routes to the Instamart parser", () => {
    const r = parseReceipt([
      "Instamart",
      "Order #IM1",
      "Total ₹120.00",
    ]);
    expect(r?.merchant).toBe("instamart");
  });

  it("returns null when no parser matches", () => {
    expect(parseReceipt(["random screenshot", "Hello"])).toBeNull();
  });
});
