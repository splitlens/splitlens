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

export interface Person {
  /** Stable id, lowercase, e.g. "rahul" */
  id: string;
  displayName: string;
  /** Regex patterns that match narration of payments to/from this person. */
  upiPatterns: string[];
}

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
