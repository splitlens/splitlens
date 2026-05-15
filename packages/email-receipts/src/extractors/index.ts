export type { ExtractedInfo, MerchantExtractor } from "./types";
export { hdfcAlertExtractor } from "./hdfc-alert";
export { swiggyExtractor } from "./swiggy";
export { zomatoExtractor } from "./zomato";
export { credExtractor } from "./cred";
export { appleExtractor } from "./apple";
export { uberExtractor } from "./uber";
export { rapidoExtractor } from "./rapido";

import type { MerchantExtractor } from "./types";
import { hdfcAlertExtractor } from "./hdfc-alert";
import { swiggyExtractor } from "./swiggy";
import { zomatoExtractor } from "./zomato";
import { credExtractor } from "./cred";
import { appleExtractor } from "./apple";
import { uberExtractor } from "./uber";
import { rapidoExtractor } from "./rapido";

/**
 * Default registry — order matters for ambiguous senders (none today, but
 * future merchants may share a domain with a generic noreply). First-match
 * wins inside `findEmailsForTransaction`.
 */
export const DEFAULT_EXTRACTORS: MerchantExtractor[] = [
  hdfcAlertExtractor,
  swiggyExtractor,
  zomatoExtractor,
  credExtractor,
  appleExtractor,
  uberExtractor,
  rapidoExtractor,
];

/** Convenience: every sender any default extractor handles, lower-cased. */
export const KNOWN_MERCHANT_SENDERS: string[] = [
  ...new Set(DEFAULT_EXTRACTORS.flatMap((e) => e.senders.map((s) => s.toLowerCase()))),
];
