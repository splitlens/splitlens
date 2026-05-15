/**
 * Shared types for SplitLens core. Framework-free, no DOM, no Node-specific imports.
 */

/** ISO YYYY-MM-DD */
export type ISODate = string;

/**
 * One word extracted from a PDF, with positional info.
 * Coordinates are in PDF points; origin is top-left (matches pdfplumber + pdfjs).
 */
export interface PdfWord {
  text: string;
  /** left edge */
  x0: number;
  /** right edge */
  x1: number;
  /** top edge (PDF y-axis: top is small, bottom is large — same as pdfplumber convention) */
  top: number;
  /** bottom edge */
  bottom: number;
}

export interface ExtractedPage {
  pageNumber: number;
  width: number;
  height: number;
  words: PdfWord[];
}

/**
 * Credit-card transaction. Distinct from RawTransaction because CC statements
 * have a different shape (no running balance; amount is signed; FCY support;
 * rewards points; payment vs purchase distinction).
 */
export interface CcRawTransaction {
  /** ISO YYYY-MM-DD */
  txnDate: ISODate;
  /** HH:MM, or null for batch-posted charges */
  txnTime: string | null;
  /** Merchant / description text */
  description: string;
  /** Always positive in INR. is_payment distinguishes credit vs debit. */
  amount: number;
  /** True = credit to card (autopay/refund); False = purchase or charge */
  isPayment: boolean;
  /** True = international purchase (foreign currency) */
  isInternational: boolean;
  /** e.g., "USD 118.00" — only set for international transactions */
  foreignAmount?: string;
  /** True = IGST/CGST/SGST, FCY markup, EMI fee, finance charge, etc. */
  isCharge: boolean;
  /** Reward points earned, if any */
  rewards?: number;
  /** 0-based index within the source PDF */
  sourceRowIdx: number;
}

export interface CcStatement {
  bank: string;
  cardType: string; // 'Regalia', 'Millennia', etc.
  cardLast4: string;
  customerName?: string;
  statementDate?: ISODate;
  periodFrom?: ISODate;
  periodTo?: ISODate;
  totalAmountDue?: number;
  minimumDue?: number;
  dueDate?: ISODate;
  creditLimit?: number;
  availableCredit?: number;
}

export interface CcParseResult {
  statement: CcStatement | null;
  transactions: CcRawTransaction[];
}

export type Direction = "in" | "out";

export interface RawTransaction {
  /** ISO YYYY-MM-DD */
  txnDate: ISODate;
  /** Bank's value date (when funds settle); often same as txnDate. */
  valueDate?: ISODate;
  /** Bank's narration / description string */
  narration: string;
  /** Withdrawal amount in INR (positive). Null if this is a deposit. */
  withdrawal: number | null;
  /** Deposit amount in INR (positive). Null if this is a withdrawal. */
  deposit: number | null;
  /** Closing balance after this transaction (savings only). */
  closingBalance?: number;
  /** Bank-provided reference number, if any. */
  refNo?: string;
  /** 0-based index within the source PDF, used for idempotent ingestion. */
  sourceRowIdx: number;
}

export interface ParsedStatement {
  bank: string;
  accountType: "savings" | "credit_card";
  accountLast4: string;
  customerName?: string;
  periodFrom?: ISODate;
  periodTo?: ISODate;
}

export interface ParseResult {
  statement: ParsedStatement | null;
  transactions: RawTransaction[];
}

/**
 * PhonePe statement transaction. Has the time-of-day and UTR that bank PDFs
 * lack — used downstream to enrich matching bank rows.
 *
 * Matching strategy: UTR → bank `refNo` exact match; fall back to
 * (txnDate, amount, direction) when UTR isn't present in the bank narration.
 */
export interface PhonePeRawTransaction {
  /** ISO YYYY-MM-DD */
  txnDate: ISODate;
  /** HH:MM (24-hour). Always present — every PhonePe row has a time. */
  txnTime: string;
  /** "in" = received credit, "out" = paid debit */
  direction: Direction;
  /** Raw counterparty string: a name, a UPI VPA, or a masked account "******1234". */
  counterparty: string;
  /** Positive INR amount */
  amount: number;
  /** UPI reference number — primary join key against bank refNo. */
  utr: string;
  /** PhonePe-internal transaction id (varies in length: alphanumeric). */
  transactionId: string;
  /**
   * Linked bank-account last 4 digits ("2491" when source line was
   * "Debited from XX2491"). Null for wallet-only transactions.
   */
  sourceAccountLast4: string | null;
  /**
   * Coarse counterparty classification:
   *   - "bill"          → "Bill paid - <service>" row
   *   - "self_transfer" → counterparty is a masked account "******1234"
   *   - "vpa"           → counterparty contains '@' (UPI VPA like "merchant@axisbank")
   *   - "named"         → anything else (person name or branded merchant)
   */
  kind: "bill" | "self_transfer" | "vpa" | "named";
  /**
   * When the payment was split across two funding sources (linked bank +
   * wallet, or two linked accounts), the raw breakdown verbatim — e.g.
   * "INR 20.24 | Wallet INR 39.76". Null when the txn came entirely from
   * the linked bank shown in `sourceAccountLast4`. Used downstream to
   * reconcile against the bank ledger (which only sees the bank portion).
   */
  splitSourceRaw: string | null;
  /** 0-based index within the source PDF, for idempotent ingestion. */
  sourceRowIdx: number;
}

export interface PhonePeStatement {
  /** "+91XXXXXXXXXX" if found on page 1. */
  phoneNumber?: string;
  periodFrom?: ISODate;
  periodTo?: ISODate;
}

export interface PhonePeParseResult {
  statement: PhonePeStatement | null;
  transactions: PhonePeRawTransaction[];
}

// NOTE: Person type lives in `../people/registry` (richer, with relationship +
// aliases). Re-imported by settlement directly. This file used to define a
// thinner version; removed to avoid the duplicate-export ambiguity at the
// barrel level.

export interface SharedTransaction {
  id: number;
  amount: number;
  /** Lowercase person ids who share this expense (excluding the payer/me). */
  sharedWith: string[];
  /** Total people INCLUDING me. share_count=3 → 3-way split. */
  shareCount: number;
  direction: Direction;
}

export interface SettlementEntry {
  /** Total amount others owe me (sum of their shares of expenses I paid for). */
  owesMe: number;
  /** Repayments received from this person (matched via UPI patterns). */
  paidBack: number;
  /** Net = owesMe - paidBack. Positive = they owe me. Negative = I owe them. */
  net: number;
}

export type Settlement = Record<string, SettlementEntry>;
