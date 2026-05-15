/**
 * Best-effort extraction of a human-readable name from a bank narration
 * line. Used by the /review queue rows when `counterparty` is null — the
 * UPI/NEFT/IMPS narration almost always has a name buried inside, and a
 * recognizable lede ("M Sree Prakash") is far more useful than "—".
 *
 * Pure — string in, string out. No state. Tested via the review surface.
 *
 * Examples:
 *   "UPI-M SREE PRAKASH-Q491102932@YBL-YESB0Y BLUPI-916470857576-PAYMENT FROM PHONE"
 *     → "M Sree Prakash"
 *   "UPI/SHILPA V/9876543210@axl/Payment for Zomato"
 *     → "Shilpa V"
 *   "IMPS-101234567890-RAHUL KUMAR-XX1234-TRANSFER"
 *     → "Rahul Kumar"
 *   "NEFT CR-HDFC0000123-COMPANY NAME LTD-SAL-ASDF1234"
 *     → "Company Name Ltd"
 *   "ATM CASH WITHDRAWAL"
 *     → null  (nothing extractable)
 */

/** Words that should stay all-caps after title-casing (initialisms, suffixes). */
const KEEP_UPPER = new Set([
  "UPI",
  "NEFT",
  "RTGS",
  "IMPS",
  "ATM",
  "POS",
  "VPA",
  "LTD",
  "PVT",
  "LLC",
  "LLP",
  "INC",
  "PLC",
  "CO",
  "II",
  "III",
  "IV",
]);

/** Single-letter tokens we keep upper ("M", "K", initials). */
function isInitial(token: string): boolean {
  return token.length === 1 && /^[A-Z]$/.test(token);
}

/**
 * Convert "M SREE PRAKASH" → "M Sree Prakash".
 * Conservative — preserves all-caps initialisms and single-letter initials.
 */
export function titleCaseName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((tok) => {
      const t = tok.replace(/[^A-Za-z'.&-]/g, "");
      if (t.length === 0) return tok;
      if (KEEP_UPPER.has(t.toUpperCase())) return t.toUpperCase();
      if (isInitial(t.toUpperCase())) return t.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

/** Lowercase fragments that signal "this segment is metadata, not a name". */
const META_FRAGMENTS = [
  "payment",
  "transfer",
  "salary",
  "credit",
  "debit",
  "withdrawal",
  "deposit",
  "refund",
  "imps",
  "neft",
  "rtgs",
  "upi",
  "phone",
  "atm",
  "pos",
  "cash",
  "interest",
  "charges",
  "tax",
  "gst",
  "fee",
];

function looksLikeMetadata(seg: string): boolean {
  const lower = seg.toLowerCase().trim();
  if (lower.length === 0) return true;
  if (/^\d+$/.test(lower)) return true; // pure numbers
  if (lower.includes("@")) return true; // VPA
  if (/^x+\d/i.test(lower)) return true; // masked account
  if (/^\d{4,}/.test(lower)) return true; // ref numbers
  // Any of the metadata fragments as a whole segment or majority of it.
  for (const f of META_FRAGMENTS) {
    if (lower === f || lower.startsWith(`${f} `) || lower.endsWith(` ${f}`)) {
      return true;
    }
  }
  return false;
}

function looksLikeName(seg: string): boolean {
  const trimmed = seg.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (looksLikeMetadata(trimmed)) return false;
  // Must contain at least one alphabetic token.
  if (!/[A-Za-z]{2,}/.test(trimmed)) return false;
  return true;
}

/**
 * Returns a clean human name extracted from the narration, or null when
 * nothing recognizable is in there. Always title-cased and trimmed.
 */
export function extractCounterpartyFromNarration(
  narration: string | null | undefined,
): string | null {
  if (!narration) return null;
  const trimmed = narration.trim();
  if (trimmed.length === 0) return null;

  // Common UPI/NEFT/IMPS framing: words separated by `-` or `/`. Pick the
  // FIRST segment that looks like a name. The leading segment is the
  // protocol marker ("UPI", "IMPS", "NEFT CR") — we skip past it.
  const separator = trimmed.includes("/") && !trimmed.startsWith("UPI-") ? "/" : "-";
  const segments = trimmed.split(separator);

  // Most layouts: position 1 is the name (position 0 is the protocol).
  // Some layouts have a date/ref/account in between — keep walking until
  // we find a name-shaped segment.
  for (let i = 1; i < Math.min(segments.length, 5); i++) {
    const seg = segments[i]!.trim();
    if (looksLikeName(seg)) {
      return titleCaseName(seg);
    }
  }

  // Fall back: take the longest alphabetic stretch in the whole string.
  const alphaRuns = trimmed.match(/[A-Z][A-Z .&'-]{2,}/g);
  if (alphaRuns) {
    const longest = alphaRuns
      .filter((s) => looksLikeName(s))
      .sort((a, b) => b.length - a.length)[0];
    if (longest) return titleCaseName(longest);
  }

  return null;
}

/**
 * Display-friendly counterparty for a transaction row. Prefers the
 * canonical `counterparty` value, falls back to a narration-extracted
 * name, and finally to null (callers should render "—" or a category-
 * derived label in that case).
 */
export function displayCounterparty(
  counterparty: string | null | undefined,
  narration: string | null | undefined,
): string | null {
  const c = counterparty?.trim();
  if (c && c.length > 0) return c;
  return extractCounterpartyFromNarration(narration);
}
