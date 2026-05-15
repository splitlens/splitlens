"use client";

import { useState, useTransition } from "react";
import {
  lookupEmailsForTxn,
  type EmailMatchLite,
} from "@/app/friends/email-lookup-actions";
import { EmailMatchModal } from "./EmailMatchModal";

/**
 * Per-row "find emails about this charge" button. Opens a modal and fires
 * the `lookupEmailsForTxn` server action on demand — we don't fetch
 * proactively because the IMAP round-trip costs ~1–3 seconds.
 *
 * The button only needs `txnId`; the server action re-reads the txn from
 * SQLite to assemble the search input. That keeps RecentTxnsCard's wiring
 * trivial — pass the id and nothing else.
 */
export function FindEmailsButton({
  txnId,
  /** Optional label shown in the modal header. Defaults to "this charge". */
  label,
  /** Optional amount shown next to the label. */
  amount,
}: {
  txnId: number;
  label?: string;
  amount?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<EmailMatchLite[]>([]);
  const [accountCount, setAccountCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openModal() {
    setOpen(true);
    setError(null);
    setMatches([]);
    startTransition(async () => {
      try {
        const res = await lookupEmailsForTxn(txnId);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setMatches(res.matches);
        setAccountCount(res.accountCount);
      } catch (err) {
        setError(err instanceof Error ? err.message : "lookup failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        title="Find emails related to this charge"
        aria-label="Find emails about this transaction"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
        Email
      </button>
      {open && (
        <EmailMatchModal
          txnLabel={label ?? "this charge"}
          txnAmount={amount ?? null}
          loading={isPending}
          error={error}
          accountCount={accountCount}
          matches={matches}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
