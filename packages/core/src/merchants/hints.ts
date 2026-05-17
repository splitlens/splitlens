/**
 * Static knowledge base mapping (merchant pattern + amount + cadence) to a
 * likely-product label.
 *
 * The bank statement never tells us what's behind an opaque merchant string
 * like "APPLE MEDIA SERVICES" — the only signal we get is the amount. So we
 * lean on prior knowledge: at ₹159/mo to Apple in India it's *probably*
 * iCloud+ 200GB (or Apple Arcade Family). These are hints — labelled with
 * confidence — never assertions. The user always has the final say.
 *
 * Adding a merchant: append to `MERCHANT_PRICE_HINTS` below. Each entry
 * maps a counterparty REGEX (case-insensitive) to a list of price points.
 * Each price point has an amount (INR), expected cadence(s), and a
 * label/confidence. The amount tolerance is ±1 INR for "high" confidence
 * matches.
 *
 * Pure data + pure lookup; no I/O.
 */

import type { CadenceKind } from "./cadence";

export type HintConfidence = "high" | "medium" | "low";

export interface PriceHint {
  amountInr: number;
  /** Cadences this price typically appears at. */
  cadences: ReadonlyArray<CadenceKind>;
  /** Human-readable product name. */
  label: string;
  confidence: HintConfidence;
  /** Optional category suggestion to fill the SmartSuggest category slot. */
  categoryHint?: string;
}

interface MerchantEntry {
  /** Case-insensitive substring or regex; matched against `counterparty`. */
  pattern: RegExp;
  /** Display name for the merchant when used in copy. */
  displayName: string;
  prices: ReadonlyArray<PriceHint>;
}

/**
 * India-specific price points. All amounts in INR. Confidence is editorial —
 * "high" means "no other product on this merchant shares this exact price
 * point at this cadence"; "medium" means "common but ambiguous"; "low"
 * means "this is one of many products at this price".
 */
