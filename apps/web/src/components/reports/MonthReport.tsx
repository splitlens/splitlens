"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MonthlyReport, ReportTxn, ReviewBucket } from "@/lib/repo";
import { fmtInr } from "@/lib/format";
import { markReviewed, unmarkReviewed } from "@/app/reports/actions";
import { markShared } from "@/app/friends/actions";
import { TxnReviewCard, type TxnAction } from "./TxnReviewCard";
import { ShareTxnModal, type PersonOption } from "@/components/friends/ShareTxnModal";

/**
 * Monthly spending report — built around an ADHD-friendly review queue.
 *
 * The transactions are pre-bucketed server-side (house-shape / chase-up /
 * usual-split / other / done). Each card shows ONE smart suggestion and three
 * actions: accept the suggestion, manually split, or mark "just me". Keyboard
 * shortcuts: J/K navigate, A accept suggestion, S split, M mine, R toggle
 * reviewed, U undo.
 */

const BUCKET_META: Record<
  ReviewBucket,
  { emoji: string; title: string; subtitle: string; tone: string }
> = {
  house: {
    emoji: "🏠",
    title: "House-shape — possibly shareable with flatmates",
    subtitle: "Utilities, groceries, household. We've pre-suggested a flatmate split.",
    tone: "border-amber-200 dark:border-amber-900/50",
  },
  chase: {
    emoji: "💰",
    title: "Forgot to chase?",
    subtitle: "You sent money to a friend but no return UPI showed up within 14 days.",
    tone: "border-rose-200 dark:border-rose-900/50",
  },
  usual: {
    emoji: "🔁",
    title: "Usually split with the same friends",
    subtitle: "You've split this merchant before — one click accepts the same split.",
    tone: "border-indigo-200 dark:border-indigo-900/50",
  },
  other: {
    emoji: "📥",
    title: "Other unreviewed",
    subtitle: "No automatic suggestion — just confirm or skip.",
    tone: "border-zinc-200 dark:border-zinc-800",
  },
  done: {
    emoji: "✅",
    title: "Reviewed & shared",
    subtitle: "Already triaged — click to undo if needed.",
    tone: "border-emerald-200 dark:border-emerald-900/50",
  },
};

const ORDER: ReviewBucket[] = ["house", "chase", "usual", "other", "done"];

