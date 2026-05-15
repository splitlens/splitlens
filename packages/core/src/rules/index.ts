/**
 * Categorization rules engine. STUB — Week 3 will port the full ruleset from Python.
 *
 * v1 ruleset (95+ rules) lives at ~/finance/src/rules.yaml in the prototype.
 */
import type { RawTransaction } from "../types/index";

export interface CategoryRule {
  /** Regex pattern matched against transaction narration (case-insensitive). */
  pattern: string;
  /** "Group:Subcategory" string, e.g. "Bills:Rent". */
  category: string;
  /** Lower number = higher priority. Default 100. */
  priority?: number;
  /** False to disable without deleting. Default true. */
  enabled?: boolean;
}

export interface CategorizeResult {
  category: string;
  matchedRule: string | null;
}

/**
 * Apply rules in priority order (lower number first), return first match.
 * Returns "Uncategorized" if no rule matches.
 */
export function categorize(narration: string, rules: CategoryRule[]): CategorizeResult {
  const sorted = [...rules]
    .filter((r) => r.enabled !== false)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of sorted) {
    const re = new RegExp(rule.pattern, "i");
    if (re.test(narration)) {
      return { category: rule.category, matchedRule: rule.pattern };
    }
  }
  return { category: "Uncategorized", matchedRule: null };
}

export function categorizeMany(
  txns: Pick<RawTransaction, "narration">[],
  rules: CategoryRule[],
): CategorizeResult[] {
  return txns.map((t) => categorize(t.narration, rules));
}
