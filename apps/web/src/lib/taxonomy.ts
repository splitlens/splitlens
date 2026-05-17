/**
 * Curated category + recurrence taxonomy for SplitLens.
 *
 * The "category" string in the DB used to be free-text (e.g.
 * `Food:Restaurant`). With the multi-dimensional categorization model the
 * "what is this for?" question is a closed set defined here. Free-text
 * legacy values still display fine (they map to "Other" with the fallback
 * cosmetics), but the picker only offers these.
 *
 * If you need a new top-level category, add it here — the chip picker,
 * monthly bar legend, and category coloring all pull from this file.
 */

export interface CategoryDef {
  /** Canonical id stored in `transactions.category`. */
  id: string;
  /** Display name shown on chips + legends. */
  label: string;
  /** Single-glyph emoji for the chip. */
  emoji: string;
  /** Tailwind classes for the chip background + text. */
  chip: string;
  /** Tailwind class for the legend dot / bar segment. */
  bar: string;
  /** Optional one-line hint to disambiguate. */
  hint?: string;
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: "Groceries",
    label: "Groceries",
    emoji: "🛒",
    chip: "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900/50 dark:bg-lime-950/40 dark:text-lime-200",
    bar: "bg-lime-400 dark:bg-lime-500",
    hint: "Supermarket, quick-commerce, kirana",
  },
  {
    id: "Food",
    label: "Food",
    emoji: "🍽️",
    chip: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-200",
    bar: "bg-orange-400 dark:bg-orange-500",
    hint: "Eating out, food delivery",
  },
  {
    id: "Household",
    label: "Household",
    emoji: "🏠",
    chip: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200",
    bar: "bg-indigo-400 dark:bg-indigo-500",
    hint: "Rent, gas, electricity, water, maid, cook",
  },
  {
    id: "Healthcare",
    label: "Healthcare",
    emoji: "🏥",
    chip: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200",
    bar: "bg-rose-400 dark:bg-rose-500",
    hint: "Doctors, medicines, hospitals, insurance",
  },
  {
    id: "Tech",
    label: "Tech",
    emoji: "💻",
    chip: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200",
    bar: "bg-sky-400 dark:bg-sky-500",
    hint: "Gadgets, hardware, accessories",
  },
  {
    id: "Subscriptions",
    label: "Subscriptions",
    emoji: "🔁",
    chip: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200",
    bar: "bg-violet-400 dark:bg-violet-500",
    hint: "Streaming, software, magazines",
  },
  {
    id: "Travel",
    label: "Travel",
    emoji: "✈️",
    chip: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900/50 dark:bg-cyan-950/40 dark:text-cyan-200",
    bar: "bg-cyan-400 dark:bg-cyan-500",
    hint: "Flights, hotels, tickets",
  },
  {
    id: "Transport",
    label: "Transport",
    emoji: "🚕",
    chip: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200",
    bar: "bg-yellow-400 dark:bg-yellow-500",
    hint: "Cabs, fuel, parking, metro",
  },
  {
    id: "Shopping",
    label: "Shopping",
    emoji: "🛍️",
    chip: "border-pink-200 bg-pink-50 text-pink-800 dark:border-pink-900/50 dark:bg-pink-950/40 dark:text-pink-200",
    bar: "bg-pink-400 dark:bg-pink-500",
    hint: "Clothes, retail, gifts for self",
  },
  {
    id: "Skills",
    label: "Skills",
    emoji: "📚",
    chip: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200",
    bar: "bg-blue-400 dark:bg-blue-500",
    hint: "Courses, books, gym, classes",
  },
  {
    id: "PersonalCare",
    label: "Personal Care",
    emoji: "🧴",
    chip: "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900/50 dark:bg-purple-950/40 dark:text-purple-200",
    bar: "bg-purple-400 dark:bg-purple-500",
    hint: "Salon, grooming, fitness",
  },
  {
    id: "Entertainment",
    label: "Entertainment",
    emoji: "🎬",
    chip: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/40 dark:text-fuchsia-200",
    bar: "bg-fuchsia-400 dark:bg-fuchsia-500",
    hint: "Movies, concerts, events",
  },
  {
    id: "Finance",
    label: "Finance",
    emoji: "💳",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
    bar: "bg-emerald-400 dark:bg-emerald-500",
    hint: "Bank fees, EMI, taxes, investments",
  },
  {
    id: "Transfer",
    label: "Transfer",
    emoji: "↔️",
    chip: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-200",
    bar: "bg-teal-400 dark:bg-teal-500",
    hint: "P2P, self-transfer, friend repayments",
  },
  {
    id: "Gifts",
    label: "Gifts",
    emoji: "🎁",
    chip: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
    bar: "bg-red-400 dark:bg-red-500",
    hint: "Gifts, donations, charity",
  },
  {
    id: "Income",
    label: "Income",
    emoji: "💰",
    chip: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200",
    bar: "bg-green-400 dark:bg-green-500",
    hint: "Salary, refunds, dividends",
  },
];

