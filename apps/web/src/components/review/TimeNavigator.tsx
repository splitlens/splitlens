"use client";

/**
 * TimeNavigator — hierarchical year/month/day/time-of-day chips above the
 * review-page filter form.
 *
 * Layout (top-down, dense):
 *
 *   [All time]  2022  2023  2024  2025  2026         ← year row
 *   ─ when a year is selected ─
 *   [All year]  Jan  Feb  Mar … Dec                   ← month row
 *   ─ when a month is selected ─
 *   Mo Tu We Th Fr Sa Su                              ← day grid header
 *      1  2  3  4  5  6  7                            ← day grid
 *   …
 *   ─ when a day is selected ─
 *   [Any time]  ☀ Morning  ☼ Afternoon  ☾ Evening  🌙 Night  ← time row
 *
 * Each level shows counts on every chip. Disabled (greyed-out) chips have
 * zero matching txns under the current non-time filters; the user can still
 * click them in case they want to widen the filter another way.
 *
 * Selection cascades down. Clicking a year sets from=YYYY-01-01 +
 * to=YYYY-12-31 and clears month/day. Clicking a month adds the month
 * range. Clicking a day collapses the range to a single day. Each click
 * also clears `id` from the URL so the form lands on the first row in
 * the new range.
 */
import { useMemo } from "react";

import type { ReviewListFilter, TimeBuckets } from "@/lib/review-repo";
import { MONTH_SHORT, rangeForSelection } from "@/lib/review-time";

export interface TimeNavigatorProps {
  buckets: TimeBuckets;
  filter: ReviewListFilter;
  onSelect: (patch: Partial<ReviewListFilter>) => void;
}

