"use client";

import { useEffect } from "react";
import type { DrillDownTxn } from "@/lib/repo";
import { fmtDate, fmtInr } from "@/lib/format";
import { KindBadge } from "./TopCounterparties";

/**
 * Modal that lists every transaction on a given date. Opened by clicking a
 * calendar cell. Plain HTML modal — fixed position + backdrop, no portal/lib.
 * Click outside or press Esc to close.
 */
export function DayDetailModal({
  date,
  loading,
  txns,
  onClose,
}: {
  date: string;
  loading: boolean;
  txns: DrillDownTxn[];
  onClose: () => void;
}) {
  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const totalOut = txns.reduce((s, t) => s + (t.withdrawal ?? 0), 0);
  const totalIn = txns.reduce((s, t) => s + (t.deposit ?? 0), 0);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 px-4 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {fmtDate(date)}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {loading
                ? "Loading…"
                : `${txns.length} transaction${txns.length === 1 ? "" : "s"}${totalOut > 0 ? ` · ${fmtInr(totalOut)} out` : ""}${totalIn > 0 ? ` · ${fmtInr(totalIn)} in` : ""}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Loading transactions…
            </div>
          ) : txns.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No transactions on this day.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {txns.map((t) => {
                const label = t.counterparty || t.narration || "—";
                const accountLabel = `${t.accountBank} ${t.accountType === "credit_card" ? "CC" : "Savings"} XX${t.accountLast4}`;
                return (
                  <li key={t.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50" title={label}>
                            {label}
                          </span>
                          {t.counterpartyKind && <KindBadge kind={t.counterpartyKind} />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {t.txnTime && <span className="tabular-nums">{t.txnTime}</span>}
                          {t.txnTime && <span>·</span>}
                          <span>{accountLabel}</span>
                          {t.category && (
                            <>
                              <span>·</span>
                              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                                {t.category}
                              </span>
                            </>
                          )}
                        </div>
                        {t.counterparty && t.narration && t.counterparty !== t.narration && (
                          <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-500" title={t.narration}>
                            {t.narration}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {t.withdrawal != null && (
                          <div className="text-sm font-medium tabular-nums text-rose-700 dark:text-rose-400">
                            −{fmtInr(t.withdrawal)}
                          </div>
                        )}
                        {t.deposit != null && (
                          <div className="text-sm font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                            +{fmtInr(t.deposit)}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
