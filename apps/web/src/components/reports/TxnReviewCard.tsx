"use client";

import type { ReportTxn } from "@/lib/repo";
import { fmtDate, fmtInr } from "@/lib/format";
import { KindBadge } from "@/components/dashboard/TopCounterparties";

export type TxnAction =
  | "accept_suggestion"
  | "open_split"
  | "mark_reviewed"
  | "unmark_reviewed";

/**
 * One transaction card in the monthly review queue. Optimized for fast triage:
 *
 *   - Big amount, clear counterparty
 *   - Smart-suggestion banner with ONE-click accept (when applicable)
 *   - Three primary actions only: Accept / Split / Just me
 *   - Keyboard cursor highlight (indigo ring) so the user knows which row
 *     J / K / A / S / R will target
 *   - Reviewed-state rows render muted with an Undo button instead of actions
 */
export function TxnReviewCard({
  txn,
  isCursor,
  isPending,
  onSelect,
  onAction,
}: {
  txn: ReportTxn;
  isCursor: boolean;
  isPending: boolean;
  onSelect: () => void;
  onAction: (a: TxnAction) => void;
}) {
  const isDone = txn.reviewed || txn.sharedWith.length > 0;
  const isShared = txn.sharedWith.length > 0;
  const label = txn.counterparty || txn.narration || "—";

  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-lg border bg-white p-3 transition-shadow dark:bg-zinc-900 ${
        isCursor
          ? "border-indigo-400 ring-2 ring-indigo-300/40 dark:border-indigo-500 dark:ring-indigo-700/40"
          : "border-zinc-200 hover:shadow-md dark:border-zinc-800"
      } ${isDone ? "opacity-70" : ""}`}
    >
      {/* Top row: counterparty + amount */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50"
              title={label}
            >
              {label}
            </span>
            {txn.counterpartyKind && <KindBadge kind={txn.counterpartyKind} />}
            {isShared && (
              <span
                className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                title={`Split ${txn.shareCount} ways with ${txn.sharedWith.join(", ")}`}
              >
                Split {txn.shareCount}-way
              </span>
            )}
            {txn.reviewed && !isShared && (
              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                Reviewed
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{fmtDate(txn.txnDate)}</span>
            {txn.txnTime && <span className="tabular-nums">{txn.txnTime}</span>}
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span title={txn.accountLabel}>{txn.accountLabel}</span>
            {txn.category && (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                  {txn.category}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums text-rose-700 dark:text-rose-400">
            −{fmtInr(txn.withdrawal)}
          </div>
        </div>
      </div>

      {/* Smart suggestion banner */}
      {!isDone && txn.suggestion && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2 dark:border-indigo-900/50 dark:bg-indigo-950/30">
          <span className="mt-0.5" aria-hidden>💡</span>
          <p className="flex-1 text-xs text-indigo-800 dark:text-indigo-300">
            {txn.suggestion.reason}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAction("accept_suggestion");
            }}
            disabled={isPending}
            className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Accept · A
          </button>
        </div>
      )}

      {/* Action row */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs">
        {isDone ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAction("unmark_reviewed");
            }}
            disabled={isPending}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Undo · U
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction("open_split");
              }}
              disabled={isPending}
              className="rounded-md border border-zinc-200 px-2.5 py-1 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Split… · S
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction("mark_reviewed");
              }}
              disabled={isPending}
              className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Just me · R
            </button>
          </>
        )}
      </div>
    </div>
  );
}
