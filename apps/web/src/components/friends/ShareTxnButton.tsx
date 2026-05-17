"use client";

import { useState } from "react";
import { ShareTxnModal, type PersonOption } from "./ShareTxnModal";

export interface ShareableTxn {
  id: number;
  txnDate: string;
  txnTime: string | null;
  /** Either withdrawal (will be the amount) or null if this row is a deposit-only. */
  withdrawal: number | null;
  counterparty: string | null;
  narration: string | null;
  category: string | null;
  initialSharedWith?: string[];
}

/**
 * Tiny client wrapper for the "Share" action so it can live inside an
 * otherwise-server-rendered table. Each row renders one of these; clicking
 * pops the share modal. Only meaningful for outgoing transactions, so
 * deposit-only rows render nothing.
 */
export function ShareTxnButton({
  txn,
  people,
  isShared,
}: {
  txn: ShareableTxn;
  people: PersonOption[];
  isShared?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (txn.withdrawal == null || txn.withdrawal <= 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
          isShared
            ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
            : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        }`}
        title={isShared ? "Edit split" : "Mark as shared with friends"}
      >
        {isShared ? "Shared" : "Split…"}
      </button>
      {open && (
        <ShareTxnModal
          txn={{
            id: txn.id,
            txnDate: txn.txnDate,
            txnTime: txn.txnTime,
            amount: txn.withdrawal,
            counterparty: txn.counterparty,
            narration: txn.narration,
            category: txn.category,
            initialSharedWith: txn.initialSharedWith,
          }}
          people={people}
          onClose={() => setOpen(false)}
          onSubmitted={() => setOpen(false)}
        />
      )}
    </>
  );
}