export function TimeNavigator({ buckets, filter, onSelect }: TimeNavigatorProps) {
  const { selectedYear, selectedMonth, selectedDay } = buckets;

  const selectYear = (year: number | null) => {
    const { from, to } = rangeForSelection({ year, month: null, day: null });
    onSelect({ from, to, timeOfDay: null });
  };
  const selectMonth = (month: number | null) => {
    const { from, to } = rangeForSelection({ year: selectedYear, month, day: null });
    onSelect({ from, to, timeOfDay: null });
  };
  const selectDay = (day: number | null) => {
    const { from, to } = rangeForSelection({
      year: selectedYear,
      month: selectedMonth,
      day,
    });
    onSelect({ from, to, timeOfDay: day == null ? null : filter.timeOfDay });
  };
  const selectTime = (
    bucket: "morning" | "afternoon" | "evening" | "night" | null,
  ) => {
    onSelect({ timeOfDay: bucket });
  };

  // Day grid for the selected month, padded with blank cells to align on
  // weekday columns (Mon = 1, Sun = 7 in ISO).
  const dayGrid = useMemo(() => {
    if (selectedYear == null || selectedMonth == null) return null;
    const firstDow = new Date(
      Date.UTC(selectedYear, selectedMonth - 1, 1),
    ).getUTCDay();
    // Convert Sun=0..Sat=6 → Mon=0..Sun=6
    const leadingBlanks = (firstDow + 6) % 7;
    const lastDay = new Date(
      Date.UTC(selectedYear, selectedMonth, 0),
    ).getUTCDate();
    const countByDay = new Map(buckets.days.map((d) => [d.day, d.count]));
    return {
      leadingBlanks,
      lastDay,
      countByDay,
    };
  }, [selectedYear, selectedMonth, buckets.days]);

  return (
    <div className="space-y-2 border-b border-zinc-200 px-3 py-2.5 text-xs dark:border-zinc-800">
      {/* Year row */}
      <div className="flex flex-wrap gap-1">
        <Chip
          active={selectedYear == null}
          onClick={() => selectYear(null)}
          title="All time"
        >
          All
        </Chip>
        {buckets.years.map((y) => (
          <Chip
            key={y.year}
            active={selectedYear === y.year}
            count={y.count}
            onClick={() => selectYear(y.year)}
          >
            {y.year}
          </Chip>
        ))}
      </div>

      {/* Month row — only when a year is selected */}
      {selectedYear != null && (
        <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <Chip
            active={selectedMonth == null}
            onClick={() => selectMonth(null)}
            title={`All of ${selectedYear}`}
          >
            All
          </Chip>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const row = buckets.months.find((mm) => mm.month === m);
            const count = row?.count ?? 0;
            return (
              <Chip
                key={m}
                active={selectedMonth === m}
                dim={count === 0}
                count={count > 0 ? count : undefined}
                onClick={() => selectMonth(m)}
                compact
              >
                {MONTH_SHORT[m - 1]}
              </Chip>
            );
          })}
        </div>
      )}

      {/* Day grid — only when a month is selected */}
      {dayGrid && selectedYear != null && selectedMonth != null && (
        <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {MONTH_SHORT[selectedMonth - 1]} {selectedYear}
            </span>
            {selectedDay != null && (
              <button
                type="button"
                onClick={() => selectDay(null)}
                className="text-[10px] text-indigo-600 hover:underline dark:text-indigo-400"
              >
                ← back to month
              </button>
            )}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <div
                key={i}
                className="text-center text-[9px] text-zinc-400 dark:text-zinc-500"
              >
                {d}
              </div>
            ))}
            {Array.from({ length: dayGrid.leadingBlanks }, (_, i) => (
              <div key={`b-${i}`} />
            ))}
            {Array.from({ length: dayGrid.lastDay }, (_, i) => {
              const day = i + 1;
              const count = dayGrid.countByDay.get(day) ?? 0;
              const active = selectedDay === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`relative rounded px-0 py-1 text-center text-[10px] transition-colors ${
                    active
                      ? "bg-indigo-600 text-white"
                      : count > 0
                        ? "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        : "text-zinc-400 hover:bg-zinc-50 dark:text-zinc-600 dark:hover:bg-zinc-800/40"
                  }`}
                  title={count > 0 ? `${count} txn${count === 1 ? "" : "s"}` : "no txns"}
                >
                  {day}
                  {count > 0 && (
                    <span
                      className={`absolute -top-0.5 right-0.5 text-[7px] tabular-nums ${
                        active ? "text-white/70" : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Time-of-day row — only when a day is selected */}
      {selectedDay != null && buckets.timeOfDay.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <Chip
            active={!filter.timeOfDay}
            onClick={() => selectTime(null)}
            title="All times"
          >
            All
          </Chip>
          {TIME_BUCKET_META.map((tb) => {
            const row = buckets.timeOfDay.find((b) => b.bucket === tb.key);
            const count = row?.count ?? 0;
            return (
              <Chip
                key={tb.key}
                active={filter.timeOfDay === tb.key}
                dim={count === 0}
                count={count > 0 ? count : undefined}
                onClick={() => selectTime(tb.key)}
                title={tb.title}
                compact
              >
                <span aria-hidden className="mr-0.5">
                  {tb.icon}
                </span>
                {tb.label}
              </Chip>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TIME_BUCKET_META: Array<{
  key: "morning" | "afternoon" | "evening" | "night";
  label: string;
  icon: string;
  title: string;
}> = [
  { key: "morning", label: "Morning", icon: "🌅", title: "06:00–12:00" },
  { key: "afternoon", label: "Afternoon", icon: "☀️", title: "12:00–17:00" },
  { key: "evening", label: "Evening", icon: "🌆", title: "17:00–21:00" },
  { key: "night", label: "Night", icon: "🌙", title: "21:00–06:00" },
];

function Chip({
  children,
  active,
  dim,
  count,
  onClick,
  title,
  compact,
}: {
  children: React.ReactNode;
  active?: boolean;
  dim?: boolean;
  count?: number;
  onClick?: () => void;
  title?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-baseline gap-1 rounded-full border ${compact ? "px-1.5 py-0.5" : "px-2 py-0.5"} text-[11px] transition-colors ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : dim
            ? "border-zinc-200 bg-transparent text-zinc-400 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-600"
            : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
      }`}
    >
      <span>{children}</span>
      {count != null && (
        <span
          className={`tabular-nums text-[9px] ${
            active ? "text-white/70" : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