export const OTHER_CATEGORY: CategoryDef = {
  id: "Other",
  label: "Other",
  emoji: "•",
  chip: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  bar: "bg-zinc-400 dark:bg-zinc-500",
};

export const UNCATEGORIZED: CategoryDef = {
  id: "",
  label: "Uncategorized",
  emoji: "❔",
  chip: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  bar: "bg-zinc-300 dark:bg-zinc-600",
};

const CATEGORY_BY_ID: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

/**
 * Color palette for custom categories. Each entry maps to a Tailwind hue
 * family — both the chip class set (border + bg + text in light + dark)
 * and the solid bar class for the legend dot / bar segment. Stays in sync
 * with the inline cosmetics on the curated CATEGORIES above; if you add a
 * key here, both the chip and the bar follow.
 */
export const COLOR_PALETTE_KEYS = [
  "rose",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "red",
] as const;
export type ColorKey = (typeof COLOR_PALETTE_KEYS)[number];

function cosmeticsForColorKey(key: string): { chip: string; bar: string } {
  // We rely on Tailwind picking up these strings via the static safelist at
  // build time. Keeping the mapping table explicit ensures the JIT compiler
  // actually emits the classes (it can't follow dynamic concatenation).
  const map: Record<string, { chip: string; bar: string }> = {
    rose: {
      chip: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200",
      bar: "bg-rose-400 dark:bg-rose-500",
    },
    orange: {
      chip: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-200",
      bar: "bg-orange-400 dark:bg-orange-500",
    },
    amber: {
      chip: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
      bar: "bg-amber-400 dark:bg-amber-500",
    },
    yellow: {
      chip: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200",
      bar: "bg-yellow-400 dark:bg-yellow-500",
    },
    lime: {
      chip: "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900/50 dark:bg-lime-950/40 dark:text-lime-200",
      bar: "bg-lime-400 dark:bg-lime-500",
    },
    green: {
      chip: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200",
      bar: "bg-green-400 dark:bg-green-500",
    },
    emerald: {
      chip: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
      bar: "bg-emerald-400 dark:bg-emerald-500",
    },
    teal: {
      chip: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-200",
      bar: "bg-teal-400 dark:bg-teal-500",
    },
    cyan: {
      chip: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900/50 dark:bg-cyan-950/40 dark:text-cyan-200",
      bar: "bg-cyan-400 dark:bg-cyan-500",
    },
    sky: {
      chip: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200",
      bar: "bg-sky-400 dark:bg-sky-500",
    },
    blue: {
      chip: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200",
      bar: "bg-blue-400 dark:bg-blue-500",
    },
    indigo: {
      chip: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200",
      bar: "bg-indigo-400 dark:bg-indigo-500",
    },
    violet: {
      chip: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200",
      bar: "bg-violet-400 dark:bg-violet-500",
    },
    purple: {
      chip: "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900/50 dark:bg-purple-950/40 dark:text-purple-200",
      bar: "bg-purple-400 dark:bg-purple-500",
    },
    fuchsia: {
      chip: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/40 dark:text-fuchsia-200",
      bar: "bg-fuchsia-400 dark:bg-fuchsia-500",
    },
    pink: {
      chip: "border-pink-200 bg-pink-50 text-pink-800 dark:border-pink-900/50 dark:bg-pink-950/40 dark:text-pink-200",
      bar: "bg-pink-400 dark:bg-pink-500",
    },
    red: {
      chip: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
      bar: "bg-red-400 dark:bg-red-500",
    },
  };
  return map[key] ?? map.indigo!;
}

