"use client";

import { useEffect, useState, useTransition } from "react";
import { fmtInr, fmtDate } from "@/lib/format";
import { markShared, unmarkShared } from "@/app/friends/actions";

export interface ShareTxnTarget {
  id: number;
  txnDate: string;
  txnTime: string | null;
  amount: number;
  counterparty: string | null;
  narration: string | null;
  category: string | null;
  /** Pre-selected if already shared. CSV stored in DB. */
  initialSharedWith?: string[];
}

export interface PersonOption {
  id: string;
  displayName: string;
  relationship: string;
  txnCount: number;
}

/**
 * Mark-as-shared modal. Pick which friends took part; we always include you
 * implicitly. Per-head share is shown live as you toggle people.
 *
 * Server action runs on submit; on success the parent's `onSubmitted`
 * callback closes the modal. We don't optimistically update — the action
 * triggers revalidatePath, and the next reload reflects the new balance.
 */
export function ShareTxnModal({
  txn,
  people,
  onClose,
  onSubmitted,
}: {
  txn: ShareTxnTarget;
  people: PersonOption[];
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(txn.initialSharedWith ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function toggle(pid: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  const shareCount = selected.size + 1; // you + selected
  const perHead = shareCount > 0 ? txn.amount / shareCount : txn.amount;
  const alreadyShared = (txn.initialSharedWith ?? []).length > 0;

  function submitMark() {
    setError(null);
    startTransition(async () => {
      const res = await markShared(txn.id, [...selected]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSubmitted();
    });
  }

  function submitUnmark() {
    setError(null);
    startTransition(async () => {
      const res = await unmarkShared(txn.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSubmitted();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Split this transaction
          </h3>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {fmtDate(txn.txnDate)}
            {txn.txnTime ? ` · ${txn.txnTime}` : ""} · {txn.counterparty || txn.narration || "—"} ·{" "}
            <strong className="text-zinc-700 dark:text-zinc-300">{fmtInr(txn.amount)}</strong>
          </p>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Pick who shared this expense. You&apos;re always part of the split.
          </p>
          <ul className="space-y-1">
            {people.map((p) => {
              const checked = selected.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      checked
                        ? "border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">
                        {p.displayName}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {p.relationship} · {p.txnCount} txn{p.txnCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        checked
                          ? "border-indigo-500 bg-indigo-500 text-white"
                          : "border-zinc-300 dark:border-zinc-600"
                      }`}
                      aria-hidden
                    >
                      {checked && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12l5 5 9-11" />
                        </svg>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          {error && (
            <p className="mb-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {selected.size === 0 ? (
                <>No friends selected.</>
              ) : (
                <>
                  Split <strong className="tabular-nums">{shareCount}</strong> ways ·{" "}
                  <strong className="tabular-nums">{fmtInr(perHead)}</strong> per head
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {alreadyShared && (
                <button
                  type="button"
                  onClick={submitUnmark}
                  disabled={isPending}
                  className="rounded-md px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                >
                  Unmark
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitMark}
                disabled={isPending || selected.size === 0}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Saving…" : alreadyShared ? "Update" : "Mark as shared"}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
