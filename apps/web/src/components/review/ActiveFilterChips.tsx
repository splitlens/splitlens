"use client";

/**
 * ActiveFilterChips — the row of removable chips just under the progress
 * meter on the review page. Mirrors a pattern from Linear / Notion: every
 * active filter is shown as a chip; clicking the × on a chip removes that
 * one filter; "Clear all" wipes everything.
 *
 * No internal state — props in, callbacks out. The parent owns the URL
 * state and applies the patch.
 */
import type { ReviewListFilter, ReviewFilterMeta, TimeBuckets } from "@/lib/review-repo";
import { MONTH_SHORT } from "@/lib/review-time";

export interface ActiveFilterChipsProps {
  filter: ReviewListFilter;
  buckets: TimeBuckets;
  meta: ReviewFilterMeta;
  people: Array<{ id: string; displayName: string }>;
  onFilterChange: (patch: Partial<ReviewListFilter & { unreviewed: boolean }>) => void;
}

export function ActiveFilterChips({
  filter,
  buckets,
  meta,
  people,
  onFilterChange,
}: ActiveFilterChipsProps) {
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];

  // Time selection (year / month / day, derived from from + to)
  const timeLabel = describeTimeSelection(buckets);
  if (timeLabel) {
    chips.push({
      key: "time",
      label: timeLabel,
      clear: () => onFilterChange({ from: null, to: null, timeOfDay: null }),
    });
  }

  if (filter.timeOfDay) {
    chips.push({
      key: "tod",
      label: capitalize(filter.timeOfDay),
      clear: () => onFilterChange({ timeOfDay: null }),
    });
  }

  if (filter.category) {
    chips.push({
      key: "cat",
      label: filter.category,
      clear: () => onFilterChange({ category: null }),
    });
  }

  if (filter.accountId != null) {
    const acc = meta.accounts.find((a) => a.id === filter.accountId);
    chips.push({
      key: "acc",
      label: acc ? `${acc.bank} •••${acc.last4}` : `Account #${filter.accountId}`,
      clear: () => onFilterChange({ accountId: null }),
    });
  }

  if (filter.personId) {
    const p = people.find((pp) => pp.id === filter.personId);
    chips.push({
      key: "person",
      label: p?.displayName ?? filter.personId,
      clear: () => onFilterChange({ personId: null }),
    });
  }

  if (filter.q && filter.q.trim()) {
    chips.push({
      key: "q",
      label: `“${filter.q.trim()}”`,
      clear: () => onFilterChange({ q: null }),
    });
  }

  if (filter.unreviewedOnly) {
    chips.push({
      key: "unreviewed",
      label: "Unreviewed only",
      clear: () => onFilterChange({ unreviewedOnly: false }),
    });
  }

  if (filter.sort === "asc") {
    chips.push({
      key: "sort",
      label: "Oldest first",
      clear: () => onFilterChange({ sort: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      {chips.map((c) => (
        <Chip key={c.key} onClear={c.clear}>
          {c.label}
        </Chip>
      ))}
      <button
        type="button"
        onClick={() =>
          onFilterChange({
            from: null,
            to: null,
            category: null,
            accountId: null,
            personId: null,
            q: null,
            unreviewedOnly: false,
            sort: null,
            timeOfDay: null,
          })
        }
        className="ml-auto text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        Clear all
      </button>
    </div>
  );
}

function Chip({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">
      <span className="max-w-[160px] truncate">{children}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove filter"
        className="rounded-full px-1 leading-none hover:bg-indigo-200 dark:hover:bg-indigo-900"
      >
        ×
      </button>
    </span>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "All time" → null. "2026" / "May 2026" / "14 May 2026" → string. */
export function describeTimeSelection(buckets: TimeBuckets): string | null {
  const { selectedYear, selectedMonth, selectedDay } = buckets;
  if (selectedYear == null) return null;
  if (selectedMonth == null) return String(selectedYear);
  if (selectedDay == null) return `${MONTH_SHORT[selectedMonth - 1]} ${selectedYear}`;
  return `${selectedDay} ${MONTH_SHORT[selectedMonth - 1]} ${selectedYear}`;
}
