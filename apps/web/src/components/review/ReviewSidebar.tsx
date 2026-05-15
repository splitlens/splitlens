"use client";

/**
 * ReviewSidebar — slim list + filter panel on the left of /review.
 *
 * Three sections, top-to-bottom:
 *   1. Progress meter — "127 / 5773 reviewed" with a tiny bar
 *   2. Filters — date range, category, unreviewed-toggle, free-text search
 *   3. List — every txn matching the filter, scroll-overflow, click to jump
 *
 * Keeps the visual weight low so the form on the right is the eye anchor.
 */
import { useMemo, useState } from "react";

import type {
  ReviewFilterMeta,
  ReviewListFilter,
  ReviewListResult,
  ReviewListRow,
  TimeBuckets,
} from "@/lib/review-repo";
import { fmtInr } from "@/lib/format";
import { displayCounterparty } from "@/lib/narration";

import { TimeNavigator } from "./TimeNavigator";
import { ActiveFilterChips, describeTimeSelection } from "./ActiveFilterChips";

export interface SidebarPeople {
  id: string;
  displayName: string;
}

export interface ReviewSidebarProps {
  list: ReviewListResult;
  meta: ReviewFilterMeta;
  buckets: TimeBuckets;
  filter: ReviewListFilter;
  /** Lightweight people list — used by the active-filter chip label resolver. */
  people: SidebarPeople[];
  activeId: number | null;
  onSelectId: (id: number) => void;
  onFilterChange: (patch: Partial<ReviewListFilter & { unreviewed: boolean }>) => void;
  pending: boolean;
}

