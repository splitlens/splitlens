import { describe, it, expect } from "vitest";
import { isOnlineMerchant } from "../../src/location/online-merchants";

describe("isOnlineMerchant", () => {
  describe("user override", () => {
    it("returns true when explicitly online", () => {
      expect(isOnlineMerchant("Joe's Diner", true)).toBe(true);
    });
    it("returns false when explicitly physical, even if KB says online", () => {
      expect(isOnlineMerchant("APPLE MEDIA SERVICES", false)).toBe(false);
    });
    it("falls back to heuristic when override is null", () => {
      expect(isOnlineMerchant("APPLE MEDIA SERVICES", null)).toBe(true);
    });
    it("falls back to heuristic when override is undefined", () => {
      expect(isOnlineMerchant("APPLE MEDIA SERVICES")).toBe(true);
    });
  });

  describe("hints-KB matches", () => {
    it("flags Apple", () => {
      expect(isOnlineMerchant("APPLE MEDIA SERVICES")).toBe(true);
    });
    it("flags Netflix", () => {
      expect(isOnlineMerchant("NETFLIX.COM")).toBe(true);
    });
    it("flags Spotify", () => {
      expect(isOnlineMerchant("spotify")).toBe(true);
    });
    it("flags YouTube Premium (via Google KB entry)", () => {
      expect(isOnlineMerchant("GOOGLE *YOUTUBEPREMIUM")).toBe(true);
    });
  });

  describe("explicit online list", () => {
    it("flags Razorpay-mediated charges", () => {
      expect(isOnlineMerchant("RAZORPAY*Acme")).toBe(true);
    });
    it("flags Vercel", () => {
      expect(isOnlineMerchant("VERCEL INC")).toBe(true);
    });
    it("flags AWS", () => {
      expect(isOnlineMerchant("Amazon Web Services")).toBe(true);
    });
    it("flags Substack", () => {
      expect(isOnlineMerchant("SUBSTACK")).toBe(true);
    });
  });

  describe("physical merchants stay false", () => {
    it("doesn't flag Cult.fit (in-person gym)", () => {
      expect(isOnlineMerchant("CULT.FIT INDIRANAGAR")).toBe(false);
    });
    it("doesn't flag a random restaurant", () => {
      expect(isOnlineMerchant("MTR RESTAURANT")).toBe(false);
    });
    it("doesn't flag a UPI to a person", () => {
      expect(isOnlineMerchant("rahul@okhdfcbank")).toBe(false);
    });
  });

  describe("degenerate inputs", () => {
    it("returns false for null/empty counterparty (without override)", () => {
      expect(isOnlineMerchant(null)).toBe(false);
      expect(isOnlineMerchant(undefined)).toBe(false);
      expect(isOnlineMerchant("")).toBe(false);
      expect(isOnlineMerchant("   ")).toBe(false);
    });
    it("override still wins for null counterparty", () => {
      expect(isOnlineMerchant(null, true)).toBe(true);
    });
  });
});