const MERCHANT_PRICE_HINTS: ReadonlyArray<MerchantEntry> = [
  {
    pattern: /apple.*media|itunes|apple\.com\/bill/i,
    displayName: "Apple",
    prices: [
      // iCloud+ tiers (Apple India)
      { amountInr: 49, cadences: ["monthly"], label: "iCloud+ 50GB", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 149, cadences: ["monthly"], label: "iCloud+ 200GB", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 159, cadences: ["monthly"], label: "iCloud+ 200GB (or in-app sub)", confidence: "medium", categoryHint: "Subscriptions" },
      { amountInr: 749, cadences: ["monthly"], label: "iCloud+ 2TB", confidence: "high", categoryHint: "Subscriptions" },
      // Apple Music
      { amountInr: 99, cadences: ["monthly"], label: "Apple Music Individual (or Arcade)", confidence: "medium", categoryHint: "Subscriptions" },
      { amountInr: 149, cadences: ["monthly"], label: "Apple Music Family", confidence: "medium", categoryHint: "Subscriptions" },
      { amountInr: 59, cadences: ["monthly"], label: "Apple Music Student", confidence: "high", categoryHint: "Subscriptions" },
      // Apple One
      { amountInr: 195, cadences: ["monthly"], label: "Apple One Individual", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 365, cadences: ["monthly"], label: "Apple One Family", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 719, cadences: ["monthly"], label: "Apple One Premier", confidence: "high", categoryHint: "Subscriptions" },
      // Apple TV+
      { amountInr: 99, cadences: ["monthly"], label: "Apple TV+ (or Music / Arcade)", confidence: "low", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /google.*play|play\.google|google.*one|youtube.*premium|googleone/i,
    displayName: "Google",
    prices: [
      { amountInr: 59, cadences: ["monthly"], label: "Google One 100GB", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 130, cadences: ["monthly"], label: "Google One 200GB", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 650, cadences: ["monthly"], label: "Google One 2TB", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 129, cadences: ["monthly"], label: "YouTube Premium Individual", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 189, cadences: ["monthly"], label: "YouTube Premium Family", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 79, cadences: ["monthly"], label: "YouTube Premium Student", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /netflix/i,
    displayName: "Netflix",
    prices: [
      { amountInr: 149, cadences: ["monthly"], label: "Netflix Mobile", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 199, cadences: ["monthly"], label: "Netflix Basic", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 499, cadences: ["monthly"], label: "Netflix Standard", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 649, cadences: ["monthly"], label: "Netflix Premium", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /spotify/i,
    displayName: "Spotify",
    prices: [
      { amountInr: 119, cadences: ["monthly"], label: "Spotify Individual", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 179, cadences: ["monthly"], label: "Spotify Duo", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 199, cadences: ["monthly"], label: "Spotify Family", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 59, cadences: ["monthly"], label: "Spotify Student", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /hotstar|disney/i,
    displayName: "Disney+ Hotstar",
    prices: [
      { amountInr: 299, cadences: ["yearly"], label: "Hotstar Mobile (yearly)", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 899, cadences: ["yearly"], label: "Hotstar Super (yearly)", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 1499, cadences: ["yearly"], label: "Hotstar Premium (yearly)", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /amazon.*prime|primevideo|amzn.*prime/i,
    displayName: "Amazon Prime",
    prices: [
      { amountInr: 299, cadences: ["monthly"], label: "Amazon Prime monthly", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 599, cadences: ["quarterly"], label: "Amazon Prime quarterly", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 1499, cadences: ["yearly"], label: "Amazon Prime yearly", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /openai|chatgpt/i,
    displayName: "OpenAI",
    prices: [
      { amountInr: 1650, cadences: ["monthly"], label: "ChatGPT Plus", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 16500, cadences: ["monthly"], label: "ChatGPT Team (per seat)", confidence: "medium", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /notion/i,
    displayName: "Notion",
    prices: [
      { amountInr: 800, cadences: ["monthly"], label: "Notion Plus", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 1200, cadences: ["monthly"], label: "Notion Business", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /figma/i,
    displayName: "Figma",
    prices: [
      { amountInr: 1250, cadences: ["monthly"], label: "Figma Professional", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 3750, cadences: ["monthly"], label: "Figma Organization", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /linear/i,
    displayName: "Linear",
    prices: [
      { amountInr: 670, cadences: ["monthly"], label: "Linear Standard (per seat)", confidence: "medium", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /adobe/i,
    displayName: "Adobe",
    prices: [
      { amountInr: 4999, cadences: ["monthly"], label: "Adobe Creative Cloud All Apps", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 1675, cadences: ["monthly"], label: "Adobe Photography Plan", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /microsoft.*365|office.*365|m365/i,
    displayName: "Microsoft 365",
    prices: [
      { amountInr: 489, cadences: ["monthly"], label: "Microsoft 365 Personal", confidence: "high", categoryHint: "Subscriptions" },
      { amountInr: 619, cadences: ["monthly"], label: "Microsoft 365 Family", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /times.*prime|timesprime/i,
    displayName: "Times Prime",
    prices: [
      { amountInr: 1199, cadences: ["yearly"], label: "Times Prime yearly", confidence: "high", categoryHint: "Subscriptions" },
    ],
  },
  {
    pattern: /cult.*fit|cure.*fit/i,
    displayName: "Cult.fit",
    prices: [
      { amountInr: 999, cadences: ["monthly"], label: "Cult.fit LIVE monthly", confidence: "medium", categoryHint: "Subscriptions" },
      { amountInr: 6999, cadences: ["yearly"], label: "Cult.fit LIVE yearly", confidence: "medium", categoryHint: "Subscriptions" },
    ],
  },
];

/**
 * Best-match merchant entry for a counterparty string, or null when none.
 */
export function findMerchantEntry(
  counterparty: string | null | undefined,
): { displayName: string; prices: ReadonlyArray<PriceHint> } | null {
  if (!counterparty) return null;
  for (const entry of MERCHANT_PRICE_HINTS) {
    if (entry.pattern.test(counterparty)) {
      return { displayName: entry.displayName, prices: entry.prices };
    }
  }
  return null;
}

/**
 * Look up a likely product hint for `(counterparty, amount, cadence)`.
 *
 * Match policy:
 *   1. Amount must be within ±1 INR of a known price point.
 *   2. Cadence must overlap with the price point's cadences. When the
 *      observed cadence is `one_time` or `irregular`, we fall back to the
 *      merchant's most common cadence — better to suggest something than
 *      nothing for a freshly-seen merchant.
 *   3. Among matching candidates, the highest-confidence one wins; ties
 *      broken by tighter amount distance.
 */
export interface PriceHintMatch {
  label: string;
  confidence: HintConfidence;
  /** "Apple" / "Netflix" / etc. — for "this is most likely an APPLE charge" copy. */
  merchantDisplayName: string;
  categoryHint: string | null;
}

export function getPriceHint(
  counterparty: string | null | undefined,
  amountInr: number,
  cadence: CadenceKind,
): PriceHintMatch | null {
  const entry = findMerchantEntry(counterparty);
  if (!entry) return null;

  const amountRound = Math.round(amountInr);
  const inAmount = (p: PriceHint) => Math.abs(p.amountInr - amountRound) <= 1;
  const cadenceOk = (p: PriceHint) =>
    p.cadences.includes(cadence) ||
    cadence === "one_time" ||
    cadence === "irregular";

  const candidates = entry.prices
    .filter(inAmount)
    .filter(cadenceOk)
    .map((p) => ({ p, dist: Math.abs(p.amountInr - amountRound) }));

  if (candidates.length === 0) return null;

  const confRank: Record<HintConfidence, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  candidates.sort((a, b) => {
    const c = confRank[b.p.confidence] - confRank[a.p.confidence];
    if (c !== 0) return c;
    return a.dist - b.dist;
  });

  const top = candidates[0]!.p;
  return {
    label: top.label,
    confidence: top.confidence,
    merchantDisplayName: entry.displayName,
    categoryHint: top.categoryHint ?? null,
  };
}
