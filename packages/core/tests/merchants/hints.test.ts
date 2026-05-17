import { describe, it, expect } from "vitest";
import {
  findMerchantEntry,
  getPriceHint,
} from "../../src/merchants/hints";

describe("findMerchantEntry", () => {
  it("matches APPLE MEDIA SERVICES", () => {
    expect(findMerchantEntry("APPLE MEDIA SERVICES")?.displayName).toBe("Apple");
  });

  it("matches itunes.com/bill style strings", () => {
    expect(findMerchantEntry("apple.com/bill")?.displayName).toBe("Apple");
  });

  it("matches Google Play and YouTube Premium variants", () => {
    expect(findMerchantEntry("GOOGLE *YouTube Premium")?.displayName).toBe("Google");
    expect(findMerchantEntry("Google One")?.displayName).toBe("Google");
    expect(findMerchantEntry("PLAY.GOOGLE.COM")?.displayName).toBe("Google");
  });

  it("is case-insensitive", () => {
    expect(findMerchantEntry("netflix")?.displayName).toBe("Netflix");
    expect(findMerchantEntry("NETFLIX.COM")?.displayName).toBe("Netflix");
  });

  it("returns null for unknown merchants", () => {
    expect(findMerchantEntry("ZEPTO MARKETPLACE")).toBeNull();
    expect(findMerchantEntry(null)).toBeNull();
    expect(findMerchantEntry("")).toBeNull();
  });
});

describe("getPriceHint", () => {
  it("resolves ₹149/mo Apple → iCloud+ 200GB (high confidence)", () => {
    const h = getPriceHint("APPLE MEDIA SERVICES", 149, "monthly");
    expect(h).not.toBeNull();
    expect(h!.label).toBe("iCloud+ 200GB");
    expect(h!.confidence).toBe("high");
    expect(h!.merchantDisplayName).toBe("Apple");
    expect(h!.categoryHint).toBe("Subscriptions");
  });

  it("resolves ₹59/mo Apple → Apple Music Student (high)", () => {
    const h = getPriceHint("APPLE MEDIA SERVICES", 59, "monthly");
    expect(h?.label).toBe("Apple Music Student");
  });

  it("returns the highest-confidence hint when multiple match the same price", () => {
    // ₹99/mo Apple has THREE possible matches in the KB at different
    // confidence levels: Apple Music Individual (medium), Apple TV+ (low).
    // Highest confidence wins.
    const h = getPriceHint("APPLE MEDIA SERVICES", 99, "monthly");
    expect(h?.confidence).toBe("medium");
    expect(h?.label).toContain("Apple Music");
  });

  it("tolerates ±1 INR amount drift", () => {
    expect(getPriceHint("APPLE MEDIA SERVICES", 148, "monthly")?.label).toBe(
      "iCloud+ 200GB",
    );
    expect(getPriceHint("APPLE MEDIA SERVICES", 150, "monthly")?.label).toBe(
      "iCloud+ 200GB",
    );
  });

  it("rejects amount mismatches outside the ±1 window", () => {
    expect(getPriceHint("APPLE MEDIA SERVICES", 200, "monthly")).toBeNull();
  });

  it("falls back to merchant's typical cadences when observed cadence is one_time", () => {
    // Single-charge Netflix txn — cadence detector says one_time but we
    // still want to suggest the product.
    const h = getPriceHint("NETFLIX", 649, "one_time");
    expect(h?.label).toBe("Netflix Premium");
  });

  it("falls back when cadence is irregular", () => {
    const h = getPriceHint("SPOTIFY", 119, "irregular");
    expect(h?.label).toBe("Spotify Individual");
  });

  it("returns null when cadence is wrong (e.g. weekly Apple)", () => {
    // No Apple product bills weekly — and observed cadence isn't a fallback bucket.
    expect(getPriceHint("APPLE MEDIA SERVICES", 99, "weekly")).toBeNull();
  });

  it("resolves YouTube Premium Family at ₹189/mo", () => {
    // Real string format on Indian statements: "GOOGLE *YOUTUBEPREMIUM"
    const h = getPriceHint("GOOGLE *YOUTUBEPREMIUM", 189, "monthly");
    expect(h?.label).toBe("YouTube Premium Family");
  });

  it("resolves Hotstar yearly correctly", () => {
    const h = getPriceHint("DISNEY+ HOTSTAR", 899, "yearly");
    expect(h?.label).toBe("Hotstar Super (yearly)");
  });

  it("returns null for unknown merchants regardless of amount", () => {
    expect(getPriceHint("UNKNOWN COFFEE SHOP", 149, "monthly")).toBeNull();
  });
});