export function ReviewSidebar(props: ReviewSidebarProps) {
  const {
    list,
    meta,
    buckets,
    filter,
    people,
    activeId,
    onSelectId,
    onFilterChange,
    pending,
  } = props;

  // Local UI state: progressive disclosure for the time navigator and the
  // extra-filters block. Both are tucked away by default so the queue gets
  // the lion's share of the sidebar's vertical real estate. The chip strip
  // above shows what's active so a collapsed control surface isn't opaque.
  const [timeOpen, setTimeOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Search-as-you-type: keep a local draft so every keystroke doesn't churn
  // the URL — commit on Enter or blur.
  const [searchDraft, setSearchDraft] = useState(filter.q ?? "");

  const pct = useMemo(() => {
    if (list.ledgerTotal === 0) return 0;
    return Math.round((list.ledgerReviewed / list.ledgerTotal) * 100);
  }, [list.ledgerReviewed, list.ledgerTotal]);

  const timeSummary = describeTimeSelection(buckets) ?? "All time";

  // How many non-time filters are active? Drives the badge on the
  // "More filters" toggle.
  const activeFilterCount =
    (filter.category ? 1 : 0) +
    (filter.accountId != null ? 1 : 0) +
    (filter.unreviewedOnly ? 1 : 0) +
    (filter.sort === "asc" ? 1 : 0);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      {/* Progress */}
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">
            Reviewed
          </span>
          <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
            {list.ledgerReviewed.toLocaleString()} / {list.ledgerTotal.toLocaleString()} ({pct}%)
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full bg-emerald-500 transition-all duration-500 dark:bg-emerald-400"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {list.totalMatching.toLocaleString()} matching this filter
          {list.totalUnreviewed > 0 && (
            <> · {list.totalUnreviewed.toLocaleString()} still unreviewed</>
          )}
          {pending && <span className="ml-1.5 italic">· updating…</span>}
        </div>
      </div>

      {/* Active filter chips — only renders when ≥1 filter is set, with a
          one-click clear per chip + a "Clear all" link. Mirrors a pattern
          from Linear / Notion. */}
      <ActiveFilterChips
        filter={filter}
        buckets={buckets}
        meta={meta}
        people={people}
        onFilterChange={onFilterChange}
      />

      {/* Always-visible: search + time pill. Search is the most-used filter
          so it stays out of the collapsed block. The time pill summarizes
          the year/month/day selection at a glance and opens the full
          TimeNavigator on click. */}
      <div className="space-y-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <input
          type="search"
          value={searchDraft}
          placeholder="Search counterparty or narration…"
          onChange={(e) => setSearchDraft(e.target.value)}
          onBlur={() => {
            if ((filter.q ?? "") !== searchDraft) {
              onFilterChange({ q: searchDraft || null });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onFilterChange({ q: searchDraft || null });
            }
          }}
          className="w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />

        <button
          type="button"
          onClick={() => setTimeOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          aria-expanded={timeOpen}
        >
          <span className="flex items-baseline gap-1.5">
            <span aria-hidden>🗓</span>
            <span className="text-zinc-700 dark:text-zinc-200">{timeSummary}</span>
            {filter.timeOfDay && (
              <span className="text-zinc-500 dark:text-zinc-400">
                · {filter.timeOfDay}
              </span>
            )}
          </span>
          <span
            className="text-zinc-400 transition-transform dark:text-zinc-500"
            style={{ transform: timeOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            ▸
          </span>
        </button>
      </div>

      {/* Collapsible time navigator. */}
      {timeOpen && (
        <TimeNavigator
          buckets={buckets}
          filter={filter}
          onSelect={(patch) => onFilterChange(patch)}
        />
      )}

      {/* "More filters" toggle row — chevron + active count badge. */}
      <button
        type="button"
        onClick={() => setFiltersOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/40"
        aria-expanded={filtersOpen}
      >
        <span className="flex items-baseline gap-1.5">
          <span aria-hidden>⚙</span>
          More filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-indigo-100 px-1.5 text-[9px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">
              {activeFilterCount}
            </span>
          )}
        </span>
        <span
          className="text-zinc-400 transition-transform dark:text-zinc-500"
          style={{ transform: filtersOpen ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ▸
        </span>
      </button>

      {filtersOpen && (
        <div className="space-y-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          {/* Manual from/to date pickers — for ranges the time navigator
              can't express (e.g. 7 days spanning months). */}
          <div className="flex gap-1.5">
            <label className="flex-1">
              <span className="block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                From
              </span>
              <input
                type="date"
                value={filter.from ?? ""}
                onChange={(e) => onFilterChange({ from: e.target.value || null })}
                className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
            <label className="flex-1">
              <span className="block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                To
              </span>
              <input
                type="date"
                value={filter.to ?? ""}
                onChange={(e) => onFilterChange({ to: e.target.value || null })}
                className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-300">
            <span>Order</span>
            <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => onFilterChange({ sort: "desc" })}
                className={`px-2 py-0.5 text-[10px] ${
                  filter.sort !== "asc"
                    ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
                    : "bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
                title="Newest first"
              >
                ↓ Recent
              </button>
              <button
                type="button"
                onClick={() => onFilterChange({ sort: "asc" })}
                className={`px-2 py-0.5 text-[10px] ${
                  filter.sort === "asc"
                    ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
                    : "bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
                title="Oldest first (chronological review)"
              >
                ↑ Chrono
              </button>
            </div>
          </div>

          <select
            value={filter.category ?? ""}
            onChange={(e) => onFilterChange({ category: e.target.value || null })}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">All categories</option>
            {meta.categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.count})
              </option>
            ))}
          </select>

          <select
            value={filter.accountId ?? ""}
            onChange={(e) =>
              onFilterChange({
                accountId: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">All accounts</option>
            {meta.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank} {a.type} •••{a.last4} ({a.count})
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={Boolean(filter.unreviewedOnly)}
              onChange={(e) => onFilterChange({ unreviewedOnly: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600"
            />
            Unreviewed only
          </label>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {list.rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No transactions match.
          </div>
        ) : (
          renderGroupedList(list.rows, activeId, onSelectId)
        )}
        {list.totalMatching > list.rows.length && (
          <div className="border-t border-zinc-100 px-3 py-2 text-center text-[11px] italic text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Showing first {list.rows.length} of {list.totalMatching}. Narrow the
            filter to see more.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// List rendering — sticky day headers with totals, smart counterparty
// fallback, left-accent active row
// ============================================================================

const DAY_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_OF_YEAR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Format an ISO date as "Wed · 1 Jan 2026". Used by the sticky day headers. */
function fmtDayHeader(iso: string): string {
  // Parse Y-M-D explicitly so we don't get TZ surprises.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_OF_WEEK[dow]} · ${d} ${MONTH_OF_YEAR[m - 1]} ${y}`;
}

interface DaySummary {
  rows: ReviewListRow[];
  debitTotal: number;
  /** True when one or more of this day's rows is the active one. */
  hasActive: boolean;
}

/** Group rows by txn_date, keeping the input order (which is sort.asc or .desc). */
function groupRowsByDate(
  rows: ReviewListRow[],
  activeId: number | null,
): Array<{ date: string; summary: DaySummary }> {
  const map = new Map<string, DaySummary>();
  const order: string[] = [];
  for (const r of rows) {
    let s = map.get(r.txnDate);
    if (!s) {
      s = { rows: [], debitTotal: 0, hasActive: false };
      map.set(r.txnDate, s);
      order.push(r.txnDate);
    }
    s.rows.push(r);
    if (r.direction === "debit") s.debitTotal += r.amount;
    if (r.id === activeId) s.hasActive = true;
  }
  return order.map((date) => ({ date, summary: map.get(date)! }));
}

/**
 * Render the list with sticky day headers (incl. day-of-week + day total)
 * and a left-accent active row. Counterparty falls back to a narration-
 * extracted name so rows are never "—".
 */
function renderGroupedList(
  rows: ReviewListRow[],
  activeId: number | null,
  onSelectId: (id: number) => void,
) {
  const groups = groupRowsByDate(rows, activeId);
  return (
    <div>
      {groups.map(({ date, summary }) => (
        <section key={date}>
          <header className="sticky top-0 z-10 flex items-baseline justify-between gap-2 border-y border-zinc-200 bg-zinc-100/95 px-3.5 py-1.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-800/95">
            <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
              {fmtDayHeader(date)}
            </div>
            <div className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {summary.rows.length}
              {summary.rows.length === 1 ? " txn" : " txns"}
              {summary.debitTotal > 0 && (
                <span className="ml-1.5 text-rose-600 dark:text-rose-400">
                  −{fmtInr(summary.debitTotal)}
                </span>
              )}
            </div>
          </header>
          {summary.rows.map((r) => {
            const active = r.id === activeId;
            const lede = displayCounterparty(r.counterparty, r.narration);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectId(r.id)}
                className={`relative flex w-full flex-col gap-0.5 border-b border-zinc-100 py-2 pr-3.5 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${
                  active
                    ? "bg-indigo-50/60 pl-[calc(0.875rem-3px)] dark:bg-indigo-950/30"
                    : "pl-3.5"
                }`}
              >
                {/* Left accent bar — only on the active row. 3px wide, full
                    height, indigo. Stronger spatial anchor than a tint fill. */}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px] bg-indigo-500 dark:bg-indigo-400"
                  />
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    {r.txnTime && (
                      <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                        {r.txnTime}
                      </span>
                    )}
                    <span
                      className={`truncate text-sm font-medium ${
                        lede
                          ? "text-zinc-900 dark:text-zinc-50"
                          : "italic text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {lede ?? (r.category ?? "—")}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 tabular-nums text-sm font-medium ${
                      r.direction === "debit"
                        ? "text-rose-700 dark:text-rose-400"
                        : "text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {r.direction === "debit" ? "−" : "+"}
                    {fmtInr(r.amount)}
                  </span>
                </div>
                {(r.category || r.hasReceipt || r.reviewed) && (
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {r.category && (
                      <span className="truncate rounded-sm bg-zinc-100 px-1 dark:bg-zinc-800">
                        {r.category}
                      </span>
                    )}
                    {r.hasReceipt && <span title="Has receipt">🧾</span>}
                    {r.reviewed && <span title="Reviewed">✓</span>}
                  </div>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
