/**
 * HDFC Savings PDF parser. STUB — Week 2 will implement.
 *
 * The Python prototype lives at ~/finance/src/extract.py. This will be a port
 * that uses positional word extraction to identify column boundaries from the
 * header row, then assigns each word to a column by x-range.
 *
 * For now, returns empty result so the test suite has a target to fail against (TDD).
 */
import type { ParseResult } from "../types/index.js";
import type { ParseOptions } from "./index.js";

export async function parseHdfcSavings(
  _pdf: Uint8Array,
  _opts: ParseOptions = {},
): Promise<ParseResult> {
  // Intentional empty implementation. Week 2: port positional parser from Python.
  return {
    statement: null,
    transactions: [],
  };
}
