"use client";

/**
 * SplitTxnModal — focused per-transaction split decision UI.
 *
 * Visually distinct from InboxModal (which is category-first). This
 * modal puts who / balance / settlement at the top of the visual
 * hierarchy, and treats category as an after-thought.
 *
 *   Header        ← Prev · Next →  · Skip · Esc
 *   Big number    The txn amount, with direction tint
 *   Counterparty  Plain name + a "transferred via X" subtitle
 *
 *   SUGGESTED SPLIT (when we have a person_id → known person)
 *     "Split 2-way with Rahul · they'll owe you ₹2,100"
 *     [ Apply ↵ ]   [ Just me ]
 *
 *   FRIENDS PICKER
 *     [ Just me ] [ Split with friends ]
 *     friend chips (toggle to include)
 *     N-way · ₹X each
 *
 *   HOW OFTEN  (small, optional — only shows if user wants to set it)
 *     one-time · weekly · monthly · …
 *
 *   BULK RULE
 *     ☑ Always split "X" 2-way with Rahul  · applies to N other un-reviewed
 *
 *   Footer        Skip · Save & Next
 *
 * Wires into the existing applyMerchantRule + updateTransaction
 * server actions so the data semantics are identical to the
 * InboxModal — we just present a different view.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Ico } from "@/components/Ico";
import { fmtInr } from "@/lib/format";
import type { SplitQueueRow } from "@/lib/review-repo";
import {
  updateTransaction,
  applyMerchantRule,
  countOtherUnreviewedForMerchant,
} from "@/app/review/actions";

export function SplitTxnModal({
  row,
  people,
  onClose,
  onPrev,
  onNext,
  onAfterSave,
  positionIdx,
  positionTotal,
}: {
  row: SplitQueueRow;
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAfterSave: () => void;
  positionIdx: number;
  positionTotal: number;
}) {
  // Local form state — initialized from the row's current values.
  // Recurrence lives in the categorization modal (InboxModal at
  // /review/category), not here — splitting is about *who paid* and
  // *who owes what*, not about cadence.
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [shareCount, setShareCount] = useState<number>(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [otherCount, setOtherCount] = useState(0);
  const [applyRule, setApplyRule] = useState(true);

  // Reset state whenever the txn changes (when Prev/Next swaps the
  // row out from under us).
  useEffect(() => {
    setSharedWith([]);
    setShareCount(1);
    setErr(null);
    setApplyRule(true);
    let cancelled = false;
    countOtherUnreviewedForMerchant(row.counterparty, row.id).then((n) => {
      if (!cancelled) setOtherCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.counterparty]);

  const split = shareCount > 1 || sharedWith.length > 0;
  const ways = Math.max(shareCount, sharedWith.length + 1, split ? 2 : 1);
  const perPerson = ways > 0 ? row.amount / ways : row.amount;
  const yourShare = perPerson;
  const owedToYou = row.direction === "debit" ? row.amount - yourShare : 0;

  const toggleFriend = useCallback(
    (displayName: string) => {
      setSharedWith((prev) => {
        const next = prev.includes(displayName)
          ? prev.filter((n) => n !== displayName)
          : [...prev, displayName];
        setShareCount(next.length + 1);
        return next;
      });
    },
    [],
  );

  const applySuggested = useCallback(() => {
    if (!row.suggestedSplitWith) return;
    setSharedWith([row.suggestedSplitWith]);
    setShareCount(2);
  }, [row.suggestedSplitWith]);

  const setJustMe = useCallback(() => {
    setSharedWith([]);
    setShareCount(1);
  }, []);

  const save = useCallback(
    async (alsoReviewed: boolean) => {
      setSaving(true);
      setErr(null);
      const update = await updateTransaction(row.id, {
        sharedWith: split ? sharedWith : null,
        shareCount: split ? shareCount : 1,
        ...(alsoReviewed ? { markReviewed: true } : {}),
      });
      if (!update.ok) {
        setSaving(false);
        setErr(update.error);
        return;
      }
      // Bulk-apply share rule if the user kept the checkbox + there
      // are siblings. Split-only: this modal doesn't touch recurrence
      // (that's the category modal's job).
      if (applyRule && otherCount > 0 && split) {
        const bulk = await applyMerchantRule(row.counterparty, {
          sharedWith: split ? sharedWith : null,
          shareCount: split ? shareCount : 1,
        });
        if (!bulk.ok) {
          setSaving(false);
          setErr(`Saved this txn but rule failed: ${bulk.error}`);
          return;
        }
      }
      setSaving(false);
      onAfterSave();
    },
    [
      row.id,
      row.counterparty,
      sharedWith,
      shareCount,
      split,
      applyRule,
      otherCount,
      onAfterSave,
    ],
  );

  // Keyboard: ⏎ saves + advances, Esc closes, ←/→ navigates, S = just me.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't steal keys when the user is typing in an input.
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "Enter") {
        e.preventDefault();
        void save(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" || e.key === "/") {
        e.preventDefault();
        onNext();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        applySuggested();
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setJustMe();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, onClose, onPrev, onNext, applySuggested, setJustMe]);

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => b.txnCount - a.txnCount),
    [people],
  );

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "color-mix(in srgb, var(--bg) 78%, transparent)",
          backdropFilter: "blur(5px)",
        }}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="surface"
          style={{
            width: "100%",
            maxWidth: 640,
            maxHeight: "90vh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
          }}
        >
          {/* Header */}
          <header
            style={{
              padding: "12px 22px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="eyebrow eyebrow-accent">Split · {positionIdx} of {positionTotal}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {fmtDate(row.txnDate)} · {row.counterpartyKind ?? "txn"}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm ghost" onClick={onPrev}>
              <Ico name="arrow-left" size={13} />
              <span className="kbd">←</span>
            </button>
            <button type="button" className="btn btn-sm ghost" onClick={onNext}>
              <Ico name="arrow-right" size={13} />
              <span className="kbd">→</span>
            </button>
            <button
              type="button"
              className="btn btn-sm ghost"
              aria-label="Close"
              onClick={onClose}
            >
              <Ico name="x" size={13} />
            </button>
          </header>

          {/* Body */}
          <div style={{ overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Counterparty + amount */}
            <div>
              <h2
                className="h1"
                style={{ fontSize: 26, letterSpacing: "-0.01em" }}
              >
                {row.counterparty}
              </h2>
              <div className="muted small" style={{ marginTop: 4 }}>
                {row.category ?? "Uncategorized"}
                {row.recurrence && row.recurrence !== "one_time" && (
                  <>
                    {" · "}
                    <span className="accent">{row.recurrence}</span>
                  </>
                )}
              </div>
              <div
                className="num-amount"
                style={{
                  fontSize: 48,
                  marginTop: 14,
                  color:
                    row.direction === "debit"
                      ? "var(--debit)"
                      : "var(--credit)",
                }}
              >
                {row.direction === "debit" ? "−" : "+"}
                {fmtInr(row.amount)}
              </div>
            </div>

            {/* Suggested split (only when we have a person target + not already split) */}
            {row.suggestedSplitWith && !split && (
              <button
                type="button"
                onClick={applySuggested}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 14px",
                  background:
                    "linear-gradient(180deg, var(--accent-soft), transparent 100%)",
                  border: "1px solid var(--accent-line)",
                  borderRadius: 10,
                  cursor: "pointer",
                  color: "var(--fg)",
                  fontFamily: "inherit",
                  textAlign: "left",
                  transition: "filter 180ms ease",
                }}
              >
                <Ico name="sparkles" size={16} className="accent" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--fg)" }}>
                    Split <b style={{ fontWeight: 500 }}>2-way</b> with{" "}
                    <b style={{ fontWeight: 500, color: "var(--accent)" }}>
                      {row.suggestedSplitWith}
                    </b>
                  </div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>
                    They&rsquo;ll owe you {fmtInr(row.amount / 2)}{" "}
                    (your half: {fmtInr(row.amount / 2)})
                  </div>
                </div>
                <span className="kbd">S</span>
              </button>
            )}

            {/* Friends picker */}
            <div>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
                <span className="eyebrow">Whose expense</span>
                {split && (
                  <span className="tag mono">
                    {ways}-way · {fmtInr(perPerson)} each
                  </span>
                )}
              </div>
              <div
                className="flex"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 3,
                  gap: 2,
                  marginBottom: 10,
                }}
              >
                <button
                  type="button"
                  onClick={setJustMe}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: !split ? "var(--surface)" : "transparent",
                    border: !split
                      ? "1px solid var(--border-strong)"
                      : "1px solid transparent",
                    borderRadius: 6,
                    color: !split ? "var(--fg)" : "var(--muted)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Just me <span className="kbd" style={{ marginLeft: 6 }}>J</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!split) {
                      // Default to suggested or first known person
                      const target =
                        row.suggestedSplitWith ??
                        sortedPeople[0]?.displayName;
                      if (target) {
                        setSharedWith([target]);
                        setShareCount(2);
                      }
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: split ? "var(--surface)" : "transparent",
                    border: split
                      ? "1px solid var(--border-strong)"
                      : "1px solid transparent",
                    borderRadius: 6,
                    color: split ? "var(--fg)" : "var(--muted)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Split with friends
                </button>
              </div>
              {split && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  {sortedPeople.map((p) => {
                    const on = sharedWith.includes(p.displayName);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleFriend(p.displayName)}
                        className="chip"
                        style={{
                          background: on
                            ? "var(--accent-soft)"
                            : "transparent",
                          borderColor: on
                            ? "var(--accent-line)"
                            : "var(--border)",
                          color: on ? "var(--accent)" : "var(--fg-2)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {on && <Ico name="check" size={11} />}
                        {p.displayName}
                      </button>
                    );
                  })}
                </div>
              )}
              {split && row.direction === "debit" && (
                <div
                  className="small"
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    background: "var(--surface-2)",
                    border: "1px dashed var(--border)",
                    borderRadius: 7,
                    color: "var(--muted)",
                  }}
                >
                  You paid {fmtInr(row.amount)}; your share is{" "}
                  <b style={{ color: "var(--fg)", fontWeight: 500 }}>
                    {fmtInr(yourShare)}
                  </b>{" "}
                  · {sharedWith.length > 0 ? "they owe you" : "others owe you"}{" "}
                  <b
                    style={{ color: "var(--credit)", fontWeight: 500 }}
                  >
                    +{fmtInr(owedToYou)}
                  </b>
                </div>
              )}
            </div>

            {/* Bulk rule offer */}
            {otherCount > 0 && split && (
              <button
                type="button"
                onClick={() => setApplyRule((v) => !v)}
                aria-pressed={applyRule}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: applyRule
                    ? "var(--accent-soft)"
                    : "var(--surface-2)",
                  border: `1px solid ${
                    applyRule ? "var(--accent-line)" : "var(--border)"
                  }`,
                  borderRadius: 8,
                  color: "var(--fg)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 4,
                    border: `1.5px solid ${
                      applyRule ? "var(--accent)" : "var(--border-strong)"
                    }`,
                    background: applyRule ? "var(--accent)" : "transparent",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: "var(--accent-ink)",
                  }}
                >
                  {applyRule && <Ico name="check" size={10} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  Save this as a rule —{" "}
                  applies to <b style={{ fontWeight: 500 }}>{otherCount}</b>{" "}
                  other un-reviewed{" "}
                  <b style={{ fontWeight: 500 }}>
                    “{row.counterparty}”
                  </b>{" "}
                  txn{otherCount === 1 ? "" : "s"} and every future one
                </span>
                <Ico name="sparkles" size={13} className="accent" />
              </button>
            )}

            {err && (
              <div
                className="small"
                style={{ color: "var(--warn)" }}
              >
                {err}
              </div>
            )}
          </div>

          {/* Footer */}
          <footer
            style={{
              padding: "12px 22px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="tiny muted" style={{ flex: 1 }}>
              <span className="kbd">↵</span> save · <span className="kbd">S</span> apply suggested · <span className="kbd">J</span> just me · <span className="kbd">/</span> skip · <span className="kbd">Esc</span> close
            </span>
            <button
              type="button"
              className="btn btn-sm ghost"
              onClick={onNext}
              disabled={saving}
            >
              Skip
            </button>
            <button
              type="button"
              className="btn btn-sm primary"
              onClick={() => save(true)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save & Next"}{" "}
              <span className="kbd kbd-on-accent">↵</span>
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}
