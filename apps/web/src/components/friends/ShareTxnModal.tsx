"use client";

import { useEffect, useState, useTransition } from "react";
import { fmtInr, fmtDate } from "@/lib/format";
import { Ico } from "@/components/Ico";
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
      className="flex items-center justify-center"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        padding: "32px 24px",
      }}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in srgb, var(--bg) 75%, transparent)",
          backdropFilter: "blur(3px)",
          border: "none",
          cursor: "pointer",
        }}
      />
      <div
        className="surface flex flex-col"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 520,
          maxHeight: "calc(100vh - 64px)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-start justify-between gap-3"
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex flex-col" style={{ minWidth: 0, gap: 4 }}>
            <span className="eyebrow eyebrow-accent">Split this transaction</span>
            <h3 className="h2" style={{ margin: 0 }}>
              {txn.counterparty || txn.narration || "—"}
            </h3>
            <p className="tiny muted" style={{ margin: 0 }}>
              {fmtDate(txn.txnDate)}
              {txn.txnTime ? ` · ${txn.txnTime}` : ""} ·{" "}
              <span className="mono tabular fg-2">{fmtInr(txn.amount)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm ghost"
            aria-label="Close"
            style={{ padding: 6, flexShrink: 0 }}
          >
            <Ico name="x" size={16} />
          </button>
        </header>

        <div
          className="flex flex-col"
          style={{
            padding: "16px 20px",
            gap: 8,
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        >
          <p className="small muted" style={{ margin: 0, marginBottom: 4 }}>
            Pick who shared this expense. You&apos;re always part of the split.
          </p>
          {people.length === 0 ? (
            <div
              className="surface-dashed flex flex-col items-center"
              style={{ padding: 20, gap: 6 }}
            >
              <Ico name="users" size={16} className="muted" />
              <span className="small muted">
                No known people yet — add some from a transaction first.
              </span>
            </div>
          ) : (
            <ul className="flex flex-col" style={{ gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
              {people.map((p) => {
                const checked = selected.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      className="flex items-center justify-between"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: checked ? "var(--accent-soft)" : "var(--surface)",
                        border: `1px solid ${checked ? "var(--accent-line)" : "var(--border)"}`,
                        borderRadius: 7,
                        cursor: "pointer",
                        textAlign: "left",
                        color: "inherit",
                        fontFamily: "inherit",
                      }}
                    >
                      <div className="flex flex-col" style={{ minWidth: 0, gap: 2 }}>
                        <span
                          className="fg-2"
                          style={{ fontSize: 13.5, fontWeight: 500 }}
                        >
                          {p.displayName}
                        </span>
                        <span className="tiny muted">
                          {p.relationship} · {p.txnCount} txn
                          {p.txnCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <span
                        aria-hidden
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
                          background: checked ? "var(--accent)" : "transparent",
                          color: "var(--accent-ink)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {checked && <Ico name="check" size={13} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer
          className="flex flex-col"
          style={{
            padding: "12px 20px 14px",
            borderTop: "1px solid var(--border)",
            gap: 8,
          }}
        >
          {error && (
            <span className="small" style={{ color: "var(--debit)" }}>
              {error}
            </span>
          )}
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="small">
              {selected.size === 0 ? (
                <span className="muted">No friends selected.</span>
              ) : (
                <>
                  Split{" "}
                  <span className="mono tabular fg-2">{shareCount}</span> ways ·{" "}
                  <span className="mono tabular fg-2">{fmtInr(perHead)}</span>{" "}
                  per head
                </>
              )}
            </span>
            <div className="flex items-center gap-2">
              {alreadyShared && (
                <button
                  type="button"
                  onClick={submitUnmark}
                  disabled={isPending}
                  className="btn btn-sm ghost"
                  style={{ color: "var(--debit)" }}
                >
                  <Ico name="x" size={13} /> Unmark
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="btn btn-sm outline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitMark}
                disabled={isPending || selected.size === 0}
                className="btn btn-sm primary"
              >
                {isPending ? (
                  "Saving…"
                ) : (
                  <>
                    <Ico name="check" size={13} />
                    {alreadyShared ? "Update" : "Mark as shared"}
                  </>
                )}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
