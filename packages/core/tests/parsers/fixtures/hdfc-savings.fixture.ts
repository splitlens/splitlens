/**
 * Hand-crafted positional fixtures for HDFC savings PDFs.
 *
 * Coordinates mirror the actual HDFC layout (verified against real samples):
 *   Date: x0=33.7,  x1=62.1
 *   Narration content: x0=68 (left-aligned)
 *   Ref: x0=292.6,  x1=356.6  (16-digit ref nos)
 *   ValueDt: x0=362.5, x1=390.9
 *   Withdrawal amts: right-aligned ~x=440-465
 *   Deposit amts: right-aligned ~x=510-548
 *   Balance amts: right-aligned ~x=590-625
 *   Header row at top=233.6
 *   Footer "*Closingbalance..." at top=794.9 (filtered out by FOOTER_Y_CUTOFF=770)
 */
import type { ExtractedPage, PdfWord } from "../../../src/types/index";

function w(
  text: string,
  x0: number,
  top: number,
  opts: { width?: number; height?: number } = {},
): PdfWord {
  const width = opts.width ?? defaultWidth(text);
  const height = opts.height ?? 10;
  return { text, x0, x1: x0 + width, top, bottom: top + height };
}

/**
 * Estimated PDF rendering width per text. Numbers are tighter than letters in HDFC's
 * sans font; date strings like "01/04/25" render around 28px (matches real measurements).
 */
function defaultWidth(text: string): number {
  // Date pattern (DD/MM/YY or DD/MM/YYYY) — narrow, matches real PDFs at ~28-30px
  if (/^\d{2}\/\d{2}\/\d{2}(\d{2})?$/.test(text)) return 28;
  return text.length * 5;
}

/** Header row that all transaction tables on every page have. */
const HEADER_WORDS = (top = 233.6): PdfWord[] => [
  w("Date", 39.9, top),
  w("Narration", 144.2, top),
  w("Chq./Ref.No.", 283.5, top),
  w("ValueDt", 361.5, top),
  w("WithdrawalAmt.", 405.3, top),
  w("DepositAmt.", 491.1, top),
  w("ClosingBalance", 564.3, top),
];

/** Account/customer/period header that prefixes the table. */
const STMT_HEADER_WORDS = [
  w("MR.", 100, 100),
  w("PRATEEKARYAN", 130, 100),
  w("AccountNo", 250, 120),
  w(":", 320, 120),
  w("50100404492491", 330, 120),
  w("StatementFrom", 100, 200),
  w(":", 200, 200),
  w("01/04/2025", 210, 200),
  w("To", 280, 200),
  w(":", 295, 200),
  w("31/03/2026", 305, 200),
];

/**
 * One-page sample with 5 transactions:
 * - 2 small UPI debits to MSREEPRAKASH (Q911356614@YBL)
 * - 1 SALARY credit (short narration — the bug we fixed in the prototype)
 * - 1 multi-line narration debit
 * - 1 large credit
 */
export function fixtureOnePageFiveTxns(): ExtractedPage {
  const words: PdfWord[] = [
    ...STMT_HEADER_WORDS,
    ...HEADER_WORDS(233.6),

    // Txn 1: UPI MSREEPRAKASH ₹17 OUT, balance 466,579.86
    w("01/04/25", 33.7, 252),
    w("UPI-MSREEPRAKASH-Q911356614@YBL-YESB0Y", 68, 252),
    w("0000623913994441", 292.6, 252),
    w("01/04/25", 362.5, 252),
    w("17.00", 452, 252),
    w("466,579.86", 591, 252),
    // Continuation line: BLUPI-... (no date, narration column only)
    w("BLUPI-623913994441-PAYMENTFROMPHONE", 68, 267),

    // Txn 2: UPI EMIRATESCHOCOLATES ₹18 OUT, balance 466,561.86
    w("01/04/25", 33.7, 285),
    w("UPI-EMIRATESCHOCOLATES", 68, 285),
    w("0000132495642794", 292.6, 285),
    w("01/04/25", 362.5, 285),
    w("18.00", 452, 285),
    w("466,561.86", 591, 285),

    // Txn 3: SALARY ₹2,10,976 IN, balance 226,261.51
    // (The famous short-narration credit that broke the Python prototype.)
    w("27/02/26", 33.7, 320),
    w("SALARY", 68, 320),
    w("0000000000516875", 292.6, 320),
    w("27/02/26", 362.5, 320),
    w("210,976.00", 512.2, 320),
    w("226,261.51", 590.7, 320),

    // Txn 4: Big OUT — FD booking
    w("05/01/26", 33.7, 350),
    w("FDBOOKED-50301274197369:PRATEEKARY", 68, 350),
    w("0000000000099999", 292.6, 350),
    w("05/01/26", 362.5, 350),
    w("1,400,000.00", 432, 350),
    w("100,000.00", 590, 350),

    // Txn 5: NEFT credit — Cisco salary
    w("25/04/25", 33.7, 380),
    w("NEFTCR-CHAS0INBX01-SALARYFORAPR2025", 68, 380),
    w("0000000000123456", 292.6, 380),
    w("25/04/25", 362.5, 380),
    w("114,266.00", 510, 380),
    w("214,266.00", 590, 380),

    // Footer noise that MUST be filtered out (top > 770)
    w("*Closingbalanceincludesfundsearmarkedforholdandunclearedfunds", 28.3, 794.9),
    w("StateaccountbranchGSTN:29AAACH2702H1ZW", 28.3, 805),
    w("HDFCBankHouse,SenapatiBapatMarg,LowerParel,Mumbai400013", 28.3, 815),
  ];

  return { pageNumber: 1, width: 612, height: 842, words };
}

/** Two-page sample: page 1 has full header + 2 txns; page 2 has only the table header + 1 txn. */
export function fixtureTwoPages(): [ExtractedPage, ExtractedPage] {
  const page1: ExtractedPage = {
    pageNumber: 1,
    width: 612,
    height: 842,
    words: [
      ...STMT_HEADER_WORDS,
      ...HEADER_WORDS(233.6),
      // Page 1 txn
      w("01/04/25", 33.7, 252),
      w("UPI-MSREEPRAKASH-Q911356614@YBL-YESB0Y", 68, 252),
      w("0000623913994441", 292.6, 252),
      w("01/04/25", 362.5, 252),
      w("17.00", 452, 252),
      w("466,579.86", 591, 252),
      w("01/04/25", 33.7, 285),
      w("UPI-EMIRATESCHOCOLATES", 68, 285),
      w("0000132495642794", 292.6, 285),
      w("01/04/25", 362.5, 285),
      w("18.00", 452, 285),
      w("466,561.86", 591, 285),
      // Footer noise on page 1
      w("HDFCBANKLIMITED", 28.3, 794.9),
    ],
  };

  const page2: ExtractedPage = {
    pageNumber: 2,
    width: 612,
    height: 842,
    words: [
      // Page 2 has the header repeated
      ...HEADER_WORDS(233.6),
      // Page 2 txn
      w("02/04/25", 33.7, 252),
      w("UPI-SHIVAMRAMSURAT", 68, 252),
      w("0000509232488227", 292.6, 252),
      w("02/04/25", 362.5, 252),
      w("15,872.00", 510, 252),
      w("482,433.86", 591, 252),
    ],
  };

  return [page1, page2];
}

/** Empty page (no header, no txns) — should yield nothing. */
export function fixtureEmptyPage(): ExtractedPage {
  return { pageNumber: 1, width: 612, height: 842, words: [] };
}
