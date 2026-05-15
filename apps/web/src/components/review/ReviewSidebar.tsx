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
} from "@/lib/review-repo";
import { fmtInr, fmtDate } from "@/lib/format";

export interface ReviewSidebarProps {
  list: ReviewListResult;
  meta: ReviewFilterMeta;
  filter: ReviewListFilter;
  activeId: number | null;
  onSelectId: (id: number) => void;
  onFilterChange: (patch: Partial<ReviewListFilter & { unreviewed: boolean }>) => void;
  pending: boolean;
}

export function ReviewSidebar(props: ReviewSidebarProps) {
  const { list, meta, filter, activeId, onSelectId, onFilterChange, pending } = props;

  // Debounce search-as-you-type slightly to keep the URL-state churn under
  // control — feels instant under 250ms.
  const [searchDraft, setSearchDraft] = useState(filter.q ?? "");

  const pct = useMemo(() => {
    if (list.ledgerTotal === 0) return 0;
    return Math.round((list.ledgerReviewed / list.ledgerTotal) * 100);
  }, [list.ledgerReviewed, list.ledgerTotal]);

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

      {/* Filters */}
      <div className="space-y-2.5 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
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

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {list.rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No transactions match.
          </div>
        ) : (
          <ul>
            {list.rows.map((r) => {
              const active = r.id === activeId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelectId(r.id)}
                    className={`flex w-full flex-col gap-0.5 border-b border-zinc-100 px-3.5 py-2 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${
                      active
                        ? "bg-indigo-50 dark:bg-indigo-950/30"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {r.counterparty ?? "—"}
                      </span>
                      <span
                        className={`tabular-nums text-sm font-medium ${
                          r.direction === "debit"
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {r.direction === "debit" ? "−" : "+"}
                        {fmtInr(r.amount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>{fmtDate(r.txnDate)}</span>
                      {r.txnTime && <span>· {r.txnTime}</span>}
                      {r.category && (
                        <span className="truncate rounded-sm bg-zinc-100 px-1 dark:bg-zinc-800">
                          {r.category}
                        </span>
                      )}
                      {r.hasReceipt && <span title="Has receipt">🧾</span>}
                      {r.reviewed && <span title="Reviewed">✓</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
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
