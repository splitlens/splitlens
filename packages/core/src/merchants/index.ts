/**
 * Merchant intelligence — pure data + pure functions for SmartSuggest's
 * "what is this charge really" panel. See:
 *
 *   - cadence.ts  → "every 30 days" / "yearly" / "irregular" detection
 *   - history.ts  → lifetime summary (count, total, distinct amounts)
 *   - hints.ts    → static merchant + price-point knowledge base
 */
export * from "./cadence";
export * from "./history";
export * from "./hints";