export function MonthReport({
  report,
  people,
}: {
  report: MonthlyReport;
  people: PersonOption[];
}) {
  const { yearMonth, availableMonths, buckets } = report;
  const [splitting, setSplitting] = useState<ReportTxn | null>(null);
  const [isPending, startTransition] = useTransition();
  // Track which bucket sections are expanded — house/chase/usual default open;
  // other and done default collapsed because they tend to be long.
  const [openBuckets, setOpenBuckets] = useState<Record<ReviewBucket, boolean>>({
    house: true,
    chase: true,
    usual: true,
    other: false,
    done: false,
  });
  // Cursor for keyboard navigation across the visible queue.
  const [cursor, setCursor] = useState<{ bucket: ReviewBucket; id: number } | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  const visibleQueue = useMemo<{ bucket: ReviewBucket; txn: ReportTxn }[]>(() => {
    // Only the OPEN buckets participate in J/K navigation.
    const out: { bucket: ReviewBucket; txn: ReportTxn }[] = [];
    for (const b of ORDER) {
      if (!openBuckets[b]) continue;
      for (const t of buckets[b]) out.push({ bucket: b, txn: t });
    }
    return out;
  }, [buckets, openBuckets]);

  // Place the cursor on the first card of the first non-empty open bucket on
  // first render, so J/K Just Work without the user having to click first.
  useEffect(() => {
    if (cursor) return;
    const first = visibleQueue[0];
    if (first) setCursor({ bucket: first.bucket, id: first.txn.id });
  }, [visibleQueue, cursor]);

  function scrollCursorIntoView(b: ReviewBucket, id: number) {
    const el = cardRefs.current.get(`${b}-${id}`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function moveCursor(delta: -1 | 1) {
    if (visibleQueue.length === 0) return;
    const idx = cursor
      ? visibleQueue.findIndex((v) => v.bucket === cursor.bucket && v.txn.id === cursor.id)
      : -1;
    const next = Math.max(0, Math.min(visibleQueue.length - 1, idx + delta));
    const target = visibleQueue[next]!;
    setCursor({ bucket: target.bucket, id: target.txn.id });
    scrollCursorIntoView(target.bucket, target.txn.id);
  }

  function currentTxn(): { bucket: ReviewBucket; txn: ReportTxn } | null {
    if (!cursor) return null;
    return (
      visibleQueue.find((v) => v.bucket === cursor.bucket && v.txn.id === cursor.id) ?? null
    );
  }

  // Keyboard handler. Modifier-free single letters mirror Gmail/Linear's
  // muscle memory: navigate J/K, act with A / S / M / R, undo with U.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in inputs / contenteditables, or when a modal is open.
      const target = e.target as HTMLElement | null;
      if (splitting) return;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const cur = currentTxn();
      switch (e.key) {
        case "j":
        case "J":
        case "ArrowDown":
          e.preventDefault();
          moveCursor(1);
          break;
        case "k":
        case "K":
        case "ArrowUp":
          e.preventDefault();
          moveCursor(-1);
          break;
        case "a":
        case "A":
          if (cur && cur.txn.suggestion) {
            e.preventDefault();
            acceptSuggestion(cur.txn);
          }
          break;
        case "s":
        case "S":
          if (cur) {
            e.preventDefault();
            setSplitting(cur.txn);
          }
          break;
        case "m":
        case "M":
        case "r":
        case "R":
          if (cur) {
            e.preventDefault();
            handleAction(cur.txn, "mark_reviewed");
          }
          break;
        case "u":
        case "U":
          if (cur && cur.txn.reviewed) {
            e.preventDefault();
            handleAction(cur.txn, "unmark_reviewed");
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitting, cursor, visibleQueue]);

  function handleAction(txn: ReportTxn, action: TxnAction) {
    if (action === "open_split") {
      setSplitting(txn);
      return;
    }
    if (action === "accept_suggestion" && txn.suggestion) {
      acceptSuggestion(txn);
      return;
    }
    startTransition(async () => {
      if (action === "mark_reviewed") await markReviewed(txn.id);
      else if (action === "unmark_reviewed") await unmarkReviewed(txn.id);
    });
  }

  function acceptSuggestion(txn: ReportTxn) {
    if (!txn.suggestion) return;
    startTransition(async () => {
      const res = await markShared(txn.id, txn.suggestion!.personIds);
      // If the suggestion involves friends, markShared also sets reviewed=1 on
      // the row. For the chase-up bucket where we want to flag without sharing,
      // the user should hit the explicit "Mark reviewed" instead.
      if (!res.ok) console.error("[reports] markShared failed:", res.error);
    });
  }

  const reviewedPct =
    report.txnCount > 0 ? Math.round((100 * report.reviewedCount) / report.txnCount) : 0;
  const reviewedAmtPct =
    report.totalOut > 0 ? Math.round((100 * report.reviewedAmount) / report.totalOut) : 0;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {humanMonth(yearMonth)} spending report
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {report.txnCount} outgoing transactions ·{" "}
            <strong className="text-zinc-700 dark:text-zinc-300">{fmtInr(report.totalOut)}</strong>{" "}
            total
          </p>
        </div>
        <MonthPicker current={yearMonth} months={availableMonths} />
      </header>

      {/* Progress bar */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Progress · {report.reviewedCount} of {report.txnCount} reviewed
          </h3>
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {fmtInr(report.reviewedAmount, { showZero: true })} /{" "}
            {fmtInr(report.totalOut, { showZero: true })} ({reviewedAmtPct}%)
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
            style={{ width: `${reviewedPct}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-500">
          <KbdHint k="J / K" label="next / prev" />
          <KbdHint k="A" label="accept suggestion" />
          <KbdHint k="S" label="split…" />
          <KbdHint k="R" label="mark reviewed" />
          <KbdHint k="U" label="undo" />
        </div>
      </div>

      {/* Bucket sections */}
      <div className="space-y-4">
        {ORDER.map((bucket) => {
          const txns = buckets[bucket];
          if (txns.length === 0) return null;
          const meta = BUCKET_META[bucket];
          const isOpen = openBuckets[bucket];
          return (
            <section
              key={bucket}
              className={`rounded-xl border bg-white shadow-sm dark:bg-zinc-900 ${meta.tone}`}
            >
              <button
                type="button"
                onClick={() =>
                  setOpenBuckets((s) => ({ ...s, [bucket]: !s[bucket] }))
                }
                className="flex w-full items-baseline justify-between gap-3 rounded-t-xl px-5 py-3 text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-800/50"
                aria-expanded={isOpen}
              >
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    <span aria-hidden>{meta.emoji}</span>
                    {meta.title}
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {txns.length}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {meta.subtitle}
                  </p>
                </div>
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen && (
                <ol className="space-y-2 border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
                  {txns.map((t) => (
                    <li
                      key={t.id}
                      ref={(el) => {
                        cardRefs.current.set(`${bucket}-${t.id}`, el);
                      }}
                    >
                      <TxnReviewCard
                        txn={t}
                        isCursor={
                          cursor?.bucket === bucket && cursor.id === t.id
                        }
                        isPending={isPending}
                        onSelect={() => setCursor({ bucket, id: t.id })}
                        onAction={(a) => handleAction(t, a)}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>

      {splitting && (
        <ShareTxnModal
          txn={{
            id: splitting.id,
            txnDate: splitting.txnDate,
            txnTime: splitting.txnTime,
            amount: splitting.withdrawal,
            counterparty: splitting.counterparty,
            narration: splitting.narration,
            category: splitting.category,
            initialSharedWith: splitting.sharedWith,
          }}
          people={people}
          onClose={() => setSplitting(null)}
          onSubmitted={() => setSplitting(null)}
        />
      )}
    </main>
  );
}

function MonthPicker({ current, months }: { current: string; months: string[] }) {
  // Newest first in the dropdown.
  const sorted = [...months].reverse();
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">Month</span>
      <select
        defaultValue={current}
        onChange={(e) => {
          // Use a real navigation so the URL stays canonical.
          window.location.href = `/reports/${e.target.value}`;
        }}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {sorted.map((ym) => (
          <option key={ym} value={ym}>
            {humanMonth(ym)}
          </option>
        ))}
      </select>
      <Link
        href="/dashboard"
        className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        ← Dashboard
      </Link>
    </div>
  );
}

function KbdHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

function humanMonth(ym: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${months[m - 1]} ${y}`;
}
