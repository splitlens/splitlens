"use client";

/**
 * ReviewLayout — top-level client component for /review.
 *
 * Glue between the sidebar (list + filters) and the form (editable detail).
 * Owns URL-state sync: filter changes + active-id selection both rewrite
 * the URL (shallow-routed) so the back button works and shareable links
 * resolve to the exact same view.
 *
 * Layout:
 *   - Two-pane split. Sidebar (queue + filters) on the left, form on the
 *     right. Default sidebar width is 540px — wide enough that the
 *     timeline columns get two-up at a glance — but the user can drag
 *     the divider to taste. Width persists in localStorage.
 *   - Resize handle is the 6px column between the two panes; mousedown
 *     to start dragging, Esc / mouseup to release. Double-click resets
 *     to the default width.
 *   - Form content max-width is 760px so it doesn't sprawl across a 4K
 *     screen — readable form widths beat "fill all available space".
 */
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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

const SIDEBAR_WIDTH_STORAGE_KEY = "splitlens.review.sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH = 540;
const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 900;

export function ReviewLayout(props: ReviewLayoutProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const { list, meta, people, buckets, filter, activeId, activeDetail } = props;

  // ───── Resizable sidebar ─────
  // Start at the default; reconcile from localStorage after mount to avoid
  // SSR / client hydration mismatches.
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      const n = stored ? Number(stored) : NaN;
      if (
        Number.isFinite(n) &&
        n >= MIN_SIDEBAR_WIDTH &&
        n <= MAX_SIDEBAR_WIDTH
      ) {
        setSidebarWidth(n);
      }
    } catch {
      /* ignore — localStorage unavailable */
    }
  }, []);

  const persistWidth = useCallback((w: number) => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const next = Math.max(
          MIN_SIDEBAR_WIDTH,
          Math.min(MAX_SIDEBAR_WIDTH, startW + delta),
        );
        setSidebarWidth(next);
      };
      const onUp = () => {
        setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // Persist on release rather than on every move (avoid localStorage
        // churn from drag streams).
        setSidebarWidth((w) => {
          persistWidth(w);
          return w;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, persistWidth],
  );

  const onResizeDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    persistWidth(DEFAULT_SIDEBAR_WIDTH);
  }, [persistWidth]);

  // Keyboard handle: with focus on the divider, ←/→ nudge by 24px each.
  // Accessibility for non-pointer users.
  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 96 : 24;
      const delta = e.key === "ArrowLeft" ? -step : step;
      const next = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, sidebarWidth + delta),
      );
      setSidebarWidth(next);
      persistWidth(next);
    },
    [sidebarWidth, persistWidth],
  );

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
    <div className="mx-auto flex max-w-[1600px] items-stretch gap-0 p-3 md:p-4">
      <aside
        style={{ width: `${sidebarWidth}px` }}
        className={`flex-shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${
          resizing ? "" : "transition-[width] duration-150"
        }`}
        aria-label="Transaction list"
      >
        <ReviewSidebar
          list={list}
          meta={meta}
          buckets={buckets}
          filter={filter}
          people={people}
          activeId={activeId}
          activeDate={activeDetail?.txnDate ?? null}
          onSelectId={goToId}
          onFilterChange={setFilter}
          pending={pending}
        />
      </aside>

      {/* Resize handle — 6px gutter with a 2px visible bar that highlights
          on hover/active. Mousedown to drag; double-click to reset. Tab-
          focusable + ←/→ to nudge for keyboard users. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-label="Resize sidebar (drag, or focus + arrow keys)"
        tabIndex={0}
        onMouseDown={onResizeStart}
        onDoubleClick={onResizeDoubleClick}
        onKeyDown={onResizeKeyDown}
        title="Drag to resize · double-click to reset"
        className={`group relative mx-1 w-2 shrink-0 cursor-col-resize select-none ${
          resizing ? "" : "transition-colors"
        }`}
      >
        <div
          className={`absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded transition-colors ${
            resizing
              ? "bg-indigo-500"
              : "bg-transparent group-hover:bg-indigo-300 dark:group-hover:bg-indigo-500/50"
          }`}
        />
      </div>

      <section className="min-w-0 flex-1">
        <div className="mx-auto max-w-[760px]">
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
        </div>
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
