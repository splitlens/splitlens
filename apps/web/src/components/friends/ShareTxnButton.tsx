"use client";

import { useState } from "react";
import { Ico } from "@/components/Ico";
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
        className={`btn btn-sm ${isShared ? "" : "outline"}`}
        style={
          isShared
            ? {
                background: "var(--accent-soft)",
                borderColor: "var(--accent-line)",
                color: "var(--accent)",
              }
            : undefined
        }
        title={isShared ? "Edit split" : "Mark as shared with friends"}
      >
        <Ico name="split" size={13} />
        {isShared ? "Shared" : "Split"}
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
