/**
 * Per-merchant extractor contract. Implementations live alongside this file
 * (one per merchant). The findEmails core dispatches to whichever extractor
 * claims a given sender; merchant logic stays isolated, so adding a new
 * source is one new file + one new entry in the registry.
 */
import type { FetchedEmail } from "../types";

export interface ExtractedInfo {
  /** Free-form merchant-specific structured fields. */
  fields: Record<string, unknown>;
  /** Short human-readable line for UIs that just want a label. */
  summary: string;
}

export interface MerchantExtractor {
  /** Stable id used in transaction_sources.source_type — e.g. "hdfc_alert", "swiggy_delivery". */
  id: string;
  /** Sender addresses (lower-case) that this extractor handles. */
  senders: string[];
  /** Optional case-insensitive subject substring filter. */
  subjectIncludes?: string;
  /**
   * Try to pull structured fields from this email. Return null if the email
   * doesn't look like the shape this extractor expects (e.g. a marketing
   * email from the same sender domain) — the caller falls back to score-only.
   */
  extract(email: FetchedEmail): ExtractedInfo | null;
}
