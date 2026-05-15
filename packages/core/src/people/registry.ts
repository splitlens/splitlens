/**
 * Known-people registry.
 *
 * Each registered person lets the ingestion pipeline tag transactions with a
 * stable identity, separate from the category. Same person across multiple
 * UPI handles or narration spellings → same person_id.
 *
 * IMPORTANT distinction from rules.ts: this is about WHO, not WHAT.
 * A txn to Rahul gets:
 *   category: "Bills:Rent (flatmate share)"   ← business purpose
 *   person_id: "rahul"                         ← identity
 * Both are correct and orthogonal.
 *
 * Add new people here as you identify recurring counterparties. Each entry
 * needs at least one regex pattern that uniquely matches that person's
 * narrations. Aliases are documentation-only (helpful when scanning).
 */

export type Relationship =
  | "family"
  | "friend"
  | "flatmate"
  | "partner"
  | "colleague"
  | "domestic_help"
  | "other";

export interface Person {
  /** Stable lowercase slug. Used as the foreign key in transactions.person_id. */
  id: string;
  /** Full name as you'd address them. */
  displayName: string;
  /** Lifestyle classification. Drives downstream filters ("show only friends", etc.). */
  relationship: Relationship;
  /**
   * Regex patterns matched (case-insensitive) against transaction narration.
   * First match wins across the whole registry. Patterns are TRUSTED
   * — they're hand-curated, not user input.
   */
  upiPatterns: string[];
  /** Optional human-readable aliases / known UPI handles, for documentation. */
  aliases?: string[];
  /** Free-form note for context. */
  notes?: string;
}

export const DEFAULT_PEOPLE: Person[] = [
  // ---- Flatmates (current) ----
  {
    id: "rahul",
    displayName: "Rahul Kumar",
    relationship: "flatmate",
    aliases: ["RAHUL.GR8DPS@OKHDFCBANK", "9525680445@YBL", "9525680445@AXL"],
    upiPatterns: ["RAHUL.*?(9525680445|RAHUL\\.GR8DPS)"],
    notes: "3BHK flatmate. Same person across 3 UPI handles, all routing to HDFC0000235.",
  },
  {
    id: "shivam-mishra",
    displayName: "Shivam Mishra",
    relationship: "flatmate",
    aliases: ["SHIVAMRAMSURAT", "SHIVAMWA786@OKSBI", "SHIVAMWA321@OKICICI"],
    upiPatterns: ["SHIVAMRAMSURAT|SHIVAMWA786|SHIVAMWA321"],
    notes: "Joined as 3rd flatmate Dec 2025; was a friend before then.",
  },

  // ---- Domestic help ----
  {
    id: "bethprasad",
    displayName: "Bethprasad Kadel",
    relationship: "domestic_help",
    aliases: ["BEDKADEL88@OKSBI", "9886619181@AXL"],
    upiPatterns: ["BETHPRASAD ?KADEL|BEDKADEL"],
    notes: "Cook + maid for the flat. ~₹9K/mo.",
  },

  // ---- Family ----
  {
    id: "neha-singh",
    displayName: "Neha Upendra Singh",
    relationship: "family",
    upiPatterns: ["NEHAUPENDRASINGH|NEHA UPENDRA SINGH"],
  },
  {
    id: "saransh-sinha",
    displayName: "Saransh Sinha",
    relationship: "family",
    upiPatterns: ["SARANSHSINHA|SARANSH SINHA"],
  },
  {
    id: "pooja-ramsurat",
    displayName: "Pooja Ramsurat",
    relationship: "family",
    upiPatterns: ["POOJARAMSURAT"],
  },
  {
    id: "mahendra-sinha",
    displayName: "Mahendra Kumar Sinha",
    relationship: "family",
    upiPatterns: ["MAHENDRAKUMAR ?SINHA"],
  },

  // ---- Friends (user-named at ingestion-design time) ----
  {
    id: "mayank-wali",
    displayName: "Mayank Wali",
    relationship: "friend",
    aliases: ["WALIMAYANK@YBL"],
    upiPatterns: ["MAYANK ?WALI", "WALIMAYANK"],
  },
  {
    id: "shreya-agrawal",
    displayName: "Shreya Agrawal",
    relationship: "friend",
    upiPatterns: ["SHREYA ?AGRAWAL", "SHREYAAGRAWAL", "SHREYA AGRAWAL"],
  },
  {
    id: "sitanshu-sinha",
    displayName: "Sitanshu Sinha",
    relationship: "friend",
    aliases: ["8092735101@AXL"],
    upiPatterns: ["KUMAR ?SITANSHU|SITANSHU ?SINHA|SITANSHUKUMAR|8092735101"],
  },
];

export interface PersonMatch {
  /** The matched person's id. */
  personId: string;
  /** Display name (denormalized for fast lookup without re-joining the registry). */
  displayName: string;
  /** Which regex pattern matched — useful for traceability ("why was this tagged?"). */
  matchedPattern: string;
}

/**
 * Identify the person involved in a transaction by matching the narration
 * against the registry. First-matching person wins (registry order is preserved).
 *
 * Returns null when no registered person matches. NULL is the correct answer for
 * unknown counterparties — we don't auto-create new people from regex fallbacks
 * because that creates a sea of low-confidence "people" who are really just
 * one-off vendors.
 */
export function identifyPerson(
  narration: string,
  registry: Person[] = DEFAULT_PEOPLE,
): PersonMatch | null {
  for (const person of registry) {
    for (const pattern of person.upiPatterns) {
      if (new RegExp(pattern, "i").test(narration)) {
        return {
          personId: person.id,
          displayName: person.displayName,
          matchedPattern: pattern,
        };
      }
    }
  }
  return null;
}

/** Quick lookup helper — get the full Person record by id. */
export function getPersonById(
  personId: string,
  registry: Person[] = DEFAULT_PEOPLE,
): Person | undefined {
  return registry.find((p) => p.id === personId);
}
