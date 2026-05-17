"use client";

import { useState } from "react";
import type { CandidateShare } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { ShareTxnModal, type PersonOption } from "./ShareTxnModal";

const HINT_LABEL: Record<string, string> = {
  "trip-cost": "Trip cost",
  transport: "Transport",
  groceries: "Groceries",
  "group-meal": "Group meal?",
  food: "Food",
  outing: "Outing",
  splittable: "Splittable",
};

/**
 * Splitwise-better feature: a queue of "did you share this with anyone?"
 * suggestions, picked by amount + category. Each click opens the share
 * modal. The list is server-fetched and passed in as a snapshot — after the
 * user marks one, revalidatePath refreshes the page so the row drops out.
 */
export function CandidateSuggestions({
  candidates,
  people,
}: {
  candidates: CandidateShare[];
  people: PersonOption[];
}) {
  const [open, setOpen] = useState<CandidateShare | null>(null);

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Nothing to review
        </h3>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          We didn&apos;t find any high-value food / travel / outing transactions that you
          haven&apos;t already classified.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm dark:border-amber-900/50 dark:from-amber-950/40 dark:to-zinc-900">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Did you share these?
        </h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {candidates.length} suggestion{candidates.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        High-value food, travel, and outing expenses you haven&apos;t split yet.
      </p>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {candidates.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50"
                  title={c.counterparty ?? c.narration ?? ""}
                >
                  {c.counterparty || c.narration || "—"}
                </span>
                <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {HINT_LABEL[c.hint] ?? c.hint}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{fmtDate(c.txnDate)}</span>
                {c.txnTime && <span className="tabular-nums">{c.txnTime}</span>}
                {c.category && (
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                    {c.category}
                  </span>
                )}
              </div>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
              {fmtInr(c.amount)}
            </span>
            <button
              type="button"
              onClick={() => setOpen(c)}
              className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Split…
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <ShareTxnModal
          txn={{
            id: open.id,
            txnDate: open.txnDate,
            txnTime: open.txnTime,
            amount: open.amount,
            counterparty: open.counterparty,
            narration: open.narration,
            category: open.category,
          }}
          people={people}
          onClose={() => setOpen(null)}
          onSubmitted={() => setOpen(null)}
        />
      )}
    </div>
  );
}
