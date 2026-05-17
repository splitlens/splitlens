"use client";

/**
 * TimelineColumns — horizontal scroller of time-bucket columns for the
 * /review sidebar. Each column is a fixed-width vertical list of txns
 * within that bucket (a day, when zoomed to a month; a month, when zoomed
 * to a year).
 *
 * Layout choices:
 *   - Columns are 220px wide so two are visible at a time inside the
 *     360px sidebar, with a generous peek at the next so the
 *     swipe-affordance is obvious.
 *   - `scroll-snap-type: x mandatory` + `scroll-snap-align: start` so
 *     swipes/key-press scrolls land cleanly on column boundaries.
 *   - Sticky column-header within each column so the date label stays
 *     visible while you scroll inside a busy day.
 *   - Active column auto-scrolls into view on mount/txn-change.
 *
 * Row markup mirrors the vertical-list renderer so the active-state
 * accent, smart counterparty fallback, and category/receipt chips all
 * look identical across both layouts.
 */
import { useEffect, useRef } from "react";

import type { ReviewListRow } from "@/lib/review-repo";
import { fmtInr } from "@/lib/format";
import { displayCounterparty } from "@/lib/narration";

import type { TimelineColumn, TimelineLayout } from "./buildTimelineColumns";

export interface TimelineColumnsProps {
  layout: TimelineLayout;
  activeId: number | null;
  onSelectId: (id: number) => void;
}

export function TimelineColumns({
  layout,
  activeId,
  onSelectId,
}: TimelineColumnsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the active column into view whenever it changes. Falls
  // back to the first non-empty column when nothing's active yet so the
  // user lands on data rather than an empty Sunday.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target =
      scroller.querySelector<HTMLElement>("[data-column-active='true']") ??
      scroller.querySelector<HTMLElement>("[data-column-non-empty='true']");
    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start",
      });
    }
  }, [activeId, layout]);

  return (
    <div
      ref={scrollerRef}
      className="flex h-full snap-x snap-mandatory gap-1.5 overflow-x-auto overflow-y-hidden scroll-smooth p-1.5"
      style={{ scrollbarWidth: "thin" }}
    >
      {layout.columns.map((col) => (
        <Column
          key={col.key}
          col={col}
          activeId={activeId}
          onSelectId={onSelectId}
        />
      ))}
    </div>
  );
}

function Column({
  col,
  activeId,
  onSelectId,
}: {
  col: TimelineColumn;
  activeId: number | null;
  onSelectId: (id: number) => void;
}) {
  return (
    <div
      data-column-active={col.hasActive ? "true" : "false"}
      data-column-non-empty={col.rows.length > 0 ? "true" : "false"}
      className={`flex h-full w-[220px] shrink-0 snap-start flex-col overflow-hidden rounded-md border ${
        col.hasActive
          ? "border-indigo-300 bg-white shadow-sm dark:border-indigo-500/40 dark:bg-zinc-900"
          : col.empty
            ? "border-zinc-100 bg-zinc-50/40 dark:border-zinc-800/60 dark:bg-zinc-900/40"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      {/* Sticky column header */}
      <header
        className={`sticky top-0 border-b px-2.5 py-1.5 ${
          col.hasActive
            ? "border-indigo-200 bg-indigo-50/80 dark:border-indigo-500/30 dark:bg-indigo-950/30"
            : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/60"
        }`}
      >
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
            {col.primaryLabel}
          </span>
          {col.rows.length > 0 && (
            <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {col.rows.length}
              {col.rows.length === 1 ? " txn" : " txns"}
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-1 text-[10px]">
          <span className="text-zinc-500 dark:text-zinc-400">
            {col.secondaryLabel}
          </span>
          {col.debitTotal > 0 && (
            <span className="tabular-nums text-rose-600 dark:text-rose-400">
              −{fmtInr(col.debitTotal)}
            </span>
          )}
        </div>
      </header>

      {/* Body — scrollable inner list */}
      <div className="flex-1 overflow-y-auto">
        {col.empty ? (
          <div className="flex h-full items-center justify-center px-3 py-6 text-center text-[11px] italic text-zinc-400 dark:text-zinc-500">
            no txns
          </div>
        ) : (
          col.rows.map((r) => (
            <TimelineRow
              key={r.id}
              row={r}
              active={r.id === activeId}
              onSelect={() => onSelectId(r.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TimelineRow({
  row,
  active,
  onSelect,
}: {
  row: ReviewListRow;
  active: boolean;
  onSelect: () => void;
}) {
  const lede = displayCounterparty(row.counterparty, row.narration);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex w-full flex-col gap-0.5 border-b border-zinc-100 py-1.5 pr-2.5 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40 ${
        active
          ? "bg-indigo-50/60 pl-[calc(0.625rem-3px)] dark:bg-indigo-950/30"
          : "pl-2.5"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-indigo-500 dark:bg-indigo-400"
        />
      )}
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {row.txnTime && (
            <span className="shrink-0 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {row.txnTime}
            </span>
          )}
          <span
            className={`truncate text-xs font-medium ${
              lede
                ? "text-zinc-900 dark:text-zinc-50"
                : "italic text-zinc-400 dark:text-zinc-500"
            }`}
          >
            {lede ?? (row.category ?? "—")}
          </span>
        </span>
        <span
          className={`shrink-0 text-xs font-medium tabular-nums ${
            row.direction === "debit"
              ? "text-rose-700 dark:text-rose-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {row.direction === "debit" ? "−" : "+"}
          {fmtInr(row.amount)}
        </span>
      </div>
      {(row.category || row.hasReceipt || row.reviewed) && (
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          {row.category && (
            <span className="truncate rounded-sm bg-zinc-100 px-1 dark:bg-zinc-800">
              {row.category}
            </span>
          )}
          {row.hasReceipt && <span title="Has receipt">🧾</span>}
          {row.reviewed && <span title="Reviewed">✓</span>}
        </div>
      )}
    </button>
  );
}
