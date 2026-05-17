/**
 * @splitlens/core — framework-free TypeScript core for SplitLens.
 *
 * Submodules:
 *   - types       Shared TypeScript types
 *   - parsers     Bank statement PDF parsers
 *   - rules       Categorization rules engine
 *   - settlement  Per-person settlement math
 *   - people      Person registry + UPI matching
 *   - merchants   Merchant cadence + history + product hints (SmartSuggest)
 *   - location    Google Timeline matcher + online-merchant predicate
 *
 * Pure functions only. No DOM, no Node-specific imports, no I/O.
 * Bring your own PDF text extractor (PDF.js for browser, pdf-parse for Node).
 */
export * from "./types/index";
export * from "./parsers/index";
export * from "./rules/index";
export * from "./settlement/index";
export * from "./people/index";
export * from "./merchants/index";
export * from "./location/index";
