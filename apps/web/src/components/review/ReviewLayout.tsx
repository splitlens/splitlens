"use client";

/**
 * ReviewLayout — top-level client component for /review.
 *
 * Glue between the sidebar (list + filters) and the form (editable detail).
 * Owns URL-state sync: filter changes + active-id selection both rewrite
 * the URL (shallow-routed) so the back button works and shareable links
 * resolve to the exact same view.
 *
 * ADHD-friendly defaults:
 *   - Single column of focus: form on the right is the only thing the eye
 *     needs to scan. Sidebar is a slim secondary surface.
 *   - Save+Next is the primary action and the J/K/A/S keys are sticky-noted
 *     under it so the keyboard path is discoverable.
 *   - Progress meter at the top of the sidebar — "127 / 5773 reviewed".
 *   - Smooth opacity transition between txns avoids the "did anything
 *     happen?" disorientation of a hard re-render.
 */
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type {
  ReviewListFilter,
  ReviewListResult,
  ReviewTransactionDetail,
  ReviewFilterMeta,
  TimeBuckets,
} from "@/lib/review-repo";

import { ReviewSidebar } from "./ReviewSidebar";
import { ReviewForm } from "./ReviewForm";
import { useReviewKeyboard } from "./useReviewKeyboard";

export interface ReviewLayoutProps {
  filter: ReviewListFilter;
  list: ReviewListResult;
  meta: ReviewFilterMeta;
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  buckets: TimeBuckets;
  activeId: number | null;
  activeDetail: ReviewTransactionDetail | null;
}

export function ReviewLayout(props: ReviewLayoutProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const { list, meta, people, buckets, filter, activeId, activeDetail } = props;

  /** Mutate a single URL search param without losing the others. */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      startTransition(() => {
        router.replace(`/review?${next.toString()}`, { scroll: false });
      });
    },
    [params, router, startTransition],
  );

  const setFilter = useCallback(
    (patch: Partial<ReviewListFilter & { unreviewed: boolean }>) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      // Whenever the filter changes, clear the pinned id so the page picks
      // the first unreviewed under the new filter.
      next.delete("id");
      const map: Record<string, string | null | undefined> = {
        from: "from" in patch ? (patch.from ?? null) : undefined,
        to: "to" in patch ? (patch.to ?? null) : undefined,
        category: "category" in patch ? (patch.category ?? null) : undefined,
        unreviewed:
          "unreviewedOnly" in patch
            ? patch.unreviewedOnly
              ? "true"
              : null
            : undefined,
        personId: "personId" in patch ? (patch.personId ?? null) : undefined,
        accountId:
          "accountId" in patch
            ? patch.accountId != null
              ? String(patch.accountId)
              : null
            : undefined,
        q: "q" in patch ? (patch.q ?? null) : undefined,
        sort: "sort" in patch ? (patch.sort ?? null) : undefined,
        tod: "timeOfDay" in patch ? (patch.timeOfDay ?? null) : undefined,
      };
      for (const [k, v] of Object.entries(map)) {
        if (v === undefined) continue;
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      startTransition(() => {
        router.replace(`/review?${next.toString()}`, { scroll: false });
      });
    },
    [params, router, startTransition],
  );

  const goToId = useCallback(
    (id: number) => {
      setParam("id", String(id));
    },
    [setParam],
  );

  /** Find the active row's index within the (visible) list. */
  const activeIdx = useMemo(() => {
    if (activeId == null) return -1;
    return list.rows.findIndex((r) => r.id === activeId);
  }, [activeId, list.rows]);

  const goNext = useCallback(() => {
    if (list.rows.length === 0) return;
    const i = activeIdx === -1 ? 0 : Math.min(activeIdx + 1, list.rows.length - 1);
    goToId(list.rows[i]!.id);
  }, [activeIdx, list.rows, goToId]);

  const goPrev = useCallback(() => {
    if (list.rows.length === 0) return;
    const i = activeIdx === -1 ? 0 : Math.max(activeIdx - 1, 0);
    goToId(list.rows[i]!.id);
  }, [activeIdx, list.rows, goToId]);

  const goNextUnreviewed = useCallback(() => {
    if (list.rows.length === 0) return;
    const next = list.rows.find((r, i) => i > activeIdx && !r.reviewed);
    if (next) goToId(next.id);
    else goNext(); // fall through if everything after is reviewed
  }, [activeIdx, list.rows, goNext, goToId]);

  // Mount the global keyboard handler. We register it here (not in form) so
  // it stays active even while the user has the sidebar's filter field
  // focused — the hook ignores keys when an input/textarea/select has focus.
  useReviewKeyboard({
    onNext: goNext,
    onPrev: goPrev,
    onNextUnreviewed: goNextUnreviewed,
  });

  // Refresh the server tree (re-fetches list + detail) after any save/attach.
  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router, startTransition]);

  return (
    <div className="mx-auto flex max-w-[1400px] gap-4 p-4 md:p-6">
      <aside
        className="w-[360px] flex-shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        aria-label="Transaction list"
      >
        <ReviewSidebar
          list={list}
          meta={meta}
          buckets={buckets}
          filter={filter}
          people={people}
          activeId={activeId}
          onSelectId={goToId}
          onFilterChange={setFilter}
          pending={pending}
        />
      </aside>

      <section className="min-w-0 flex-1">
        {activeDetail ? (
          <ReviewForm
            key={activeDetail.id /* remount on txn change → resets form state */}
            txn={activeDetail}
            people={people}
            categoryOptions={meta.categories.map((c) => c.category)}
            onAfterSave={() => {
              refresh();
              // After a successful save, advance to the next unreviewed row
              // automatically — that's the smooth ADHD-friendly default.
              goNextUnreviewed();
            }}
            onAfterAttach={() => refresh()}
            onSkipToNext={goNextUnreviewed}
          />
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      <div className="mb-3 text-5xl">🎉</div>
      <div className="text-base font-medium text-zinc-700 dark:text-zinc-300">
        Nothing to review here.
      </div>
      <div className="mt-2">
        Either every transaction matching this filter is reviewed, or no
        transactions match it. Try loosening the filter, or untick
        “Unreviewed only”.
      </div>
    </div>
  );
}
