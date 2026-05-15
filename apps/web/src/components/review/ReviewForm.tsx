"use client";

/**
 * ReviewForm — the editable form on the right of /review.
 *
 * Layout (top to bottom):
 *   - Header     — date + time (primary read), amount alongside (smaller),
 *                  meta line for account / UTR / reviewed pill
 *   - Counterparty + Category — the two fields the user touches most often.
 *                  Counterparty shows a one-click "Suggested" pill when the
 *                  canonical row's counterparty is empty but we can extract
 *                  one from the bank narration (e.g. "M Sree Prakash").
 *   - Sources    — every extractor that produced data for this row
 *   - More fields (collapsed by default) — Person, Narration, Notes
 *   - Attach bill (collapsed by default) — drag-and-drop dropzone
 *   - Actions    — Save / Save+mark reviewed / Skip / Mark only / Unmark
 *
 * Form state: local React state with diff-vs-original tracking. We don't
 * auto-save — explicit Save / Save+Next is the ADHD-friendly path
 * (autosave creates anxious mistakes-can't-be-undone vibes).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ReviewTransactionDetail } from "@/lib/review-repo";
import { fmtInr } from "@/lib/format";
import { extractCounterpartyFromNarration } from "@/lib/narration";
import {
  updateTransaction,
  markReviewed,
  unmarkReviewed,
  type TransactionEdits,
  type AttachBillResult,
} from "@/app/review/actions";

import { BillAttachDropzone } from "./BillAttachDropzone";
import { ReviewSourceCard } from "./ReviewSourceCard";

const DAY_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_OF_WEEK[dow]}, ${d} ${MONTH_LONG[m - 1]} ${y}`;
}

export interface ReviewFormProps {
  txn: ReviewTransactionDetail;
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  categoryOptions: string[];
  onAfterSave: () => void;
  onAfterAttach: () => void;
  onSkipToNext: () => void;
}

interface FormState {
  counterparty: string;
  category: string;
  narration: string;
  notes: string;
  personId: string;
}

function initial(txn: ReviewTransactionDetail): FormState {
  return {
    counterparty: txn.counterparty ?? "",
    category: txn.category ?? "",
    narration: txn.narration ?? "",
    notes: txn.notes ?? "",
    personId: txn.personId ?? "",
  };
}

export function ReviewForm({
  txn,
  people,
  categoryOptions,
  onAfterSave,
  onAfterAttach,
  onSkipToNext,
}: ReviewFormProps) {
  const original = useMemo(() => initial(txn), [txn]);
  const [form, setForm] = useState<FormState>(original);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Progressive-disclosure state — both default closed so the form's
  // resting state is short. Auto-open "more fields" when this txn already
  // has a person / notes set (so the user sees the existing data).
  const hasExistingMore = Boolean(
    txn.personId || (txn.notes && txn.notes.trim().length > 0),
  );
  const [moreOpen, setMoreOpen] = useState(hasExistingMore);
  const [attachOpen, setAttachOpen] = useState(false);

  const counterpartyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    counterpartyRef.current?.focus();
  }, [txn.id]);

  // Re-evaluate "more open" when the txn id changes — different rows have
  // different "has existing data" answers.
  useEffect(() => {
    setMoreOpen(hasExistingMore);
    setAttachOpen(false);
  }, [txn.id, hasExistingMore]);

  // Suggested counterparty from narration — only when the form's
  // counterparty field is empty. One-click accept.
  const suggestedCounterparty = useMemo(() => {
    if (form.counterparty.trim().length > 0) return null;
    return extractCounterpartyFromNarration(txn.narration);
  }, [form.counterparty, txn.narration]);

  const dirty = useMemo(() => {
    return (
      form.counterparty !== original.counterparty ||
      form.category !== original.category ||
      form.narration !== original.narration ||
      form.notes !== original.notes ||
      form.personId !== original.personId
    );
  }, [form, original]);

  const buildEdits = useCallback(
    (markReviewedFlag: boolean): TransactionEdits => {
      const e: TransactionEdits = {};
      if (form.counterparty !== original.counterparty) {
        e.counterparty = form.counterparty.trim() || null;
      }
      if (form.category !== original.category) {
        e.category = form.category.trim() || null;
      }
      if (form.narration !== original.narration) {
        e.narration = form.narration.trim() || null;
      }
      if (form.notes !== original.notes) {
        e.notes = form.notes.trim() || null;
      }
      if (form.personId !== original.personId) {
        e.personId = form.personId || null;
      }
      if (markReviewedFlag) e.markReviewed = true;
      return e;
    },
    [form, original],
  );

  const save = useCallback(
    async (alsoMarkReviewed: boolean) => {
      setSaving(true);
      setErrMsg(null);
      const r = await updateTransaction(txn.id, buildEdits(alsoMarkReviewed));
      setSaving(false);
      if (!r.ok) {
        setErrMsg(r.error);
        return;
      }
      setSavedMsg(alsoMarkReviewed ? "Saved + marked reviewed" : "Saved");
      window.setTimeout(() => setSavedMsg(null), 1800);
      onAfterSave();
    },
    [buildEdits, onAfterSave, txn.id],
  );

  const onlyMarkReviewed = useCallback(async () => {
    setSaving(true);
    const r = await markReviewed(txn.id);
    setSaving(false);
    if (!r.ok) {
      setErrMsg(r.error);
      return;
    }
    setSavedMsg("Marked reviewed");
    window.setTimeout(() => setSavedMsg(null), 1800);
    onAfterSave();
  }, [txn.id, onAfterSave]);

  const unmark = useCallback(async () => {
    setSaving(true);
    const r = await unmarkReviewed(txn.id);
    setSaving(false);
    if (!r.ok) setErrMsg(r.error);
    else {
      setSavedMsg("Unmarked reviewed");
      window.setTimeout(() => setSavedMsg(null), 1800);
      onAfterSave();
    }
  }, [txn.id, onAfterSave]);

  // Keyboard shortcuts at the form level — only fire when no input has focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void save(false);
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void save(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const direction = txn.withdrawal != null ? "debit" : "credit";
  const amount = txn.withdrawal ?? txn.deposit ?? 0;

  return (
    <article className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* ============================ HEADER ================================
          Date+time leads as the orienting fact. Amount lives alongside at
          a smaller size — the user just clicked here from the sidebar, the
          amount isn't news. Status pill + meta line carry the rest.
      */}
      <header className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {fmtLongDate(txn.txnDate)}
            </h2>
            {txn.txnTime && (
              <span className="text-base tabular-nums text-zinc-500 dark:text-zinc-400">
                {txn.txnTime}
              </span>
            )}
          </div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              direction === "debit"
                ? "text-rose-700 dark:text-rose-400"
                : "text-emerald-700 dark:text-emerald-400"
            }`}
            title={direction === "debit" ? "Money out" : "Money in"}
          >
            {direction === "debit" ? "−" : "+"}
            {fmtInr(amount)}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>
            Txn <code className="text-[10px]">#{txn.id}</code>
          </span>
          <span>
            {txn.account.bank} {txn.account.type} •••{txn.account.last4}
          </span>
          {txn.refNo && (
            <span>
              UTR <code className="text-[10px]">{txn.refNo}</code>
            </span>
          )}
          {txn.reviewed ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Reviewed
            </span>
          ) : (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Unreviewed
            </span>
          )}
        </div>
      </header>

      {/* ====================== PRIMARY EDITS =============================
          The two fields touched on almost every row. Counterparty has an
          inline suggestion pill when empty — one click accepts.
      */}
      <div className="space-y-4 px-6 py-5">
        <Field label="Counterparty" hint="Who this txn was with — clean human name.">
          <input
            ref={counterpartyRef}
            type="text"
            value={form.counterparty}
            onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
            placeholder="(unknown)"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          {suggestedCounterparty && (
            <button
              type="button"
              onClick={() =>
                setForm({ ...form, counterparty: suggestedCounterparty })
              }
              className="mt-1.5 inline-flex items-baseline gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/70"
              title="Use this name extracted from the bank narration"
            >
              <span aria-hidden>💡</span>
              <span className="text-indigo-500 dark:text-indigo-400">Suggested:</span>
              <span className="font-medium">{suggestedCounterparty}</span>
              <span className="text-indigo-500 dark:text-indigo-400">· Use this</span>
            </button>
          )}
        </Field>

        <Field label="Category">
          <input
            type="text"
            list="category-options"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="Food:Restaurant"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <datalist id="category-options">
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {txn.categoryRule && form.category === original.category && (
            <p className="mt-1 text-[11px] italic text-zinc-500 dark:text-zinc-400">
              Auto-categorized by rule: <code>{txn.categoryRule}</code>
            </p>
          )}
        </Field>

        {/* Sharing — only when set, never editable here. */}
        {(txn.sharedWith.length > 0 || txn.shareCount > 1) && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
            <span className="font-medium text-amber-700 dark:text-amber-300">
              Shared:
            </span>{" "}
            <span className="text-amber-700 dark:text-amber-300">
              {txn.shareCount}-way split
              {txn.sharedWith.length > 0 && (
                <> with {txn.sharedWith.join(", ")}</>
              )}
            </span>{" "}
            <span className="text-amber-600 dark:text-amber-400/80">
              · edit on the Friends page
            </span>
          </div>
        )}
      </div>

      {/* ========================= SOURCES ================================ */}
      <div className="border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Sources ({txn.sources.length})
          </h3>
          {txn.sources.length > 0 && (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              Click a card to expand
            </span>
          )}
        </div>
        {txn.sources.length === 0 ? (
          <p className="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400">
            No source rows. This shouldn't normally happen — every canonical
            txn is observed by at least one parser.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {txn.sources.map((s) => (
              <ReviewSourceCard key={s.id} source={s} />
            ))}
          </div>
        )}
      </div>

      {/* ===================== MORE FIELDS (collapsed) ===================== */}
      <details
        open={moreOpen}
        onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
        className="border-t border-zinc-100 dark:border-zinc-800"
      >
        <summary className="flex cursor-pointer items-baseline justify-between px-6 py-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/40">
          <span className="flex items-baseline gap-1.5">
            <span aria-hidden>{moreOpen ? "▾" : "▸"}</span>
            <span className="font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {moreOpen ? "Less" : "More"} fields
            </span>
            {!moreOpen && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                · Person · Narration · Notes
              </span>
            )}
          </span>
        </summary>
        <div className="space-y-4 px-6 pb-5">
          <Field
            label="Person"
            hint="Link this txn to someone in your registry (e.g. a flatmate). Different from sharing."
          >
            <select
              value={form.personId}
              onChange={(e) => setForm({ ...form, personId: e.target.value })}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">— Not linked —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.relationship}) · {p.txnCount} txn
                  {p.txnCount === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Narration"
            hint="The bank's verbatim line. Rarely needs editing."
          >
            <textarea
              value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
              rows={2}
              placeholder="(empty)"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </Field>

          <Field label="Notes" hint="Free-form. Useful for context only you can give.">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="(empty)"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </Field>
        </div>
      </details>

      {/* ===================== ATTACH BILL (collapsed) ===================== */}
      <details
        open={attachOpen}
        onToggle={(e) => setAttachOpen((e.target as HTMLDetailsElement).open)}
        className="border-t border-zinc-100 dark:border-zinc-800"
      >
        <summary className="flex cursor-pointer items-baseline justify-between px-6 py-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/40">
          <span className="flex items-baseline gap-1.5">
            <span aria-hidden>{attachOpen ? "▾" : "+"}</span>
            <span className="font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Attach a bill / receipt
            </span>
          </span>
        </summary>
        <div className="px-6 pb-5">
          <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Drop a Zepto invoice PDF (best — parsed inline with items) or a
            quick-commerce screenshot. Force-attaches to <em>this</em> txn —
            bypasses the daemon's auto-match.
          </p>
          <BillAttachDropzone
            txnId={txn.id}
            onAttached={(r) => {
              if (r.ok) {
                if (r.kind === "zepto_invoice") {
                  setSavedMsg(
                    `Attached invoice ${r.orderNo} (${r.itemCount} item${r.itemCount === 1 ? "" : "s"}, ₹${r.amount})`,
                  );
                } else {
                  setSavedMsg(`Queued — ${r.reason.split(" — ")[0]}`);
                }
                onAfterAttach();
              } else {
                setErrMsg(r.error);
              }
              window.setTimeout(() => setSavedMsg(null), 3500);
            }}
          />
        </div>
      </details>

      {/* ============================ ACTIONS ============================= */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <Kbd>J</Kbd>/<Kbd>K</Kbd> prev/next · <Kbd>N</Kbd> next unreviewed ·{" "}
          <Kbd>S</Kbd> save · <Kbd>A</Kbd> save + mark reviewed
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {savedMsg && (
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              ✓ {savedMsg}
            </span>
          )}
          {errMsg && (
            <span className="text-xs font-medium text-rose-700 dark:text-rose-400">
              ⚠ {errMsg}
            </span>
          )}
          {txn.reviewed ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void unmark()}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Unmark reviewed
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void onlyMarkReviewed()}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Mark reviewed only
            </button>
          )}
          <button
            type="button"
            onClick={onSkipToNext}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void save(false)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Save
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {dirty ? "Save + Next" : "Mark reviewed + Next"}
          </button>
        </div>
      </footer>
    </article>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      {hint && (
        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-300 bg-white px-1 font-mono text-[10px] text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </kbd>
  );
}

export type { AttachBillResult };