/** Build a CategoryDef from a row in `custom_categories`. */
export function categoryFromCustom(row: {
  id: string;
  label: string;
  emoji: string;
  colorKey: string;
  hint: string | null;
}): CategoryDef {
  const { chip, bar } = cosmeticsForColorKey(row.colorKey);
  return {
    id: row.id,
    label: row.label,
    emoji: row.emoji,
    chip,
    bar,
    hint: row.hint ?? undefined,
  };
}

/** In-process index of custom categories, set by ReviewLayout on mount. */
let CUSTOM_CATEGORIES_INDEX: Record<string, CategoryDef> = {};

/** Called by the client component(s) so legacy lookups + getCategory() can
 * resolve user-added entries. Re-runs on every fresh render of the layout
 * with the latest list from the server. */
export function setCustomCategoriesIndex(defs: CategoryDef[]): void {
  CUSTOM_CATEGORIES_INDEX = Object.fromEntries(defs.map((d) => [d.id, d]));
}

/**
 * Look up a category definition by id. Order: curated → custom → legacy
 * namespace prefix → "Other" fallback. Custom categories override curated
 * if (somehow) the ids collide, since the user-defined version is more
 * specific.
 */
export function getCategory(id: string | null | undefined): CategoryDef {
  if (!id) return UNCATEGORIZED;
  if (CUSTOM_CATEGORIES_INDEX[id]) return CUSTOM_CATEGORIES_INDEX[id]!;
  if (CATEGORY_BY_ID[id]) return CATEGORY_BY_ID[id]!;
  // Legacy namespace fallback — match "Food" prefix of "Food:Restaurant".
  const head = id.split(":")[0]!.trim();
  if (CATEGORY_BY_ID[head]) return CATEGORY_BY_ID[head]!;
  return { ...OTHER_CATEGORY, label: id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurrence taxonomy
// ─────────────────────────────────────────────────────────────────────────────

export type RecurrenceId =
  | "one_time"
  | "monthly"
  | "weekly"
  | "quarterly"
  | "yearly";

export interface RecurrenceDef {
  id: RecurrenceId;
  label: string;
  emoji: string;
  /** Tailwind class for the recurrence chip. */
  chip: string;
  bar: string;
  hint: string;
}

export const RECURRENCES: RecurrenceDef[] = [
  {
    id: "one_time",
    label: "One-time",
    emoji: "💫",
    chip: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    bar: "bg-zinc-400 dark:bg-zinc-500",
    hint: "One-off spend",
  },
  {
    id: "weekly",
    label: "Weekly",
    emoji: "📅",
    chip: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
    bar: "bg-amber-400 dark:bg-amber-500",
    hint: "Repeats every week",
  },
  {
    id: "monthly",
    label: "Monthly",
    emoji: "🔁",
    chip: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200",
    bar: "bg-indigo-400 dark:bg-indigo-500",
    hint: "Rent, salary, subscriptions",
  },
  {
    id: "quarterly",
    label: "Quarterly",
    emoji: "🗓",
    chip: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200",
    bar: "bg-sky-400 dark:bg-sky-500",
    hint: "Every 3 months",
  },
  {
    id: "yearly",
    label: "Yearly",
    emoji: "🎯",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
    bar: "bg-emerald-400 dark:bg-emerald-500",
    hint: "Insurance, annual fees",
  },
];

const RECURRENCE_BY_ID: Record<string, RecurrenceDef> = Object.fromEntries(
  RECURRENCES.map((r) => [r.id, r]),
);

export function getRecurrence(id: string | null | undefined): RecurrenceDef {
  if (!id) return RECURRENCES[0]!; // one_time
  return RECURRENCE_BY_ID[id] ?? RECURRENCES[0]!;
}

export function isValidRecurrence(s: unknown): s is RecurrenceId {
  return (
    typeof s === "string" &&
    ["one_time", "monthly", "weekly", "quarterly", "yearly"].includes(s)
  );
}
