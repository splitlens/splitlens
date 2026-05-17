"use client";

/**
 * InboxModal — the design's "A · The Inbox" per-transaction view, rendered
 * as a centered modal that opens when a row is clicked on /review.
 *
 * Layout (per the hifi design):
 *   1. Top meta strip      Unreviewed pill · #id · account · UTR · attach/flag/more
 *   2. Hero                Serif counterparty + meta line · DEBIT/CREDIT pill + serif amount
 *   3. Smart suggest       Accept (A) the proposed category/recurrence in a single shot
 *   4. Category grid       4×4 chip grid (curated + custom + add new) with keyboard hints
 *   5. Whose / How often   Two segmented controls
 *   6. Footer              Prev (←/K) · Next (→/J) · Skip (/) · Save (S) ·
 *                          Mark reviewed + Next (⏎)
 *
 * The "Up next" right column from the hifi spec is intentionally left out
 * here — when this is rendered as a modal, the up-next list is the page
 * behind it.
 */
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { Ico } from "@/components/Ico";
import type {
  ReviewInferredLocation,
  ReviewListRow,
  ReviewProductHint,
  ReviewTransactionDetail,
} from "@/lib/review-repo";
import type { MerchantHistory } from "@splitlens/core";
import { displayCounterparty } from "@/lib/narration";
import { fmtInr } from "@/lib/format";
import { extractCounterpartyFromNarration } from "@/lib/narration";
import {
  updateTransaction,
  markReviewed,
  unmarkReviewed,
  saveMerchantLabel,
  type TransactionEdits,
} from "@/app/review/actions";
import {
  CATEGORIES,
  RECURRENCES,
  type CategoryDef,
  type RecurrenceId,
  getCategory,
  getRecurrence,
  isValidRecurrence,
} from "@/lib/taxonomy";

import { BillAttachDropzone } from "./BillAttachDropzone";
import { CreateCategoryForm } from "./CreateCategoryForm";
import { MerchantDetailView } from "./MerchantDetailView";

export interface InboxModalProps {
  open: boolean;
  onClose: () => void;
  txn: ReviewTransactionDetail | null;
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  customCategories: CategoryDef[];
  unreviewedRemaining: number;
  positionIdx: number;
  positionTotal: number;
  /**
   * The full visible list (already filtered by URL state). Used to render
   * the "Up next" rail and to detect bulk-nudge candidates (multiple
   * unreviewed txns with the same counterparty as the current one).
   */
  listRows: ReviewListRow[];
  /** Index of the current txn within `listRows`. -1 when not in the list. */
  activeIdx: number;
  onPrev: () => void;
  onNext: () => void;
  /** Jump directly to a different txn (used by the Up Next rail). */
  onSelectId: (id: number) => void;
  onAfterSave: () => void;
  onAfterAttach: () => void;
  onSkipToNext: () => void;
}

/**
 * Keyboard map for the curated category chip grid. Mirrors the design's
 * 4×4 layout (1-9 across the top three rows, then Q-W-E-R-T-Y-U for the
 * fourth row). The position of a category in `CATEGORIES` decides its key.
 */
const CATEGORY_KEYS = [
  "1", "2", "3", "4",
  "5", "6", "7", "8",
  "9", "Q", "W", "E",
  "R", "T", "Y", "U",
] as const;

/**
 * View mode inside the modal:
 *   - "txn":     normal InboxBody (the edit form + right rail)
 *   - "merchant" takeover via MerchantDetailView (clicked into from the
 *                merchant history card; back arrow / Esc returns to txn)
 */
type InboxView =
  | { kind: "txn" }
  | { kind: "merchant"; counterparty: string; focusTxnId: number };

