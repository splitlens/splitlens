/**
 * Shared types for the email-receipts fetcher. Intentionally minimal — the
 * fetcher is a thin retrieval layer; merchant-specific parsing happens in
 * downstream code that consumes these records.
 */

/** A single fetched email, normalized away from imapflow's raw shape. */
export interface FetchedEmail {
  /** Globally unique Message-Id header. Used for dedup across fetches. */
  messageId: string;
  /** ISO 8601 timestamp from the message's Date header. */
  date: string;
  /** From: header verbatim (e.g. "Blinkit <noreply@blinkit.com>"). */
  fromRaw: string;
  /** Just the address part of the From: header, lower-cased. */
  fromAddress: string;
  subject: string;
  /** Plain-text body. Always populated — mailparser falls back from HTML if needed. */
  text: string;
  /** Raw HTML body, when the email is HTML. */
  html: string | null;
  /** Size in bytes of the message source (for diagnostics). */
  size: number;
}

export interface ImapAuth {
  /** Gmail address. */
  user: string;
  /**
   * App Password — generated at https://myaccount.google.com/apppasswords.
   * NOT your regular Google password; standard Gmail auth refuses these now.
   */
  password: string;
  /** IMAP server. Defaults to Gmail. */
  host?: string;
  /** IMAP port. Defaults to 993 (TLS). */
  port?: number;
  /** TLS. Defaults to true. */
  secure?: boolean;
}

export interface FetchOptions {
  /** Lower-cased sender address to filter on (e.g. "noreply@blinkit.com"). */
  fromAddress: string;
  /**
   * Optional case-insensitive substring filter on the Subject header. Useful
   * for senders who blast both order receipts AND marketing from the same
   * address — e.g. `noreply@swiggy.in` sends "Your Swiggy order was delivered"
   * (which we want) and "How else will we know, Prateek? 🥺" (which we don't).
   */
  subjectContains?: string;
  /** Only return messages newer than this many days. Default 90. */
  sinceDays?: number;
  /** Hard cap on returned messages. Default 200. */
  maxMessages?: number;
}
