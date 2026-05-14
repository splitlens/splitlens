/**
 * @splitlens/core — framework-free TypeScript core for SplitLens.
 *
 * Submodules:
 *   - types       Shared TypeScript types
 *   - parsers     Bank statement PDF parsers
 *   - rules       Categorization rules engine
 *   - settlement  Per-person settlement math
 *
 * Pure functions only. No DOM, no Node-specific imports, no I/O.
 * Bring your own PDF text extractor (PDF.js for browser, pdf-parse for Node).
 */
export * from "./types/index.js";
export * from "./parsers/index.js";
export * from "./rules/index.js";
export * from "./settlement/index.js";
