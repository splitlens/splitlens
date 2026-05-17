import { describe, it, expect } from "vitest";
import { hdfcAlertExtractor } from "../../src/extractors/hdfc-alert";
import type { FetchedEmail } from "../../src/types";

function mkEmail(text: string, dateIso = "2026-05-14T08:50:28.000Z"): FetchedEmail {
  return {
    messageId: "<test@example>",
    date: dateIso,
    fromRaw: "HDFC Bank InstaAlerts <alerts@hdfcbank.bank.in>",
    fromAddress: "alerts@hdfcbank.bank.in",
    subject: "❗  You have done a UPI txn. Check details!",
    text,
    html: null,
    size: text.length,
  };
}

describe("hdfcAlertExtractor — Format A (2026+, parens + 'is debited')", () => {
  const sample =
    "HDFC BANK --> Dear Customer, Greetings from HDFC Bank! " +
    "Rs.345.00 is debited from your account ending 2491 towards VPA " +
    "zeptomarketplac744706.rzp@rxaxis (ZEPTO MARKETPLACE PRIVATE LIMITED) " +
    "on 14-05-26. UPI transaction reference no.: 613414367509. " +
    "If you did not authorize this transaction, please report it immediately.";

  it("extracts all fields", () => {
    const r = hdfcAlertExtractor.extract(mkEmail(sample));
    expect(r).not.toBeNull();
    expect(r!.fields).toEqual({
      amount: 345,
      accountLast4: "2491",
      vpa: "zeptomarketplac744706.rzp@rxaxis",
      counterparty: "ZEPTO MARKETPLACE PRIVATE LIMITED",
      istDate: "2026-05-14",
      // Email date is 08:50:28 UTC → 14:20 IST (+5h30m).
      istTime: "14:20",
      utr: "613414367509",
    });
  });

  it("strips ** mask from last4 when present", () => {
    const masked = sample.replace("ending 2491", "ending **2491");
    const r = hdfcAlertExtractor.extract(mkEmail(masked));
    expect(r?.fields.accountLast4).toBe("2491");
  });
});

describe("hdfcAlertExtractor — Format B (2024-2025, bare counterparty + 'has been debited')", () => {
  const sample =
    "HDFC BANK --> Dear Customer, " +
    "Rs.180.00 has been debited from account 2491 to VPA " +
    "BHARATPE90727380920@yesbankltd KUSHAL " +
    "on 29-01-26. Your UPI transaction reference number is 278812942209. " +
    "If you did not authorize this transaction, please report it.";

  it("extracts all fields without parens around counterparty", () => {
    const r = hdfcAlertExtractor.extract(mkEmail(sample, "2026-01-29T13:54:19.000Z"));
    expect(r).not.toBeNull();
    expect(r!.fields).toEqual({
      amount: 180,
      accountLast4: "2491",
      vpa: "BHARATPE90727380920@yesbankltd",
      counterparty: "KUSHAL",
      istDate: "2026-01-29",
      istTime: "19:24",
      utr: "278812942209",
    });
  });

  it("strips ** mask from last4 in Format B too", () => {
    const masked = sample.replace("from account 2491", "from account **2491");
    const r = hdfcAlertExtractor.extract(mkEmail(masked, "2026-01-29T13:54:19.000Z"));
    expect(r?.fields.accountLast4).toBe("2491");
  });
});

describe("hdfcAlertExtractor — non-matching shapes", () => {
  it("returns null for credit-card debit alerts (different body shape)", () => {
    const cc =
      "HDFC BANK --> Dear Customer, Greetings from HDFC Bank! " +
      "Rs.629.00 is debited from your HDFC Bank Credit Card XX3969 " +
      "at SWIGGY on 14-05-26.";
    expect(hdfcAlertExtractor.extract(mkEmail(cc))).toBeNull();
  });

  it("returns null for account-update alerts", () => {
    const upd =
      "HDFC BANK --> Dear Customer, There is an upcoming E-mandate on your account.";
    expect(hdfcAlertExtractor.extract(mkEmail(upd))).toBeNull();
  });

  it("returns null for an empty body", () => {
    expect(hdfcAlertExtractor.extract(mkEmail(""))).toBeNull();
  });
});
