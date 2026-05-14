import { describe, it, expect } from "vitest";
import { categorize, categorizeMany } from "../../src/rules/index.js";
import type { CategoryRule } from "../../src/rules/index.js";

const SAMPLE_RULES: CategoryRule[] = [
  { pattern: "NEFTCR-CHAS|CISCOSYSTEMS", category: "Income:Salary (Cisco)", priority: 10 },
  { pattern: "USEFULBI", category: "Income:Salary (UsefulBI)", priority: 10 },
  { pattern: "^SALARY", category: "Income:Salary (UsefulBI)", priority: 11 },
  { pattern: "FDBOOKED|FD ?BOOKED", category: "Investment:Fixed Deposit", priority: 20 },
  { pattern: "RAHUL.*?(9525680445|RAHUL\\.GR8DPS)", category: "Bills:Rent (flatmate share)", priority: 30 },
  { pattern: "BETHPRASAD ?KADEL|BEDKADEL", category: "Household:Domestic Help", priority: 30 },
  { pattern: "APPLEMEDIASERVICES|APPLESERVICES|APPLE\\.COM", category: "Subscription:Apple", priority: 40 },
  { pattern: "BLINKIT|GROFERS", category: "Food:Quick Commerce", priority: 50 },
  { pattern: "ZEPTO", category: "Food:Quick Commerce", priority: 50 },
  { pattern: "SWIGGY", category: "Food:Delivery", priority: 50 },
];

describe("categorize", () => {
  it("returns Uncategorized when no rule matches", () => {
    expect(categorize("RANDOM TEXT WITH NO MATCH", SAMPLE_RULES)).toEqual({
      category: "Uncategorized",
      matchedRule: null,
    });
  });

  it("matches a Cisco salary credit", () => {
    const r = categorize("NEFTCR-CHAS0INBX01-SALARYFORNOV2025 CISCOSYSTEMS(INDIA)", SAMPLE_RULES);
    expect(r.category).toBe("Income:Salary (Cisco)");
    expect(r.matchedRule).toBe("NEFTCR-CHAS|CISCOSYSTEMS");
  });

  it("matches a bare SALARY entry as UsefulBI", () => {
    expect(categorize("SALARY", SAMPLE_RULES).category).toBe("Income:Salary (UsefulBI)");
  });

  it("matches Rahul flatmate rent across UPI handle variants", () => {
    const variants = [
      "UPI-RAHULKUMAR-9525680445@YBL-HDFC0000235-...",
      "UPI-RAHULKUMAR-9525680445@AXL-HDFC0000235-...",
      "UPI-RAHUL KUMAR-RAHUL.GR8DPS@OKHDFCBANK-HDFC0000235-...",
    ];
    for (const v of variants) {
      expect(categorize(v, SAMPLE_RULES).category).toBe("Bills:Rent (flatmate share)");
    }
  });

  it("does NOT match other Rahuls (BharatPe merchant, Singh suffix)", () => {
    expect(categorize("UPI-RAHUL-BHARATPE.9D0K0N0L2D024545@UNITYPE-...", SAMPLE_RULES).category).toBe(
      "Uncategorized",
    );
    expect(categorize("UPI-RAHULKUMARSINGH-6206785781@AXL-UBIN0560308-...", SAMPLE_RULES).category).toBe(
      "Uncategorized",
    );
  });

  it("matches Bethprasad Kadel both with and without space", () => {
    expect(categorize("UPI-BETHPRASADKADEL-9886619181@AXL-...", SAMPLE_RULES).category).toBe(
      "Household:Domestic Help",
    );
    expect(categorize("UPI-BETHPRASAD KADEL-BEDKADEL88@OKSBI-...", SAMPLE_RULES).category).toBe(
      "Household:Domestic Help",
    );
  });

  it("respects priority order — Cisco rule (priority 10) wins over generic SALARY (priority 11)", () => {
    expect(
      categorize("NEFTCR-CHAS0INBX01-SALARY FOR NOV 2025 CISCOSYSTEMS", SAMPLE_RULES).category,
    ).toBe("Income:Salary (Cisco)");
  });

  it("ignores disabled rules", () => {
    const rules: CategoryRule[] = [
      { pattern: "BLINKIT", category: "Food:Quick Commerce", enabled: false },
      { pattern: ".*", category: "Catch-all", priority: 999 },
    ];
    expect(categorize("UPI-BLINKIT-...", rules).category).toBe("Catch-all");
  });

  it("is case-insensitive", () => {
    expect(categorize("upi-blinkit-...", SAMPLE_RULES).category).toBe("Food:Quick Commerce");
    expect(categorize("UPI-BLINKIT-...", SAMPLE_RULES).category).toBe("Food:Quick Commerce");
  });
});

describe("categorizeMany", () => {
  it("categorizes a batch of transactions", () => {
    const txns = [
      { narration: "UPI-BLINKIT-..." },
      { narration: "UPI-SWIGGY-..." },
      { narration: "RANDOM" },
    ];
    const results = categorizeMany(txns, SAMPLE_RULES);
    expect(results).toHaveLength(3);
    expect(results[0]?.category).toBe("Food:Quick Commerce");
    expect(results[1]?.category).toBe("Food:Delivery");
    expect(results[2]?.category).toBe("Uncategorized");
  });
});
