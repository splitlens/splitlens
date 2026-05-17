/**
 * Hand-crafted text fixtures for PhonePe transaction statements.
 *
 * Mirrors the layout that the real PhonePe export PDFs produce after
 * pdfjs-dist text extraction + y-axis line clustering. Synthetic counterparty
 * names / UTRs / txn ids — no real personal data.
 *
 * Covers:
 *   - Variant A (amount on the date line)
 *   - Variant B (amount wraps onto the time line, seen for ≥5-digit amounts)
 *   - Action verbs: "Paid to" / "Received from" / "Bill paid -"
 *   - Counterparty shapes: named person, masked account, UPI VPA
 *   - AM/PM edge cases for the 12h→24h converter
 *   - Multi-page (statement header on page 1, plain rows on page 2)
 */

export const PHONEPE_PAGE_1 = `Transaction Statement for +911234567890
Apr 01, 2026 - May 15, 2026
Date Transaction Details Type Amount
Apr 01, 2026 Paid to KRISHNA STORE Debit INR 48.00
08:53 AM Transaction ID : AC232604010853361289256546
UTR No : 095596237777
Debited from XX2491
Apr 01, 2026 Paid to merchant@axisbank Debit INR 149.00
12:00 PM Transaction ID : OLEX2604011200583747062400
UTR No : 103009279521
Debited from XX2491
Apr 01, 2026 Bill paid - FASTag Debit INR 300.00
05:52 AM Transaction ID : NX23050105520540767938861
UTR No : 348704746622
Debited from XX2491
Apr 01, 2026 Received from Rahul Kumar Credit INR 672.00
10:41 PM Transaction ID : T2604012241250814359518
UTR No : 350761511990
Credited to XX2491
Apr 02, 2026 Paid to ******2528 Debit INR 50.00
12:00 AM Transaction ID : T2604020000004891255130
UTR No : 134489079211
Debited from XX2491
Page 1 of 2
This is a system generated statement. For any queries, contact us at https://support.phonepe.com/statement .`;

/**
 * Page 2 — exercises Variant B (5-digit amount wraps to time line),
 * a 01:26 PM time (the tricky add-12 PM case), and split-source rows
 * where the bill is funded partly by the linked bank and partly by
 * wallet or another account.
 */
export const PHONEPE_PAGE_2 = `Date Transaction Details Type Amount
Apr 02, 2026 Paid to BIG MERCHANT NAME Debit INR
02:01 AM 11216.00 Transaction ID : T2604020201054810135940
UTR No : 312464501587
Debited from XX2491
Apr 02, 2026 Received from refund-merchant@hdfcbank Credit INR
01:26 PM 10833.00 Transaction ID : ICIe8301a8656b8470392dc95848d8aae9b
UTR No : 440930298055
Credited to XX2491
Apr 06, 2021 Paid to JUICE JUNCTION Debit INR 60.00
08:57 PM Transaction ID : T2104062057224578953159
UTR No : 109663879200
Debited from XX0426 INR 20.24 | Wallet INR 39.76
Jul 27, 2022 Paid to R RAMDEV MEDICALS Debit INR 462.00
09:12 PM Transaction ID : T2207272112113671800333
UTR No : 220855429818
Debited from XX2491 INR 395.00 | Account INR 67.00
Page 2 of 2
This is an automatically generated statement. Customer(s) are requested to immediately notify PhonePe in case of any
errors in the statement at https://support.phonepe.com/statement.
Visit https://www.phonepe.com/terms-conditions/ for PhonePe Terms & Conditions and https://www.phonepe.com
/privacy-policy/ for Privacy Policy.
Do not fall prey to fictitious offers of winning prizes, money circulation schemes and cheap funds, etc. through SMS,
emails and calls.
The contents of this email and document are confidential and intended for the recipient specified in this document. If you
received this message by mistake, please inform PhonePe at https://support.phonepe.com/statement so that we can ensure
the recipient's details are corrected.`;
