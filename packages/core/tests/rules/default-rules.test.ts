import { describe, it, expect } from "vitest";
import { categorize, DEFAULT_RULES } from "../../src/rules";

/**
 * Smoke test for the production ruleset against representative real-world
 * narrations from a year of HDFC statements. Catches regressions when rules
 * are reordered/edited.
 */
describe("DEFAULT_RULES — smoke against real HDFC narrations", () => {
  const cases: Array<[string, string]> = [
    ["NEFTCR-CHAS0INBX01-SALARY FOR APR 2025 CISCOSYSTEMS(INDIA)", "Income:Salary (Cisco)"],
    ["NEFTCR-USEFULBI001-SALARYFORDEC2025", "Income:Salary (UsefulBI)"],
    ["SALARY", "Income:Salary (Other)"],
    ["INTERESTPAID TILL 31/03/2026", "Income:Interest"],
    ["FDBOOKED-50301274197369:PRATEEKARYAN", "Investment:Fixed Deposit"],
    ["UPI-BILLIONBRAINSGARAGEVENTURES-PAYTM@PT-...", "Investment:Mutual Fund"],
    ["CC0005522608761XXXXXXAUTOPAY-AMT", "Transfer:Credit Card Payment"],
    ["UPI-RAHULKUMAR-9525680445@YBL-HDFC0000235-...", "Bills:Rent (flatmate share)"],
    ["UPI-RAHUL KUMAR-RAHUL.GR8DPS@OKHDFCBANK-...", "Bills:Rent (flatmate share)"],
    ["UPI-RAHULKUMAR-9525680445@YBL-...-ELECTRICITYBILL", "Bills:Electricity"],
    ["UPI-BETHPRASADKADEL-9886619181@AXL-...", "Household:Domestic Help"],
    ["UPI-BETHPRASAD KADEL-BEDKADEL88@OKSBI-...", "Household:Domestic Help"],
    ["UPI-MSREEPRAKASH-Q911356614@YBL-YESB0YBLUPI-...", "Personal:Tea & Cigarettes"],
    ["UPI-SHILPA V-PAYTM.S1J6TMV...-YESB0PTMUPI-...", "Personal:Tea & Cigarettes"],
    ["UPI-BLINKIT-PAYTM-...", "Food:Quick Commerce"],
    ["UPI-ZEPTOMARKETPLACE-PAYTM-...", "Food:Quick Commerce"],
    ["UPI-SWIGGY-PAYTM-...", "Food:Delivery"],
    ["UPI-HUNGERBOX TECHNOLOGIES-PAYTM-...", "Food:Office Canteen"],
    ["UPI-APPLEMEDIASERVICES-APPLESERVICES.BDSI@HDFCBANK-...", "Subscription:Apple"],
    ["UPI-SPOTIFY INDIA-SPOTIFY.BDSI@ICICI-...", "Subscription:Spotify"],
    ["CLAUDE.AI SUBSCRIPTIONSAN FRANCISC", "Subscription:Claude"],
    ["CURSOR, AI POWERED IDESAN FRANCISC", "Subscription:Software"],
    ["UPI-OLA-...", "Transport:Cabs"],
    ["UPI-UBER INDIA-...", "Transport:Cabs"],
    ["APPLE INDIA PRIVATE LMUMBAI", "Shopping:Apple Electronics"],
    ["AMAZONMUMBAI", "Shopping:Amazon"],
    ["UPI-103305047675-AMTSHALLBEDEBITEDFORATMCASHWDLS1BL...", "Cash:ATM Withdrawal"],
    ["IGST-VPS2608484387364-RATE 18.0 -29 (Ref# MT...)", "Charges:CC Tax"],
    ["CONSOLIDATED FCY MARKUP FEE (Ref# MT...)", "Charges:CC FCY Markup"],
    ["OFFUS EMI,PROCNG FEE,00000000001101 (Ref# ...)", "Charges:CC EMI Fee"],
    ["OFFUS EMI,PRIN NB:01,00000110153912 (Ref# ...)", "Bills:Loan EMI Principal"],
    ["UPI-NEHAUPENDRASINGH-...", "Transfer:Family"],
    ["UPI-SHIVAMRAMSURAT MISH-SHIVAMWA786@OKSBI-...", "Transfer:Flatmate (Shivam)"],
    ["UPI-AJAY KUMAR-AJAYKUMAR@OKAXIS-...", "Transfer:P2P"],
    ["UPI-RAVI SINGH-RAVISINGH@YBL-...", "Transfer:P2P"],
  ];

  for (const [narration, expected] of cases) {
    it(`'${narration.slice(0, 60)}...' → ${expected}`, () => {
      expect(categorize(narration, DEFAULT_RULES).category).toBe(expected);
    });
  }

  it("DEFAULT_RULES has 60+ rules", () => {
    expect(DEFAULT_RULES.length).toBeGreaterThanOrEqual(60);
  });

  it("returns Uncategorized for a truly unknown narration", () => {
    expect(categorize("UPI-RANDOMUNKNOWNMERCHANT-XYZ-...", DEFAULT_RULES).category).toBe(
      "Uncategorized",
    );
  });
});