export function InboxModal(props: InboxModalProps) {
  const { open, onClose, txn, onSelectId } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<InboxView>({ kind: "txn" });

  // Reset the view to the txn form whenever the modal closes or the active
  // txn changes. Without this we'd carry a stale "merchant" mode across
  // navigation events that should drop us back at a fresh form.
  useEffect(() => {
    setView({ kind: "txn" });
  }, [open, txn?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // In merchant mode, Esc returns to the txn form instead of closing
      // the whole modal — matches the visual "back" affordance.
      if (view.kind === "merchant") {
        setView({ kind: "txn" });
      } else {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, view.kind]);

  const handleOpenMerchant = useCallback(
    (counterparty: string, focusTxnId: number) => {
      setView({ kind: "merchant", counterparty, focusTxnId });
    },
    [],
  );
  const handleBackFromMerchant = useCallback(() => {
    setView({ kind: "txn" });
  }, []);
  const handleSelectFromMerchant = useCallback(
    (id: number) => {
      // Jumping to a different txn from the merchant list — drop back to
      // the txn form so the user lands on the editor for the row they
      // clicked. The reset effect above also handles this when txn.id
      // changes, but doing it eagerly avoids a one-frame flash of the
      // merchant view against the new txn.
      setView({ kind: "txn" });
      onSelectId(id);
    },
    [onSelectId],
  );

  return (
    <AnimatePresence>
      {open && txn && (
        <div
          className="flex items-start justify-center"
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            padding: "32px 24px",
          }}
        >
          <motion.button
            type="button"
            aria-label="Close inbox"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              position: "absolute",
              inset: 0,
              background:
                "color-mix(in srgb, var(--page-bg) 75%, transparent)",
              backdropFilter: "blur(3px)",
              border: "none",
              cursor: "pointer",
            }}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="surface flex flex-col"
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 1200,
              maxHeight: "calc(100vh - 64px)",
              overflow: "hidden",
            }}
          >
            {view.kind === "merchant" ? (
              <MerchantDetailView
                counterparty={view.counterparty}
                focusTxnId={view.focusTxnId}
                onBack={handleBackFromMerchant}
                onClose={onClose}
                onSelectId={handleSelectFromMerchant}
              />
            ) : (
              <InboxBody
                key={txn.id}
                {...props}
                txn={txn}
                onOpenMerchantDetail={handleOpenMerchant}
              />
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// InboxBody — the actual editable form, remounted per txn so state resets
// ────────────────────────────────────────────────────────────────────────────

interface FormState {
  counterparty: string;
  category: string;
  narration: string;
  notes: string;
  personId: string;
  sharedWith: string[];
  shareCount: number;
  recurrence: RecurrenceId | null;
}

function initialFromTxn(txn: ReviewTransactionDetail): FormState {
  return {
    counterparty: txn.counterparty ?? "",
    category: txn.category ?? "",
    narration: txn.narration ?? "",
    notes: txn.notes ?? "",
    personId: txn.personId ?? "",
    sharedWith: txn.sharedWith,
    shareCount: txn.shareCount,
    recurrence: isValidRecurrence(txn.recurrence) ? txn.recurrence : null,
  };
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function InboxBody({
  txn,
  customCategories,
  people,
  positionIdx: _positionIdx,
  positionTotal,
  unreviewedRemaining,
  listRows,
  activeIdx,
  onClose,
  onPrev,
  onNext,
  onSelectId,
  onAfterSave,
  onAfterAttach,
  onSkipToNext,
  onOpenMerchantDetail,
}: InboxModalProps & {
  txn: ReviewTransactionDetail;
  /** Drill into the merchant deep-dive takeover. */
  onOpenMerchantDetail: (counterparty: string, focusTxnId: number) => void;
}) {
  void _positionIdx;
  const original = useMemo(() => initialFromTxn(txn), [txn]);
  const [form, setForm] = useState<FormState>(original);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);

  // Suggested counterparty from narration when the field is empty.
  const suggestedCounterparty = useMemo(
    () =>
      form.counterparty.trim().length > 0
        ? null
        : extractCounterpartyFromNarration(txn.narration),
    [form.counterparty, txn.narration],
  );

  const dirty =
    form.counterparty !== original.counterparty ||
    form.category !== original.category ||
    form.recurrence !== original.recurrence ||
    form.notes !== original.notes ||
    form.personId !== original.personId ||
    !sameStringArray(form.sharedWith, original.sharedWith) ||
    form.shareCount !== original.shareCount;

  const buildEdits = useCallback(
    (markReviewedFlag: boolean): TransactionEdits => {
      const e: TransactionEdits = {};
      if (form.counterparty !== original.counterparty)
        e.counterparty = form.counterparty.trim() || null;
      if (form.category !== original.category)
        e.category = form.category.trim() || null;
      if (form.notes !== original.notes) e.notes = form.notes.trim() || null;
      if (form.personId !== original.personId)
        e.personId = form.personId || null;
      if (!sameStringArray(form.sharedWith, original.sharedWith))
        e.sharedWith = form.sharedWith;
      if (form.shareCount !== original.shareCount)
        e.shareCount = form.shareCount;
      if (form.recurrence !== original.recurrence) e.recurrence = form.recurrence;
      if (markReviewedFlag) e.markReviewed = true;
      return e;
    },
    [form, original],
  );

  const save = useCallback(
    async (alsoReviewed: boolean) => {
      setSaving(true);
      setErrMsg(null);
      const r = await updateTransaction(txn.id, buildEdits(alsoReviewed));
      setSaving(false);
      if (!r.ok) {
        setErrMsg(r.error);
        return;
      }
      setSavedMsg(alsoReviewed ? "Saved + marked reviewed" : "Saved");
      window.setTimeout(() => setSavedMsg(null), 1800);
      onAfterSave();
    },
    [buildEdits, onAfterSave, txn.id],
  );

  const acceptSuggestion = useCallback(() => {
    if (!txn.suggestion) return;
    setForm((f) => ({
      ...f,
      category: txn.suggestion?.category ?? f.category,
      recurrence: isValidRecurrence(txn.suggestion?.recurrence ?? "")
        ? (txn.suggestion!.recurrence as RecurrenceId)
        : f.recurrence,
    }));
    setSuggestionDismissed(true);
  }, [txn.suggestion]);

  // Keyboard shortcuts at modal level
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      if (e.key === "a" || e.key === "A") {
        if (txn.suggestion && !suggestionDismissed) {
          e.preventDefault();
          acceptSuggestion();
        }
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void save(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void save(true);
      } else if (e.key === "j" || e.key === "J" || e.key === "ArrowRight") {
        // Seamless next: J (vim) or → (intuitive)
        e.preventDefault();
        onNext();
      } else if (e.key === "k" || e.key === "K" || e.key === "ArrowLeft") {
        // Seamless prev: K (vim) or ← (intuitive)
        e.preventDefault();
        onPrev();
      } else {
        // Category quick-pick via CATEGORY_KEYS — 1-9 are digits, Q-U are
        // letters. Compare against the upper-cased key so the user doesn't
        // have to hold shift.
        const k = e.key.toUpperCase();
        const idx = CATEGORY_KEYS.indexOf(k as (typeof CATEGORY_KEYS)[number]);
        if (idx !== -1 && idx < CATEGORIES.length) {
          e.preventDefault();
          const picked = CATEGORIES[idx]!;
          setForm((f) => ({
            ...f,
            category: f.category === picked.id ? "" : picked.id,
          }));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save, acceptSuggestion, onNext, onPrev, txn.suggestion, suggestionDismissed]);

  const direction = txn.withdrawal != null ? "debit" : "credit";
  const amount = txn.withdrawal ?? txn.deposit ?? 0;
  const wholeRupees = Math.floor(amount);
  const paise = Math.round((amount - wholeRupees) * 100);

  const activeCatDef = getCategory(form.category);
  const recDef = form.recurrence ? getRecurrence(form.recurrence) : null;

  const suggestionVisible =
    txn.suggestion &&
    !suggestionDismissed &&
    !txn.reviewed &&
    (!form.category || !form.recurrence);

  return (
    <div className="flex flex-col" style={{ minHeight: 0 }}>
      {/* ─── Top meta strip ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "14px 22px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {txn.reviewed ? (
            <span className="chip chip-sm">
              <span className="dot credit" /> Reviewed
            </span>
          ) : (
            <span className="chip chip-sm">
              <span className="dot warn" /> Unreviewed
            </span>
          )}
          <span className="tag">
            Txn #{txn.id.toLocaleString()}{" "}
            <span className="muted-2">
              of {positionTotal.toLocaleString()}
            </span>
          </span>
          <span className="tag">·</span>
          <span className="tag">
            {txn.account.bank} {txn.account.type} ···{txn.account.last4}
          </span>
          {txn.refNo && (
            <>
              <span className="tag">·</span>
              <span className="tag">
                UTR <span className="fg-2">{txn.refNo}</span>
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-sm ghost"
            onClick={() => setAttachOpen((v) => !v)}
          >
            <Ico name="paperclip" size={13} /> Attach
          </button>
          <button type="button" className="btn btn-sm ghost">
            <Ico name="flag" size={13} /> Flag
          </button>
          <button
            type="button"
            className="btn btn-sm ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <Ico name="x" size={13} />
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ overflow: "auto", minHeight: 0 }}>
        {/* ─── Hero ────────────────────────────────────────────────── */}
        <div
          className="flex items-end justify-between"
          style={{ padding: "24px 24px 18px" }}
        >
          <div className="flex flex-col gap-2" style={{ minWidth: 0, flex: 1 }}>
            <div
              className="hero-display"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {form.counterparty || (
                <span className="muted" style={{ fontStyle: "italic" }}>
                  (unknown)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 small flex-wrap">
              <span className="mono tabular">{txn.txnDate}</span>
              {txn.txnTime && (
                <>
                  <span className="muted-2">·</span>
                  <span className="mono">{txn.txnTime}</span>
                </>
              )}
              {txn.sources[0] && (
                <>
                  <span className="muted-2">·</span>
                  <span>via {txn.sources[0].sourceType.replace(/_/g, " ")}</span>
                </>
              )}
              <Ico name="arrow-right" size={13} className="muted-2" />
              <span>
                {txn.account.bank} ···{txn.account.last4}
              </span>
            </div>
            {suggestedCounterparty && (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({ ...f, counterparty: suggestedCounterparty }))
                }
                className="chip chip-sm accent"
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              >
                <Ico name="sparkles" size={13} /> Suggested: {suggestedCounterparty}
                · use this
              </button>
            )}
            <input
              type="text"
              value={form.counterparty}
              onChange={(e) =>
                setForm({ ...form, counterparty: e.target.value })
              }
              placeholder="(set a clean counterparty name)"
              style={{
                background: "transparent",
                border: "1px dashed var(--border)",
                borderRadius: 6,
                padding: "6px 10px",
                color: "var(--fg-2)",
                fontFamily: "inherit",
                fontSize: 13,
                outline: "none",
                marginTop: 6,
                maxWidth: 480,
              }}
            />
          </div>
          <div className="flex flex-col items-end gap-1" style={{ flexShrink: 0 }}>
            <div
              className="tiny mono"
              style={{
                color:
                  direction === "debit" ? "var(--debit)" : "var(--credit)",
              }}
            >
              {direction === "debit" ? "DEBIT" : "CREDIT"}
            </div>
            <div
              className={`num-amount ${direction}`}
              style={{ fontSize: 56, lineHeight: 1 }}
            >
              {direction === "debit" ? "−" : "+"}₹{wholeRupees.toLocaleString("en-IN")}
              <span className="muted-2" style={{ fontSize: 20 }}>
                .{String(paise).padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>

        {/* Attach dropzone — only when toggled open */}
        {attachOpen && (
          <div style={{ padding: "0 24px 18px" }}>
            <BillAttachDropzone
              txnId={txn.id}
              onAttached={(r) => {
                if (r.ok) {
                  setSavedMsg("Attached");
                  window.setTimeout(() => setSavedMsg(null), 2400);
                  onAfterAttach();
                } else {
                  setErrMsg(r.error);
                }
              }}
            />
          </div>
        )}

        <hr className="hr" />

        {/* ─── Smart suggest ───────────────────────────────────────── */}
        {suggestionVisible && txn.suggestion && (
          <div style={{ padding: "20px 24px 6px" }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <Ico name="sparkles" size={13} className="accent" />
              <span className="eyebrow eyebrow-accent">Smart suggest</span>
              <span className="small">{txn.suggestion.reason}</span>
            </div>
            <div
              className="flex flex-col"
              style={{
                padding: "14px 18px",
                background: "var(--accent-soft)",
                border: "1px solid var(--accent-line)",
                borderRadius: 10,
                gap: 12,
              }}
            >
              {/* Product hint headline — only when we have one. Pretends
                  to be a title; the chips below say "and this is the
                  category/recurrence we're guessing for it". */}
              {txn.suggestion.productHint && (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="h2 accent">
                    {txn.suggestion.productHint.label}
                  </span>
                  <span
                    className="tag mono"
                    title={
                      txn.suggestion.productHint.source === "user_label"
                        ? "You labelled this charge previously"
                        : "Best guess from known price points for this merchant"
                    }
                  >
                    {txn.suggestion.productHint.source === "user_label"
                      ? "your label"
                      : `likely · ${txn.suggestion.productHint.confidence} confidence`}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between flex-wrap" style={{ gap: 16 }}>
                <div className="flex items-center gap-3 flex-wrap">
                  {txn.suggestion.category && (
                    <span
                      className={txn.suggestion.productHint ? "small accent" : "h2 accent"}
                    >
                      {getCategory(txn.suggestion.category).emoji}{" "}
                      {getCategory(txn.suggestion.category).label}
                    </span>
                  )}
                  {txn.suggestion.recurrence &&
                    txn.suggestion.recurrence !== "one_time" && (
                      <span
                        className="chip chip-sm"
                        style={{
                          borderColor: "var(--accent-line)",
                          color: "var(--accent)",
                        }}
                      >
                        {getRecurrence(txn.suggestion.recurrence).emoji}{" "}
                        {getRecurrence(txn.suggestion.recurrence).label}
                      </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    onClick={() => setSuggestionDismissed(true)}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={acceptSuggestion}
                  >
                    <Ico name="check" size={13} /> Accept{" "}
                    <span className="kbd kbd-on-accent">A</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Category chip grid ──────────────────────────────────── */}
        <div style={{ padding: "20px 24px 6px" }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <span className="eyebrow">Category</span>
            <span className="small muted-2">
              {activeCatDef.label}
              {txn.categoryRule && form.category === original.category && (
                <>
                  {" "}
                  · auto: <code className="mono">{txn.categoryRule}</code>
                </>
              )}
            </span>
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 6,
            }}
          >
            {CATEGORIES.map((c, i) => (
              <CatChip
                key={c.id}
                def={c}
                active={c.id === activeCatDef.id}
                kbd={CATEGORY_KEYS[i]}
                onClick={() => setForm({ ...form, category: c.id === activeCatDef.id ? "" : c.id })}
              />
            ))}
            {customCategories.map((c) => (
              <CatChip
                key={c.id}
                def={c}
                active={c.id === activeCatDef.id}
                onClick={() => setForm({ ...form, category: c.id === activeCatDef.id ? "" : c.id })}
                badge="custom"
              />
            ))}
            <button
              type="button"
              className={`chip ${addingCategory ? "accent" : "ghost"}`}
              style={{ justifyContent: "center", padding: "7px 12px" }}
              onClick={() => setAddingCategory((v) => !v)}
            >
              <Ico name={addingCategory ? "x" : "plus"} size={13} />{" "}
              {addingCategory ? "Cancel" : "New category"}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {addingCategory && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                style={{ overflow: "hidden" }}
              >
                <CreateCategoryForm
                  onCancel={() => setAddingCategory(false)}
                  onCreated={(newId) => {
                    setAddingCategory(false);
                    setForm((f) => ({ ...f, category: newId }));
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── Whose / How often segmented controls ───────────────── */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
            padding: "16px 24px 22px",
          }}
        >
          <WhoseExpense
            amount={amount}
            shareCount={form.shareCount}
            sharedWith={form.sharedWith}
            people={people}
            onChange={(next) =>
              setForm((f) => ({
                ...f,
                sharedWith: next.sharedWith,
                shareCount: next.shareCount,
              }))
            }
          />
          <div className="flex flex-col gap-2">
            <span className="eyebrow">How often</span>
            <Segment
              options={RECURRENCES.map((r) => ({
                key: r.id,
                label: r.label,
                active: (form.recurrence ?? "one_time") === r.id,
                onClick: () =>
                  setForm({ ...form, recurrence: r.id === "one_time" ? null : r.id }),
              }))}
            />
            {recDef && recDef.id !== "one_time" && (
              <div className="tiny muted-2">{recDef.hint}</div>
            )}
          </div>
        </div>

        {/* ─── Notes (collapsible) ────────────────────────────────── */}
        <details
          style={{
            borderTop: "1px solid var(--border)",
          }}
        >
          <summary
            style={{
              padding: "10px 24px",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 12.5,
            }}
          >
            More fields — Person · Narration · Notes
          </summary>
          <div className="flex flex-col gap-3" style={{ padding: "0 24px 18px" }}>
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Notes</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="Free-form context only you can give."
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  color: "var(--fg)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  outline: "none",
                  resize: "vertical",
                }}
              />
            </label>
          </div>
        </details>
        </div>

        {/* ─── Right rail: Up Next + BulkNudge ──────────────────────── */}
        <UpNextRail
          currentTxn={txn}
          listRows={listRows}
          activeIdx={activeIdx}
          onSelectId={onSelectId}
          onAfterLabelSaved={onAfterSave}
          onOpenMerchantDetail={onOpenMerchantDetail}
        />
      </div>

      <hr className="hr" />

      {/* ─── Footer actions ───────────────────────────────────────── */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "14px 22px",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-sm ghost" onClick={onPrev}>
            <Ico name="chevron-left" size={13} /> Prev <span className="kbd">←</span>
          </button>
          <button type="button" className="btn btn-sm ghost" onClick={onNext}>
            Next <span className="kbd">→</span> <Ico name="chevron-right" size={13} />
          </button>
          <button type="button" className="btn btn-sm ghost" onClick={onSkipToNext}>
            Skip <span className="kbd">/</span>
          </button>
          <UnmarkButton
            reviewed={txn.reviewed}
            txnId={txn.id}
            onAfter={onAfterSave}
          />
        </div>
        <div className="flex items-center gap-2">
          {savedMsg && (
            <span className="small credit">✓ {savedMsg}</span>
          )}
          {errMsg && <span className="small debit">⚠ {errMsg}</span>}
          <span className="tag">
            <span className="mono">{unreviewedRemaining.toLocaleString()}</span> left
          </span>
          <button
            type="button"
            className="btn btn-sm outline"
            disabled={saving || !dirty}
            onClick={() => void save(false)}
          >
            Save only <span className="kbd">S</span>
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void save(true)}
          >
            {dirty ? "Save + Next" : "Mark reviewed + Next"}{" "}
            <Ico name="arrow-right" size={13} />{" "}
            <span className="kbd kbd-on-accent">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CatChip({
  def,
  active,
  onClick,
  badge,
  kbd,
}: {
  def: CategoryDef;
  active: boolean;
  onClick: () => void;
  badge?: string;
  kbd?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={`chip ${active ? "accent" : ""}`}
      title={def.hint}
      style={{
        justifyContent: "space-between",
        padding: "7px 12px",
        fontSize: 13,
      }}
    >
      <span className="flex items-center gap-1" style={{ minWidth: 0 }}>
        <span aria-hidden>{def.emoji}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {def.label}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {badge && (
          <span
            className="tiny"
            style={{
              opacity: 0.6,
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {badge}
          </span>
        )}
        {kbd && <span className="kbd">{kbd}</span>}
      </span>
    </motion.button>
  );
}

function Segment({
  options,
}: {
  options: {
    key: string;
    label: string;
    icon?: import("@/components/Ico").IcoName;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <div
      className="flex"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={o.onClick}
          className="flex items-center gap-2"
          style={{
            flex: 1,
            padding: "6px 10px",
            background: o.active ? "var(--surface)" : "transparent",
            border: o.active
              ? "1px solid var(--border-strong)"
              : "1px solid transparent",
            borderRadius: 6,
            color: o.active ? "var(--fg)" : "var(--muted)",
            fontSize: 12.5,
            justifyContent: "center",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {o.icon && <Ico name={o.icon} size={13} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function UnmarkButton({
  reviewed,
  txnId,
  onAfter,
}: {
  reviewed: boolean;
  txnId: number;
  onAfter: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!reviewed) return null;
  return (
    <button
      type="button"
      className="btn btn-sm ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await unmarkReviewed(txnId);
        setBusy(false);
        onAfter();
      }}
    >
      Unmark reviewed
    </button>
  );
}

// markReviewed is unused but exported by actions; keep the import warning-free.
void markReviewed;

// ────────────────────────────────────────────────────────────────────────────
// WhoseExpense — Just-me / Split segmented + friend chips + per-share math.
//
//   Click "Just me"   → sharedWith=[], shareCount=1
//   Click "Split"     → shareCount bumped to 2 if it was 1, friend picker
//                       reveals itself
//   Toggle a friend   → adds/removes from sharedWith; shareCount tracks
//                       sharedWith.length + 1 (the "me" share)
// ────────────────────────────────────────────────────────────────────────────

function WhoseExpense({
  amount,
  shareCount,
  sharedWith,
  people,
  onChange,
}: {
  amount: number;
  shareCount: number;
  sharedWith: string[];
  people: InboxModalProps["people"];
  onChange: (next: { sharedWith: string[]; shareCount: number }) => void;
}) {
  const split = shareCount > 1 || sharedWith.length > 0;
  const selectedSet = useMemo(() => new Set(sharedWith), [sharedWith]);
  const ways = Math.max(shareCount, sharedWith.length + 1, split ? 2 : 1);
  const perPerson = ways > 0 ? amount / ways : amount;

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => b.txnCount - a.txnCount),
    [people],
  );
  const [expanded, setExpanded] = useState(false);
  const VISIBLE = 4;
  const { visible, hiddenCount } = useMemo(() => {
    if (expanded) return { visible: sortedPeople, hiddenCount: 0 };
    const top = sortedPeople.slice(0, VISIBLE);
    const extraSelected = sortedPeople
      .slice(VISIBLE)
      .filter((p) => selectedSet.has(p.displayName));
    const v = [...top, ...extraSelected];
    return { visible: v, hiddenCount: sortedPeople.length - v.length };
  }, [expanded, sortedPeople, selectedSet]);

  const toggleFriend = (displayName: string) => {
    const next = selectedSet.has(displayName)
      ? sharedWith.filter((n) => n !== displayName)
      : [...sharedWith, displayName];
    onChange({ sharedWith: next, shareCount: next.length + 1 });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Whose expense</span>
        {split && (
          <span className="tag mono">
            {ways}-way · {fmtInr(perPerson)} each
          </span>
        )}
      </div>
      <Segment
        options={[
          {
            key: "me",
            label: "Just me",
            icon: "user",
            active: !split,
            onClick: () => onChange({ sharedWith: [], shareCount: 1 }),
          },
          {
            key: "split",
            label: "Split with friends",
            icon: "split",
            active: split,
            onClick: () =>
              onChange({
                sharedWith,
                shareCount: Math.max(2, ways),
              }),
          },
        ]}
      />

      {/* Friend chips reveal when Split is on. */}
      <AnimatePresence initial={false}>
        {split && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="flex flex-col gap-2" style={{ paddingTop: 6 }}>
              {sortedPeople.length === 0 ? (
                <div
                  className="small muted"
                  style={{
                    padding: "8px 12px",
                    border: "1px dashed var(--border-strong)",
                    borderRadius: 8,
                  }}
                >
                  No friends yet — add some on{" "}
                  <Link
                    href="/friends"
                    style={{ color: "var(--accent)", textDecoration: "underline" }}
                  >
                    /friends
                  </Link>{" "}
                  to split with named people.
                </div>
              ) : (
                <div className="flex flex-wrap" style={{ gap: 6 }}>
                  {visible.map((p) => {
                    const on = selectedSet.has(p.displayName);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleFriend(p.displayName)}
                        className={`chip chip-sm ${on ? "accent" : ""}`}
                        style={{ cursor: "pointer" }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 999,
                            background: on
                              ? "var(--accent)"
                              : "var(--surface-2)",
                            color: on ? "var(--accent-ink)" : "var(--muted)",
                            fontSize: 8,
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {on ? "✓" : initials(p.displayName)}
                        </span>
                        <span>{p.displayName}</span>
                      </button>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      className="chip chip-sm ghost"
                      style={{ cursor: "pointer" }}
                    >
                      +{hiddenCount} more
                    </button>
                  )}
                  {expanded && sortedPeople.length > VISIBLE && (
                    <button
                      type="button"
                      onClick={() => setExpanded(false)}
                      className="chip chip-sm ghost"
                      style={{ cursor: "pointer" }}
                    >
                      Show fewer
                    </button>
                  )}
                </div>
              )}

              {/* Per-share math — single line, no double-₹ */}
              <div
                className="flex items-baseline justify-between"
                style={{
                  padding: "8px 12px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span className="small muted">
                  {fmtInr(amount)} ÷ {ways} ={" "}
                  <span className="num-amount" style={{ color: "var(--fg)" }}>
                    {fmtInr(perPerson)}
                  </span>{" "}
                  each
                </span>
                <span className="small muted-2">
                  you owe{" "}
                  <span className="num-amount" style={{ color: "var(--credit)" }}>
                    {fmtInr(perPerson)}
                  </span>{" "}
                  · they owe you{" "}
                  <span className="num-amount" style={{ color: "var(--fg-2)" }}>
                    {fmtInr(amount - perPerson)}
                  </span>
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ────────────────────────────────────────────────────────────────────────────
// UpNextRail — the right column of the modal body.
//
//   Up next         A peek of the next 5 unreviewed txns in the current
//                   filtered list. Each row shows time + counterparty +
//                   amount + a hint (suggestion / repeat counterparty /
//                   unusual size). Clicking jumps the focus to that txn.
//
//   BulkNudge       When ≥3 OTHER unreviewed txns in the visible list share
//                   the same counterparty as the current txn, surface a
//                   "While you're here: N more <X> txns" callout. Clicking
//                   filters the list to that counterparty (close the modal
//                   first so the user lands on the bundle in the list).
// ────────────────────────────────────────────────────────────────────────────

function UpNextRail({
  currentTxn,
  listRows,
  activeIdx,
  onSelectId,
  onAfterLabelSaved,
  onOpenMerchantDetail,
}: {
  currentTxn: ReviewTransactionDetail;
  listRows: ReviewListRow[];
  activeIdx: number;
  onSelectId: (id: number) => void;
  /** Called after a sticky-label save so the modal can refetch the txn detail. */
  onAfterLabelSaved: () => void;
  /** Drill into the merchant-deep-dive takeover from the history card. */
  onOpenMerchantDetail: (counterparty: string, focusTxnId: number) => void;
}) {
  // Next 5 unreviewed rows after the current cursor — falls back to the
  // start of the list when the cursor is at the end so the rail is never
  // empty mid-session.
  const upcoming = useMemo(() => {
    const start = Math.max(activeIdx + 1, 0);
    const forward = listRows.slice(start).filter((r) => !r.reviewed);
    if (forward.length >= 5) return forward.slice(0, 5);
    const wrapped = listRows
      .slice(0, start)
      .filter((r) => !r.reviewed && r.id !== currentTxn.id);
    return [...forward, ...wrapped].slice(0, 5);
  }, [listRows, activeIdx, currentTxn.id]);

  // BulkNudge — how many OTHER unreviewed rows share the current
  // counterparty (or share a category, as a softer signal).
  const cpKey = currentTxn.counterparty?.trim() ?? "";
  const similar = useMemo(() => {
    if (!cpKey) return [];
    return listRows.filter(
      (r) => r.id !== currentTxn.id && !r.reviewed && r.counterparty === cpKey,
    );
  }, [listRows, currentTxn.id, cpKey]);

  const currentAmount = currentTxn.withdrawal ?? currentTxn.deposit ?? 0;
  const merchantHistory = currentTxn.suggestion?.merchantHistory ?? null;
  const productHint = currentTxn.suggestion?.productHint ?? null;
  const inferredLocation = currentTxn.inferredLocation;
  // Use the suggestion's effective counterparty for the merchant rail so
  // the card renders even when the DB counterparty is null but narration
  // extraction (e.g. "Apple Media Services") found a clean name. cpKey
  // above stays bound to the stored value because it powers BulkNudge,
  // which matches against listRows.counterparty literally.
  const merchantCp =
    cpKey || currentTxn.suggestion?.effectiveCounterparty || "";

  return (
    <aside
      className="flex flex-col"
      style={{
        borderLeft: "1px solid var(--border)",
        background: "var(--bg)",
        overflow: "auto",
        minHeight: 0,
        gap: 14,
        padding: "20px 18px",
      }}
    >
      {/* Inferred location — Google Maps Timeline match for this txn's
          time. Sits at the top of the rail so it answers "where was I
          when this happened" the moment the modal opens. */}
      {inferredLocation && (
        <InferredLocationCard location={inferredLocation} />
      )}

      {/* Merchant history — when we have at least one same-merchant row,
          show the lifetime view: count + total + cadence + distinct
          amounts. Independent of reviewed status (always shows context). */}
      {merchantHistory && merchantCp && (
        <MerchantHistoryCard
          counterparty={merchantCp}
          amountInr={currentAmount}
          history={merchantHistory}
          productHint={productHint}
          onAfterLabelSaved={onAfterLabelSaved}
          onOpenDetail={() => onOpenMerchantDetail(merchantCp, currentTxn.id)}
        />
      )}

      {/* BulkNudge — only when we found ≥3 similar unreviewed rows */}
      {similar.length >= 3 && (
        <div
          className="surface"
          style={{
            padding: 14,
            borderColor: "var(--accent-line)",
            background: "var(--accent-soft)",
          }}
        >
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Ico name="sparkles" size={13} className="accent" />
            <span className="eyebrow eyebrow-accent">While you&rsquo;re here</span>
          </div>
          <div className="h2" style={{ marginBottom: 6 }}>
            {similar.length} more {cpKey} txn{similar.length === 1 ? "" : "s"} —
            all unreviewed.
          </div>
          <p className="small" style={{ margin: 0 }}>
            Likely the same kind of expense. Apply this category + recurrence
            across them in one shot.
          </p>
          <div className="flex items-center" style={{ marginTop: 10, gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm ghost"
              onClick={() => {
                const first = similar[0];
                if (first) onSelectId(first.id);
              }}
            >
              See the first
            </button>
            <button
              type="button"
              className="btn btn-sm primary"
              disabled
              title="Bulk apply across the visible selection is a follow-up — for now, walk through them one by one"
              style={{ marginLeft: "auto" }}
            >
              Apply to {similar.length}{" "}
              <span className="kbd kbd-on-accent">⇧⏎</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Up next</span>
        <span className="tag mono">{upcoming.length} of the queue</span>
      </div>

      {upcoming.length === 0 ? (
        <div
          className="small muted"
          style={{
            padding: "20px 12px",
            border: "1px dashed var(--border-strong)",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          Nothing left to review on this filter.
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 6 }}>
          {upcoming.map((row) => (
            <UpNextRow key={row.id} row={row} onSelect={() => onSelectId(row.id)} />
          ))}
        </div>
      )}
    </aside>
  );
}

function UpNextRow({
  row,
  onSelect,
}: {
  row: ReviewListRow;
  onSelect: () => void;
}) {
  const lede = displayCounterparty(row.counterparty, row.narration);
  const uncategorized = !row.category;
  const dt = `${row.txnDate.slice(5)} · ${row.txnTime ?? "—"}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="surface flex flex-col"
      style={{
        padding: "10px 12px",
        gap: 4,
        textAlign: "left",
        cursor: "pointer",
        color: "inherit",
        fontFamily: "inherit",
        background: "var(--surface)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          style={{
            fontSize: 13,
            color: lede ? "var(--fg)" : "var(--muted)",
            fontStyle: lede ? "normal" : "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {lede ?? "—"}
        </span>
        <span
          className={`num-amount ${row.direction === "debit" ? "debit" : "credit"}`}
          style={{ fontSize: 13, flexShrink: 0 }}
        >
          {row.direction === "debit" ? "−" : "+"}₹{row.amount.toLocaleString("en-IN")}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="tag mono">{dt}</span>
        <span
          className={`chip chip-sm ${uncategorized ? "ghost" : ""}`}
          style={{ fontSize: 10 }}
        >
          {row.category ?? "Uncategorized"}
        </span>
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MerchantHistoryCard — the right-rail "this is your relationship with this
// merchant" panel. Renders whenever the currently-focused txn has at least
// one same-counterparty sibling. Sections:
//
//   1. Headline:    Product hint (user label > price KB) OR the merchant name
//   2. Stats line:  total spent · count · cadence · next expected
//   3. Distinct amounts list, sorted by count desc; current amount marked
//   4. "Label this charge" inline form (collapsed → text input + save)
// ────────────────────────────────────────────────────────────────────────────

const CADENCE_LABEL: Record<string, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  irregular: "Irregular",
  one_time: "First seen",
};

function formatInrCompact(n: number): string {
  // Show ₹1.2 lakh / ₹12,345 / ₹1.2 cr in Indian convention. Keeps the card
  // dense without losing magnitude.
  const abs = Math.abs(n);
  if (abs >= 10_000_000)
    return `₹${(n / 10_000_000).toFixed(abs >= 100_000_000 ? 0 : 1)} cr`;
  if (abs >= 100_000)
    return `₹${(n / 100_000).toFixed(abs >= 1_000_000 ? 0 : 1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function formatDateMonth(iso: string): string {
  // "2025-01-15" → "Jan '25"
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[m - 1]} '${String(y).slice(-2)}`;
}

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function MerchantHistoryCard({
  counterparty,
  amountInr,
  history,
  productHint,
  onAfterLabelSaved,
  onOpenDetail,
}: {
  counterparty: string;
  amountInr: number;
  history: MerchantHistory;
  productHint: ReviewProductHint | null;
  onAfterLabelSaved: () => void;
  /**
   * Clicking the card (anywhere outside the inline label form) opens the
   * full merchant deep-dive takeover with every charge from this merchant.
   */
  onOpenDetail: () => void;
}) {
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(productHint?.label ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cadenceLabel = CADENCE_LABEL[history.cadence.kind] ?? "Seen";

  // Gate the cadence word: low confidence or non-recurring kinds shouldn't
  // be labelled "Weekly" — for a grocery merchant the median gap is ~7d but
  // that's a description, not an identity.
  const showCadenceWord =
    history.cadence.confidence !== "low" &&
    history.cadence.kind !== "irregular" &&
    history.cadence.kind !== "one_time";

  // "Next expected" is only useful if it's actually in the future. A
  // projection that lapsed two months ago says the cadence has broken, not
  // that something's coming.
  const today = todayIsoLocal();
  const showNextExpected =
    history.nextExpectedDate != null && history.nextExpectedDate >= today;

  // Variance mode: when there are many distinct amounts (Blinkit-style) the
  // top-5 list is mostly noise — each row has count ≤ 2 and a random "last"
  // date. Switch to min/median/max for these merchants.
  const focusAmount = Math.round(amountInr);
  const useVarianceMode =
    history.count >= 6 &&
    (history.distinctAmounts.length > 6 ||
      history.distinctAmounts[0]!.count <= 2);

  const handleSaveLabel = useCallback(async () => {
    const label = labelDraft.trim();
    if (!label) {
      setErr("Pick a name first");
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await saveMerchantLabel({
      counterparty,
      amountInr: Math.round(amountInr),
      label,
      categoryHint: productHint?.categoryHint ?? null,
    });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setLabelOpen(false);
    onAfterLabelSaved();
  }, [labelDraft, counterparty, amountInr, productHint?.categoryHint, onAfterLabelSaved]);

  // Cap the distinct-amounts list to keep the card readable. Most merchants
  // have <5 distinct prices; the long tail is almost always noise.
  const visibleAmounts = history.distinctAmounts.slice(0, 5);
  const hiddenAmounts = history.distinctAmounts.length - visibleAmounts.length;

  // Whole card is clickable, but the bottom label form has its own
  // controls — clicking inside that subtree should not drill us into the
  // merchant view. We branch in the outer onClick on a data-no-drill flag.
  const handleCardClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest("[data-no-drill]")) return;
    onOpenDetail();
  };
  const handleCardKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The outer surface is reachable via Tab — Enter/Space activates it.
    // Inner buttons handle their own keys and stop propagation isn't
    // needed because they're real <button>s.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenDetail();
    }
  };

  return (
    <div
      className="surface"
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKey}
      aria-label={`Open merchant details for ${counterparty}`}
      style={{
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        cursor: "pointer",
        transition: "border-color 0.12s ease, background 0.12s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          "var(--accent-line)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "";
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ gap: 8 }}
      >
        <div className="flex items-center gap-2">
          <Ico name="sparkles" size={13} className="muted" />
          <span className="eyebrow">Merchant history</span>
        </div>
        <span
          className="tiny muted"
          aria-hidden
          style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
        >
          View all <Ico name="arrow-right" size={11} />
        </span>
      </div>

      {/* Headline */}
      <div className="flex flex-col" style={{ gap: 2 }}>
        <div
          className="h2"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {productHint?.label ?? counterparty}
        </div>
        {productHint && (
          <span className="tiny muted">
            {productHint.source === "user_label"
              ? "your label"
              : `likely · ${productHint.confidence} confidence`}
          </span>
        )}
      </div>

      {/* Hero — the lifetime total is the headline number. The subline
          carries count + date range so we don't need separate stat rows. */}
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span className="num-amount" style={{ fontSize: 28, lineHeight: 1.1 }}>
          {formatInrCompact(history.totalSpentInr)}
        </span>
        <span className="tiny muted">
          {history.count} charge{history.count === 1 ? "" : "s"}
          {history.firstSeen !== history.lastSeen
            ? ` · ${formatDateMonth(history.firstSeen)} → ${formatDateMonth(history.lastSeen)}`
            : ` · ${formatDateMonth(history.firstSeen)}`}
        </span>
      </div>

      {/* Cadence — only when we can stand behind it. */}
      {(showCadenceWord || showNextExpected) && (
        <div className="flex items-baseline" style={{ gap: 6 }}>
          {showCadenceWord && <span className="small">{cadenceLabel}</span>}
          {showCadenceWord && showNextExpected && (
            <span className="tiny muted">·</span>
          )}
          {showNextExpected && (
            <span className="small muted">
              next ~ {formatDateMonth(history.nextExpectedDate!)}
            </span>
          )}
        </div>
      )}

      {/* Amounts: variance mode for high-variance merchants, distinct list
          for subscription-like ones. */}
      {useVarianceMode ? (
        <TypicalChargePanel history={history} focusAmount={focusAmount} />
      ) : (
        history.distinctAmounts.length > 1 && (
          <div className="flex flex-col" style={{ gap: 4 }}>
            <span className="eyebrow">Amounts you pay</span>
            {visibleAmounts.map((a) => (
              <div
                key={a.amountInr}
                className="flex items-baseline justify-between"
                style={{
                  gap: 8,
                  padding: "4px 6px",
                  borderRadius: 6,
                  background: a.containsFocus ? "var(--accent-soft)" : "transparent",
                  border: a.containsFocus ? "1px solid var(--accent-line)" : "1px solid transparent",
                }}
              >
                <span
                  className="num-amount"
                  style={{ fontSize: 13, color: "var(--fg)" }}
                >
                  ₹{a.amountInr.toLocaleString("en-IN")}
                </span>
                <span className="tiny muted">
                  ×{a.count}
                  {a.containsFocus ? " · this one" : ` · last ${formatDateMonth(a.lastDate)}`}
                </span>
              </div>
            ))}
            {hiddenAmounts > 0 && (
              <span className="tiny muted" style={{ paddingLeft: 6 }}>
                + {hiddenAmounts} more amount{hiddenAmounts === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )
      )}

      {/* Label this charge — sticky annotation. data-no-drill keeps the
          outer card click handler from treating these controls as a drill
          into the merchant view. */}
      {!labelOpen ? (
        <button
          type="button"
          data-no-drill
          className="btn btn-sm ghost"
          onClick={(e) => {
            e.stopPropagation();
            setLabelDraft(productHint?.label ?? "");
            setLabelOpen(true);
          }}
          style={{ justifyContent: "flex-start", padding: "6px 8px" }}
        >
          <Ico name="sparkles" size={12} />{" "}
          {productHint?.source === "user_label" ? "Edit label" : "Label this charge"}
        </button>
      ) : (
        <div data-no-drill className="flex flex-col" style={{ gap: 6 }}>
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            placeholder="e.g. iCloud+ 200GB"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSaveLabel();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setLabelOpen(false);
                setErr(null);
              }
            }}
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              padding: "6px 10px",
              color: "var(--fg)",
              fontFamily: "inherit",
              fontSize: 13,
              outline: "none",
            }}
          />
          <span className="tiny muted">
            Remembered for ₹{Math.round(amountInr).toLocaleString("en-IN")} on “{counterparty}”
            — on this device only.
          </span>
          {err && (
            <span className="tiny" style={{ color: "var(--debit)" }}>
              {err}
            </span>
          )}
          <div className="flex items-center" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm primary"
              onClick={() => void handleSaveLabel()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save label"}
            </button>
            <button
              type="button"
              className="btn btn-sm ghost"
              onClick={() => {
                setLabelOpen(false);
                setErr(null);
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TypicalChargePanel({
  history,
  focusAmount,
}: {
  history: MerchantHistory;
  focusAmount: number;
}) {
  const { minAmountInr, medianAmountInr, maxAmountInr } = history;
  const focusVsMedian =
    focusAmount > medianAmountInr
      ? "above typical"
      : focusAmount < medianAmountInr
        ? "below typical"
        : "at the median";

  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <span className="eyebrow">Typical charge</span>
      <div className="flex items-end" style={{ gap: 18 }}>
        <RangeStat label="min" value={minAmountInr} />
        <RangeStat label="median" value={medianAmountInr} emphasis />
        <RangeStat label="max" value={maxAmountInr} />
      </div>
      <span className="tiny muted">
        This charge: ₹{focusAmount.toLocaleString("en-IN")} · {focusVsMedian}
      </span>
    </div>
  );
}

function RangeStat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 2, alignItems: "flex-start" }}>
      <span
        className="num-amount"
        style={{
          fontSize: emphasis ? 17 : 14,
          color: emphasis ? "var(--fg)" : "var(--fg-muted)",
        }}
      >
        ₹{value.toLocaleString("en-IN")}
      </span>
      <span className="tiny muted">{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// InferredLocationCard — "where were you when this happened" panel, fed by
// the Google Maps Timeline matcher. Always read-only; nothing the user can
// edit lives here (re-import to refresh, edit `is_online` via the merchant
// label dialog to disable).
// ────────────────────────────────────────────────────────────────────────────

function prettyCategory(slug: string | null): string | null {
  if (!slug) return null;
  // Google's place categories come in two flavors: "TYPE_RESTAURANT" /
  // "TYPE_GYM_FITNESS_CENTER" (legacy) and PascalCase ("Restaurant",
  // "FoodAndDrink"). Normalize both to title case.
  const stripped = slug.replace(/^TYPE_/, "").replace(/_/g, " ").toLowerCase();
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
}

function InferredLocationCard({
  location,
}: {
  location: ReviewInferredLocation;
}) {
  const isHighConf = location.confidence === "high";
  const isLowConf = location.confidence === "low";
  const cat = prettyCategory(location.placeCategory);
  const mapsUrl = `https://www.google.com/maps?q=${location.lat},${location.lng}`;
  const placeLabel = location.placeName ?? "Near this point";

  return (
    <div
      className="surface"
      style={{
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        borderColor: isHighConf ? "var(--accent-line)" : "var(--border)",
        borderStyle: isLowConf ? "dashed" : "solid",
        background: isHighConf ? "var(--accent-soft)" : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <Ico name="map-pin" size={13} className={isHighConf ? "accent" : "muted"} />
        <span className={`eyebrow ${isHighConf ? "eyebrow-accent" : ""}`}>
          Where you were
        </span>
        <span
          className="tag mono"
          style={{ marginLeft: "auto" }}
          title={
            location.source === "semantic_stay"
              ? "Google's Maps Timeline placed you here for this window"
              : `Closest GPS ping ${location.deltaMinutes} min from this charge`
          }
        >
          {location.confidence}
        </span>
      </div>

      <div className="flex flex-col" style={{ gap: 2 }}>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="h2"
          style={{
            color: "var(--fg)",
            textDecoration: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {placeLabel}
        </a>
        <span className="tiny muted">
          {cat ? `${cat} · ` : ""}
          {location.source === "semantic_stay"
            ? "your timeline placed you here"
            : `±${location.deltaMinutes} min GPS ping${
                location.accuracyM ? ` · ~${location.accuracyM}m accuracy` : ""
              }`}
        </span>
      </div>

      {location.staleAgeDays > 0 && (
        <div
          className="tiny"
          style={{
            color: "var(--warn)",
            padding: "6px 8px",
            border: "1px dashed var(--border-strong)",
            borderRadius: 6,
            background: "var(--surface-2)",
          }}
        >
          Your timeline ends ~{location.staleAgeDays} day
          {location.staleAgeDays === 1 ? "" : "s"} before this charge — best
          guess from your last known whereabouts. Re-import a fresh Takeout
          export to tighten this.
        </div>
      )}

      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer"
        className="tiny muted"
        style={{ textDecoration: "underline" }}
      >
        Open in Google Maps →
      </a>
    </div>
  );
}
