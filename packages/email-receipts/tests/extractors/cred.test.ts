import { describe, it, expect } from "vitest";
import { credExtractor } from "../../src/extractors/cred";
import type { FetchedEmail } from "../../src/types";

// NOTE: No actual Cred receipts were observed on the test account during
// onboarding (the user's mailbox only had perks updates + due-date reminders).
// Tests below cover the documented Cred receipt formats — fixtures are
// hand-crafted to the format Cred publishes, not real email content.

function mkEmail(
  text: string,
  subject = "Your credit card bill payment was successful",
  from = "protect@cred.club",
): FetchedEmail {
  return {
    messageId: "<test@example>",
    date: "2026-05-08T07:30:00.000Z",
    fromRaw: `"CRED" <${from}>`,
    fromAddress: from,
    subject,
    text,
    html: null,
    size: text.length,
  };
}

describe("credExtractor — credit card bill payment", () => {
  const sample =
    "bill paid successfully " +
    "amount paid ₹12,345.67 " +
    "paid towards HDFC Bank credit card XX3969 " +
    "on 08 May 2026 " +
    "transaction id CRED1A2B3C4D5E";

  it("extracts amount, card bank, last4, txn id, paid date", () => {
    const r = credExtractor.extract(mkEmail(sample));
    expect(r).not.toBeNull();
    expect(r!.fields).toMatchObject({
      kind: "cred_cc_payment",
      amount: 12345.67,
      cardBank: "HDFC Bank",
      cardLast4: "3969",
      credTxnId: "CRED1A2B3C4D5E",
      paidDate: "2026-05-08",
    });
  });
});

describe("credExtractor — Bharat Connect / BBPS bill", () => {
  const sample =
    "payment successful " +
    "₹2,345.00 paid to BESCOM Electricity " +
    "reference id BBPS123456789012";

  it("captures BBPS reference + biller", () => {
    const r = credExtractor.extract(
      mkEmail(sample, "Payment of ₹2,345 to BESCOM Electricity successful"),
    );
    expect(r).not.toBeNull();
    expect(r!.fields).toMatchObject({
      kind: "cred_bbps",
      amount: 2345,
      bbpsRefId: "BBPS123456789012",
    });
    expect(r!.fields.biller).toBe("BESCOM Electricity");
  });
});

describe("credExtractor — non-receipts (must reject)", () => {
  it("rejects bill due reminders", () => {
    const reminder =
      "Wednesday, May 06, 2026 hi, your credit card payment is due " +
      "payment due by May 10, 2026 ₹12,345.00";
    expect(
      credExtractor.extract(
        mkEmail(reminder, "Your credit card bill is due on May 10, 2026"),
      ),
    ).toBeNull();
  });

  it("rejects pure marketing perks emails", () => {
    const marketing =
      "where your HDFC card works internationally has changed " +
      "HDFC Bank has clarified that credit cards, debit cards, and forex cards. ₹0";
    expect(
      credExtractor.extract(
        mkEmail(marketing, "update on international spends on your HDFC card"),
      ),
    ).toBeNull();
  });
});
