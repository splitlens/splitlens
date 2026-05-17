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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Ico } from "@/components/Ico";
import { fmtInr } from "@/lib/format";
import type {
  ReviewTransactionDetail,
  SplitQueueRow,
} from "@/lib/review-repo";
import {
  updateTransaction,
  applyMerchantRule,
  countOtherUnreviewedForMerchant,
  getTransactionDetailForSplit,
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
  category,
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
  /** Category-grouped nav context. The queue sorts rows by category
   *  so arrow-keying walks through all same-category txns before
   *  changing category. We surface progress + animate the header
   *  when the category changes between rows. */
  category: {
    name: string;
    positionInCategory: number;
    totalInCategory: number;
  };
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

  // Detail-pane state. Default closed — the modal stays narrow and
  // focused on the split decision. Click on the txn header card
  // (counterparty + amount block) toggles open; we lazy-fetch the
  // full ReviewTransactionDetail then. Cached per-row so re-opening
  // is instant.
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ReviewTransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    // Reset detail cache when the row changes; refetch only if the
    // pane is currently open.
    setDetail(null);
    if (!detailOpen) return;
    let cancelled = false;
    setDetailLoading(true);
    getTransactionDetailForSplit(row.id).then((d) => {
      if (cancelled) return;
      setDetail(d);
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, detailOpen]);

  // Category-change detection. The queue is sorted by category so
  // arrow-keying walks through same-category rows. When the category
  // shifts (last few Tea & Cigarettes done; first Food row appears)
  // we briefly highlight the category strip so the user sees the
  // transition. Tracked via useRef so it only flips on actual change,
  // not on every re-render.
  const prevCategoryRef = useRef<string | null>(null);
  const [categoryChanged, setCategoryChanged] = useState(false);
  useEffect(() => {
    const prev = prevCategoryRef.current;
    if (prev !== null && prev !== category.name) {
      setCategoryChanged(true);
      const t = window.setTimeout(() => setCategoryChanged(false), 700);
      prevCategoryRef.current = category.name;
      return () => window.clearTimeout(t);
    }
    prevCategoryRef.current = category.name;
  }, [category.name]);

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
            // Modal grows when the detail pane is open so the form
            // doesn't shrink. 640 stays the form's width — the extra
            // 420 houses the detail pane drawer. Timing matches the
            // inner aside's width animation (320ms easeOutExpo) so
            // the shell and the drawer expand in lockstep.
            maxWidth: detailOpen ? 1060 : 640,
            maxHeight: "90vh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
            transition: "max-width 320ms cubic-bezier(0.16, 1, 0.3, 1)",
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

          {/* Category strip — shows progress within the active
              category. Pulses accent when the category changes
              between rows so the user sees the transition. */}
          <div
            style={{
              padding: "10px 22px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: categoryChanged
                ? "var(--accent-soft)"
                : "var(--surface-2)",
              transition:
                "background 600ms var(--ease-out-expo)",
            }}
          >
            <Ico
              name="filter"
              size={13}
              className={categoryChanged ? "accent" : "muted"}
            />
            <span
              className="eyebrow"
              style={{
                color: categoryChanged ? "var(--accent)" : "var(--muted)",
                transition: "color 600ms var(--ease-out-expo)",
              }}
            >
              {category.name}
            </span>
            <span
              className="mono tabular"
              style={{
                fontSize: 11.5,
                color: "var(--muted-2)",
                marginLeft: "auto",
              }}
            >
              {category.positionInCategory} of {category.totalInCategory}{" "}
              in this category
            </span>
            {/* Progress bar within category */}
            <div
              aria-hidden
              style={{
                width: 80,
                height: 3,
                background: "var(--surface-3)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${
                    category.totalInCategory > 0
                      ? (category.positionInCategory /
                          category.totalInCategory) *
                        100
                      : 0
                  }%`,
                  height: "100%",
                  background: "var(--accent)",
                  transition: "width 220ms var(--ease-out)",
                }}
              />
            </div>
          </div>

          {/* Body — two-pane when detail is open. Left: existing form.
              Right: detail pane (raw narration, account, sources, etc). */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                flex: detailOpen ? "0 0 640px" : "1 1 auto",
                overflowY: "auto",
                padding: "18px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 18,
                minWidth: 0,
              }}
            >
            {/* Counterparty + amount — clickable to toggle the detail pane */}
            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              aria-expanded={detailOpen}
              title={
                detailOpen
                  ? "Close transaction detail"
                  : "Click for raw bank narration, account, source info"
              }
              className="txn-header-clickable"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 10,
                padding: "8px 10px",
                margin: "-8px -10px",
                cursor: "pointer",
                color: "inherit",
                fontFamily: "inherit",
                transition:
                  "background 180ms var(--ease-out), border-color 180ms var(--ease-out)",
              }}
            >
              <div
                className="flex items-center"
                style={{ gap: 8 }}
              >
                <h2
                  className="h1"
                  style={{ fontSize: 26, letterSpacing: "-0.01em", flex: 1, minWidth: 0 }}
                >
                  {row.counterparty}
                </h2>
                <Ico
                  name={detailOpen ? "chevron-right" : "more"}
                  size={14}
                  className="muted-2"
                />
              </div>
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
            </button>

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

            {/* Right pane — detail. Animates its own width on
                enter/exit so the reveal feels like a drawer sliding
                out from the modal's right edge, not a fade.
                AnimatePresence is what allows the exit animation to
                fire when detailOpen flips back to false. */}
            <AnimatePresence initial={false}>
              {detailOpen && (
                <motion.aside
                  key="detail-pane"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 420, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{
                    width: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
                    opacity: {
                      duration: 0.2,
                      ease: [0.16, 1, 0.3, 1],
                      delay: 0.04,
                    },
                  }}
                  style={{
                    flex: "0 0 auto",
                    overflow: "hidden",
                    borderLeft: "1px solid var(--border)",
                    background: "var(--surface-2)",
                  }}
                >
                  <motion.div
                    initial={{ x: 24, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 24, opacity: 0 }}
                    transition={{
                      duration: 0.26,
                      ease: [0.16, 1, 0.3, 1],
                      delay: 0.06,
                    }}
                    style={{
                      width: 420,
                      height: "100%",
                      overflowY: "auto",
                      padding: "18px 22px",
                    }}
                  >
                    <DetailPane
                      row={row}
                      detail={detail}
                      loading={detailLoading}
                      onClose={() => setDetailOpen(false)}
                    />
                  </motion.div>
                </motion.aside>
              )}
            </AnimatePresence>
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

/**
 * Side detail pane — opens when the user clicks the txn header card
 * in SplitTxnModal. Surfaces the things the user can't infer from
 * the headline alone but commonly wants while deciding "should I
 * split this":
 *
 *   - Raw bank narration (the verbatim string before normalization)
 *   - UTR / ref no for cross-checking with bank/UPI app
 *   - Account this debit came from (bank + last4)
 *   - Source extractors that observed this txn (which kind of
 *     statement / email / OCR contributed)
 *   - Counterparty kind (person / vpa / bill / named)
 *   - Notes the user previously left
 *   - Attached files (Zepto invoice PDFs, OCR'd receipts, etc.)
 *
 * Lazily-fetched: SplitTxnModal calls getTransactionDetailForSplit
 * on first open. Shows a loading state while the fetch is in flight.
 */
function DetailPane({
  row,
  detail,
  loading,
  onClose,
}: {
  row: SplitQueueRow;
  detail: ReviewTransactionDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Ico name="more" size={14} className="muted" />
        <span className="eyebrow" style={{ flex: 1 }}>
          Transaction detail
        </span>
        <button
          type="button"
          className="btn btn-sm ghost"
          onClick={onClose}
          aria-label="Close detail pane"
          style={{ padding: "2px 8px" }}
        >
          <Ico name="x" size={12} />
        </button>
      </header>

      {loading && (
        <div className="small muted">Loading…</div>
      )}

      {!loading && !detail && (
        <div className="small muted">
          Couldn&rsquo;t fetch detail. The txn may have been removed.
        </div>
      )}

      {detail && (
        <>
          <Field label="Bank narration">
            <span
              className="mono"
              style={{
                fontSize: 12,
                color: "var(--fg-2)",
                wordBreak: "break-word",
              }}
            >
              {detail.narration ?? "—"}
            </span>
          </Field>

          <Field label="From account">
            <span style={{ fontSize: 13, color: "var(--fg)" }}>
              {detail.account.bank} {detail.account.type}
            </span>
            <span
              className="mono"
              style={{
                marginLeft: 6,
                fontSize: 12,
                color: "var(--muted-2)",
              }}
            >
              ···{detail.account.last4}
            </span>
          </Field>

          {detail.refNo && (
            <Field label="UTR / Ref">
              <span
                className="mono"
                style={{ fontSize: 12, color: "var(--fg-2)" }}
              >
                {detail.refNo}
              </span>
            </Field>
          )}

          <Field label="Counterparty kind">
            <span style={{ fontSize: 13, color: "var(--fg-2)" }}>
              {detail.counterpartyKind ?? "unknown"}
              {detail.personId && (
                <span style={{ color: "var(--muted-2)", marginLeft: 6 }}>
                  · person id <span className="mono">{detail.personId}</span>
                </span>
              )}
            </span>
          </Field>

          {detail.sources.length > 0 && (
            <Field label={`Sources · ${detail.sources.length}`}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 5,
                  marginTop: 4,
                }}
              >
                {detail.sources.map((s, i) => (
                  <span
                    key={`${s.sourceType}-${i}`}
                    className="chip chip-sm"
                    style={{
                      fontSize: 11,
                      background: "var(--surface)",
                      borderColor: "var(--border)",
                      color: "var(--fg-2)",
                    }}
                  >
                    {s.sourceType}
                  </span>
                ))}
              </div>
            </Field>
          )}

          {detail.attachedFiles.length > 0 && (
            <Field label={`Attached · ${detail.attachedFiles.length}`}>
              <div className="flex flex-col" style={{ gap: 4 }}>
                {detail.attachedFiles.map((f, i) => (
                  <span
                    key={`${f.sourceType}-${i}`}
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      wordBreak: "break-all",
                    }}
                  >
                    <Ico name="paperclip" size={11} /> {f.path.split("/").pop()}
                  </span>
                ))}
              </div>
            </Field>
          )}

          {detail.notes && (
            <Field label="Notes">
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--fg-2)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {detail.notes}
              </span>
            </Field>
          )}

          {detail.inferredLocation && (
            <Field label="Inferred location">
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--fg-2)",
                }}
              >
                {detail.inferredLocation.placeName ?? "—"}
                {detail.inferredLocation.placeCategory && (
                  <span style={{ color: "var(--muted-2)", marginLeft: 6 }}>
                    · {detail.inferredLocation.placeCategory}
                  </span>
                )}
              </span>
            </Field>
          )}

          {row.personId && detail.counterpartyKind === "person" && (
            <a
              href={`/friends/${row.personId}`}
              className="btn btn-sm outline"
              style={{ marginTop: 6, justifyContent: "center" }}
            >
              <Ico name="users" size={13} /> Open Friends ledger
            </a>
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        className="eyebrow"
        style={{ fontSize: 10.5, letterSpacing: "0.05em" }}
      >
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}
