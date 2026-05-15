"use client";

import { useMemo, useState } from "react";
import type {
  DrillDownTxn,
  FriendOverviewRow,
} from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { ShareTxnModal, type PersonOption } from "./ShareTxnModal";

type SharedTxn = DrillDownTxn & {
  shareCount: number;
  sharedWith: string[];
  perHead: number;
};

type Row =
  | { kind: "direct"; key: string; date: string; time: string | null; txn: DrillDownTxn }
  | { kind: "shared"; key: string; date: string; time: string | null; txn: SharedTxn };

/**
 * Per-friend activity stream. Merges direct UPI flows with their share of
 * your shared expenses, sorted newest-first. Each row knows which side of
 * the ledger it's on (you sent / they sent / they share / you share) so
 * the user can scan their relationship history at a glance.
 *
 * Click any row to open the share modal — either to mark a fresh row or to
 * adjust an existing split.
 */
export function FriendDetailTimeline({
  person,
  directTxns,
  sharedTxns,
  people,
}: {
  person: FriendOverviewRow;
  directTxns: DrillDownTxn[];
  sharedTxns: SharedTxn[];
  people: PersonOption[];
}) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [filter, setFilter] = useState<"all" | "direct" | "shared">("all");

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...directTxns.map((t) => ({
        kind: "direct" as const,
        key: `d-${t.id}`,
        date: t.txnDate,
        time: t.txnTime,
        txn: t,
      })),
      ...sharedTxns.map((t) => ({
        kind: "shared" as const,
        key: `s-${t.id}`,
        date: t.txnDate,
        time: t.txnTime,
        txn: t,
      })),
    ];
    all.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.time ?? "00:00").localeCompare(a.time ?? "00:00");
    });
    if (filter === "all") return all;
    return all.filter((r) => r.kind === filter);
  }, [directTxns, sharedTxns, filter]);

  function openShareModal(r: Row) {
    setEditing(r);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Activity
        </h3>
        <div className="flex items-center gap-1 rounded-md border border-zinc-200 p-0.5 text-xs dark:border-zinc-800">
          {(["all", "direct", "shared"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-1 capitalize transition-colors ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-700"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No matching activity.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <li key={r.key} className="py-2.5">
              <button
                type="button"
                onClick={() => openShareModal(r)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <RowTypePill row={r} personDisplayName={person.displayName} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {r.txn.counterparty || r.txn.narration || "—"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>{fmtDate(r.date)}</span>
                      {r.time && <span className="tabular-nums">{r.time}</span>}
                      {r.txn.category && (
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                          {r.txn.category}
                        </span>
                      )}
                      {r.kind === "shared" && (
                        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                          {r.txn.shareCount}-way split
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <RowAmount row={r} personDisplayName={person.displayName} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ShareTxnModal
          txn={{
            id: editing.txn.id,
            txnDate: editing.txn.txnDate,
            txnTime: editing.txn.txnTime,
            amount: editing.txn.withdrawal ?? editing.txn.deposit ?? 0,
            counterparty: editing.txn.counterparty,
            narration: editing.txn.narration,
            category: editing.txn.category,
            initialSharedWith:
              editing.kind === "shared" ? editing.txn.sharedWith : undefined,
          }}
          people={people}
          onClose={() => setEditing(null)}
          onSubmitted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowTypePill({ row, personDisplayName }: { row: Row; personDisplayName: string }) {
  const first = personDisplayName.split(" ")[0];
  if (row.kind === "direct") {
    if (row.txn.withdrawal != null) {
      return (
        <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          You → {first}
        </span>
      );
    }
    return (
      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        {first} → You
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
      Shared
    </span>
  );
}

function RowAmount({ row, personDisplayName }: { row: Row; personDisplayName: string }) {
  const first = personDisplayName.split(" ")[0];
  if (row.kind === "direct") {
    if (row.txn.withdrawal != null) {
      return (
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium tabular-nums text-rose-700 dark:text-rose-400">
            −{fmtInr(row.txn.withdrawal)}
          </div>
        </div>
      );
    }
    return (
      <div className="shrink-0 text-right">
        <div className="text-sm font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
          +{fmtInr(row.txn.deposit ?? 0)}
        </div>
      </div>
    );
  }
  return (
    <div className="shrink-0 text-right">
      <div className="text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
        {fmtInr(row.txn.withdrawal ?? 0)}
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {first}: {fmtInr(row.txn.perHead)}
      </div>
    </div>
  );
}
