"use client";

/**
 * ReviewLayout — /review page, rebuilt to match the Hi-fi design handoff.
 *
 *   Page header           "All N transactions. Find what you're looking for…"
 *   Search bar            Counterparty / narration text search (q)
 *   Filter chip row       Active filters as removable chips + summary stat
 *   Scrubber              8-month strip + 31-day heatmap of the active month
 *   Two-col body          Day-grouped txn list | right rail
 *   Selection bar         (Bottom) selection actions when ≥1 row picked
 *
 * Clicking a row opens the InboxModal, which is the design's keyboard-first
 * per-txn review surface (replaces the old DetailDrawer + ReviewForm pair).
 *
 * URL state plumbing — kept identical to the previous implementation:
 *   ?id, ?from, ?to, ?category, ?unreviewed, ?personId, ?accountId, ?q,
 *   ?sort, ?tod, ?share, ?rec
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import type {
  ClientMerchantContext,
  ClientReviewRow,
  CustomCategoryRow,
  MerchantAggregate,
  ReviewListFilter,
  ReviewListResult,
  ReviewListRow,
  ReviewTransactionDetail,
  ReviewFilterMeta,
  TimeBuckets,
} from "@/lib/review-repo";
import {
  applyClientFilter,
  buildClientMerchantAggregates,
  buildClientTimeBuckets,
  buildReviewListResult,
} from "@/lib/review-client";
import { fmtInr } from "@/lib/format";
import { displayCounterparty } from "@/lib/narration";
import { categoryFromCustom, getCategory, setCustomCategoriesIndex } from "@/lib/taxonomy";
import { Ico } from "@/components/Ico";

import { InboxModal } from "./InboxModal";
import { useReviewKeyboard } from "./useReviewKeyboard";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DAY_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ReviewLayoutProps {
  /** Initial filter shape — used to bootstrap local state from the URL.
   *  Subsequent filter changes are kept in client state and synced back
   *  to the URL via a debounced effect (for shareability), but the URL
   *  no longer drives re-renders. */
  filter: ReviewListFilter;
  meta: ReviewFilterMeta;
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  activeId: number | null;
  activeDetail: ReviewTransactionDetail | null;
  customCategories: CustomCategoryRow[];
  /** The whole ledger as plain client rows. Filter/bucket/aggregate
   *  recompute over this set in useMemo, on every click, on the same
   *  frame. The reason filter clicks feel instant. */
  allRows: ClientReviewRow[];
  /** Filter-independent lifetime context per counterparty (lifetime
   *  count + 12-month sparkline). Zipped with the in-filter slice
   *  inside `buildClientMerchantAggregates`. */
  merchantContexts: ClientMerchantContext[];
}

const LIST_GROUP_MODE_KEY = "splitlens.review.listGroupMode";

export function ReviewLayout(props: ReviewLayoutProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const {
    meta,
    people,
    filter: initialFilter,
    activeId,
    activeDetail,
    customCategories,
    allRows,
    merchantContexts,
  } = props;

  // Local filter state. Initialized from the URL on first render, then
  // owned by the client — every filter click updates this state and the
  // useMemo block below recomputes the list/buckets/aggregates on the
  // same frame, no network round-trip. The URL is sync'd back on a
  // 250ms debounce (further down) so shareable links stay accurate.
  const [filter, setLocalFilter] = useState<ReviewListFilter>(initialFilter);

  // Pure derivations — these all run synchronously inside React's
  // render pass. With ~5k rows this is sub-millisecond on a modern CPU.
  const filteredRows = useMemo(
    () => applyClientFilter(allRows, filter),
    [allRows, filter],
  );
  const list = useMemo(
    () => buildReviewListResult(allRows, filteredRows, filter),
    [allRows, filteredRows, filter],
  );
  const buckets = useMemo(
    () => buildClientTimeBuckets(allRows, filter),
    [allRows, filter],
  );
  const merchantAggregates = useMemo(
    () => buildClientMerchantAggregates(filteredRows, merchantContexts),
    [filteredRows, merchantContexts],
  );

  // Register custom categories with the global lookup so chips/dots resolve.
  const customDefs = useMemo(
    () => customCategories.map(categoryFromCustom),
    [customCategories],
  );
  setCustomCategoriesIndex(customDefs);

  // Drawer-open derives from URL — shareable links keep the modal open.
  const drawerOpen = params?.has("id") ?? false;

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

  /**
   * Apply a filter patch.
   *
   * Two-track behavior:
   *   1. Mutate local React state synchronously — every derived useMemo
   *      above recomputes on the same frame, so the UI updates instantly.
   *   2. Schedule a debounced URL sync (further down) so back/forward and
   *      shareable links still reflect the active filter.
   *
   * Active txn id (`?id`) is dropped immediately — clicking a filter
   * always exits a pinned txn, same as before.
   */
  const setFilter = useCallback(
    (patch: Partial<ReviewListFilter & { unreviewed: boolean }>) => {
      setLocalFilter((prev) => {
        const next: ReviewListFilter = { ...prev };
        if ("from" in patch) next.from = patch.from ?? null;
        if ("to" in patch) next.to = patch.to ?? null;
        if ("category" in patch) next.category = patch.category ?? null;
        if ("unreviewedOnly" in patch)
          next.unreviewedOnly = !!patch.unreviewedOnly;
        if ("unreviewed" in patch) next.unreviewedOnly = !!patch.unreviewed;
        if ("personId" in patch) next.personId = patch.personId ?? null;
        if ("accountId" in patch)
          next.accountId = patch.accountId ?? null;
        if ("q" in patch) next.q = patch.q ?? null;
        if ("sort" in patch) next.sort = patch.sort ?? undefined;
        if ("timeOfDay" in patch)
          next.timeOfDay = patch.timeOfDay ?? null;
        if ("shareStatus" in patch)
          next.shareStatus = patch.shareStatus ?? null;
        if ("recurrenceClass" in patch)
          next.recurrenceClass = patch.recurrenceClass ?? null;
        return next;
      });
      // Drop ?id immediately — clicking a filter exits any pinned txn.
      if (params?.has("id")) {
        const next = new URLSearchParams(params.toString());
        next.delete("id");
        startTransition(() => {
          router.replace(`/review?${next.toString()}`, { scroll: false });
        });
      }
    },
    [params, router, startTransition],
  );

  // Debounced URL sync. Whenever the local filter settles, push the new
  // query params back to the URL so shareable links work and back/
  // forward still navigates between filter states. The 250ms debounce
  // means rapid clicks don't spam history entries.
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params?.toString() ?? "");
      const sync = (key: string, val: string | null | undefined) => {
        if (val == null || val === "") next.delete(key);
        else next.set(key, val);
      };
      sync("from", filter.from ?? null);
      sync("to", filter.to ?? null);
      sync("category", filter.category ?? null);
      sync("unreviewed", filter.unreviewedOnly ? "true" : null);
      sync("personId", filter.personId ?? null);
      sync(
        "accountId",
        filter.accountId != null ? String(filter.accountId) : null,
      );
      sync("q", filter.q ?? null);
      sync("sort", filter.sort ?? null);
      sync("tod", filter.timeOfDay ?? null);
      sync("share", filter.shareStatus ?? null);
      sync("rec", filter.recurrenceClass ?? null);
      const nextStr = next.toString();
      const curStr = params?.toString() ?? "";
      if (nextStr !== curStr) {
        router.replace(`/review?${nextStr}`, { scroll: false });
      }
    }, 250);
    return () => clearTimeout(handle);
    // We intentionally don't depend on `params`/`router` — those would
    // re-arm the timer on every URL update we make ourselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // When the user clicks a merchant in the leaderboard, we want the modal
  // to open straight into MerchantDetailView for that counterparty instead
  // of the default txn-edit form. Stored on the parent so it can be
  // cleared on any unrelated navigation (arrow keys, picking a different
  // txn from the date list) — otherwise the merchant view would stick.
  const [merchantViewIntent, setMerchantViewIntent] = useState<{
    counterparty: string;
    focusTxnId: number;
  } | null>(null);

  const goToId = useCallback(
    (id: number) => {
      setMerchantViewIntent(null);
      setParam("id", String(id));
    },
    [setParam],
  );
  const closeDrawer = useCallback(() => {
    setMerchantViewIntent(null);
    setParam("id", null);
  }, [setParam]);
  const openMerchantInModal = useCallback(
    (counterparty: string, focusTxnId: number) => {
      // Order matters: set the intent BEFORE we trigger the URL change so
      // the modal renders with the intent on its first frame of being open.
      setMerchantViewIntent({ counterparty, focusTxnId });
      setParam("id", String(focusTxnId));
    },
    [setParam],
  );

  // Keyboard nav
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
    const n = list.rows.find((r, i) => i > activeIdx && !r.reviewed);
    if (n) goToId(n.id);
    else goNext();
  }, [activeIdx, list.rows, goNext, goToId]);
  useReviewKeyboard({ onNext: goNext, onPrev: goPrev, onNextUnreviewed: goNextUnreviewed });

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  // List view mode (date- vs merchant-grouped). Persisted in localStorage
  // so the user's pick survives reloads.
  const [listGroupMode, setListGroupMode] = useState<ListGroupMode>("date");
  useEffect(() => {
    const saved = window.localStorage.getItem(LIST_GROUP_MODE_KEY);
    if (saved === "date" || saved === "merchant") setListGroupMode(saved);
  }, []);
  const updateGroupMode = useCallback((mode: ListGroupMode) => {
    setListGroupMode(mode);
    try {
      window.localStorage.setItem(LIST_GROUP_MODE_KEY, mode);
    } catch {
      /* private mode, quota — best effort */
    }
  }, []);

  // Multi-row selection — client-only for now; bulk actions in the bar are
  // wired to the visible state but the persistence/action layer is a TODO.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    // Reset selection whenever the filter changes (list contents differ).
    setSelected(new Set());
  }, [filter.from, filter.to, filter.category, filter.q, filter.unreviewedOnly]);
  const toggleSelected = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Sum the visible matching rows' debit amounts for the filter-stat strip.
  const matchSum = useMemo(
    () =>
      list.rows
        .filter((r) => r.direction === "debit")
        .reduce((s, r) => s + r.amount, 0),
    [list.rows],
  );
  const matchAvg = list.rows.length === 0 ? 0 : matchSum / list.rows.length;

  // Selected stats
  const selectedRows = useMemo(
    () => list.rows.filter((r) => selected.has(r.id)),
    [list.rows, selected],
  );
  const selectedSum = selectedRows.reduce(
    (s, r) => s + (r.direction === "debit" ? r.amount : 0),
    0,
  );

  return (
    <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Page header */}
      <div
        style={{
          padding: "20px 32px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="eyebrow eyebrow-accent">Review · find a transaction</span>
              <span className="tag">
                Review<span className="muted-2">/</span>List
                <span className="muted-2">/</span>
                {list.ledgerTotal.toLocaleString()} across the ledger
                {pending && <span className="ml-2 italic muted">· updating…</span>}
              </span>
            </div>
            <h1 className="display" style={{ fontSize: 36 }}>
              All {list.ledgerTotal.toLocaleString()} transactions.
              <span className="muted">
                {" "}
                Find what you&rsquo;re looking for, then dig in.
              </span>
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm outline"
              onClick={() =>
                setFilter({ unreviewedOnly: !filter.unreviewedOnly })
              }
              title="Show only unreviewed"
            >
              <Ico name="inbox" size={13} />
              {filter.unreviewedOnly ? "Showing unreviewed" : "All txns"}
              <span className="kbd">U</span>
            </button>
            <button type="button" className="btn btn-sm ghost" title="Saved views (coming soon)">
              <Ico name="filter" size={13} /> Saved views <span className="kbd">G</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ marginTop: 18 }}>
          <SearchBar
            initial={filter.q ?? ""}
            matches={list.totalMatching}
            sum={matchSum}
            onSubmit={(q) => setFilter({ q: q || null })}
          />
        </div>

        {/* Filter chip row */}
        <FilterRow
          filter={filter}
          buckets={buckets}
          meta={meta}
          totalMatching={list.totalMatching}
          matchSum={matchSum}
          matchAvg={matchAvg}
          onClear={(key) => {
            switch (key) {
              case "time":
                setFilter({ from: null, to: null, timeOfDay: null });
                return;
              case "category":
                setFilter({ category: null });
                return;
              case "account":
                setFilter({ accountId: null });
                return;
              case "unreviewed":
                setFilter({ unreviewedOnly: false });
                return;
              case "share":
                setFilter({ shareStatus: null });
                return;
              case "rec":
                setFilter({ recurrenceClass: null });
                return;
              case "tod":
                setFilter({ timeOfDay: null });
                return;
              case "q":
                setFilter({ q: null });
                return;
            }
          }}
          onSetFilter={setFilter}
          onClearAll={() =>
            setFilter({
              from: null,
              to: null,
              category: null,
              accountId: null,
              personId: null,
              q: null,
              unreviewedOnly: false,
              sort: null,
              timeOfDay: null,
              shareStatus: null,
              recurrenceClass: null,
            })
          }
        />
      </div>

      {/* Scrubber: month strip + day heatmap */}
      <Scrubber buckets={buckets} filter={filter} onPick={setFilter} />

      {/* Body: list + right rail */}
      <div
        style={{
          padding: "0 32px 0",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 24,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div className="flex flex-col" style={{ minHeight: 0 }}>
          <ListGroupModeToggle mode={listGroupMode} onChange={updateGroupMode} />
          <TxnDayList
            rows={list.rows}
            totalMatching={list.totalMatching}
            activeId={drawerOpen ? activeId : null}
            selected={selected}
            q={filter.q ?? ""}
            groupMode={listGroupMode}
            merchantAggregates={merchantAggregates}
            onSelectId={goToId}
            onSelectMerchant={openMerchantInModal}
            onToggleSelected={toggleSelected}
          />
        </div>
        <ReviewRightRail
          list={list}
          filter={filter}
          onSetFilter={setFilter}
        />
      </div>

      {/* Selection bar */}
      <SelectionBar
        count={selected.size}
        sum={selectedSum}
        onClear={() => setSelected(new Set())}
      />

      <InboxModal
        open={drawerOpen && activeDetail != null}
        onClose={closeDrawer}
        txn={activeDetail}
        people={people}
        customCategories={customDefs}
        unreviewedRemaining={list.totalUnreviewed}
        positionIdx={activeIdx >= 0 ? activeIdx + 1 : 0}
        positionTotal={list.rows.length}
        listRows={list.rows}
        activeIdx={activeIdx}
        onPrev={goPrev}
        onNext={goNext}
        onSelectId={goToId}
        onAfterSave={() => {
          refresh();
          goNextUnreviewed();
        }}
        onAfterAttach={refresh}
        onSkipToNext={goNextUnreviewed}
        initialView={
          merchantViewIntent
            ? {
                kind: "merchant",
                counterparty: merchantViewIntent.counterparty,
                focusTxnId: merchantViewIntent.focusTxnId,
              }
            : null
        }
      />
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SearchBar
// ────────────────────────────────────────────────────────────────────────────

function SearchBar({
  initial,
  matches,
  sum,
  onSubmit,
}: {
  initial: string;
  matches: number;
  sum: number;
  onSubmit: (q: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  return (
    <div
      className="flex items-center gap-3"
      style={{
        padding: "0 16px",
        height: 44,
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
      }}
    >
      <Ico name="search" size={16} className="muted" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== initial) onSubmit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit(draft);
        }}
        placeholder="Counterparty, narration, amount, UTR…"
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--fg)",
          fontFamily: "inherit",
          fontSize: 14,
        }}
      />
      <span className="tag mono">
        {matches.toLocaleString()} matches · −{fmtInr(sum)}
      </span>
      <span className="muted-2">·</span>
      <span className="kbd">⌘K</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FilterRow — active filter chips with × dismissers + summary stat
// ────────────────────────────────────────────────────────────────────────────

function FilterRow({
  filter,
  buckets,
  meta,
  totalMatching,
  matchSum,
  matchAvg,
  onClear,
  onSetFilter,
  onClearAll,
}: {
  filter: ReviewListFilter;
  buckets: TimeBuckets;
  meta: ReviewFilterMeta;
  totalMatching: number;
  matchSum: number;
  matchAvg: number;
  onClear: (
    key:
      | "time"
      | "category"
      | "account"
      | "unreviewed"
      | "share"
      | "rec"
      | "tod"
      | "q",
  ) => void;
  onSetFilter: (patch: Partial<ReviewListFilter & { unreviewed: boolean }>) => void;
  onClearAll: () => void;
}) {
  const chips: { key: string; label: string; clear: () => void; accent?: boolean }[] = [];
  if (filter.q) {
    chips.push({ key: "q", label: `“${filter.q}”`, clear: () => onClear("q"), accent: true });
  }
  if (filter.unreviewedOnly) {
    chips.push({
      key: "unreviewed",
      label: "Unreviewed",
      clear: () => onClear("unreviewed"),
    });
  }
  const timeLabel = describeTime(buckets);
  if (timeLabel) {
    chips.push({ key: "time", label: timeLabel, clear: () => onClear("time") });
  }
  if (filter.timeOfDay) {
    chips.push({
      key: "tod",
      label: capitalize(filter.timeOfDay),
      clear: () => onClear("tod"),
    });
  }
  if (filter.category) {
    const def = getCategory(filter.category);
    chips.push({
      key: "category",
      label: `${def.emoji} ${def.label}`,
      clear: () => onClear("category"),
    });
  }
  if (filter.accountId != null) {
    const acc = meta.accounts.find((a) => a.id === filter.accountId);
    chips.push({
      key: "account",
      label: acc ? `${acc.bank} ···${acc.last4}` : `Account #${filter.accountId}`,
      clear: () => onClear("account"),
    });
  }
  if (filter.shareStatus === "personal") {
    chips.push({ key: "share", label: "Personal", clear: () => onClear("share") });
  } else if (filter.shareStatus === "shared") {
    chips.push({ key: "share", label: "Shared", clear: () => onClear("share") });
  }
  if (filter.recurrenceClass === "one_time") {
    chips.push({ key: "rec", label: "One-time", clear: () => onClear("rec") });
  } else if (filter.recurrenceClass === "recurring") {
    chips.push({ key: "rec", label: "Recurring", clear: () => onClear("rec") });
  }

  return (
    <div
      className="flex items-center gap-2"
      style={{ marginTop: 12, flexWrap: "wrap" }}
    >
      <span className="eyebrow">Filters</span>
      {chips.length === 0 ? (
        <span
          className="chip chip-sm"
          style={{ color: "var(--muted)", borderStyle: "dashed" }}
        >
          none active
        </span>
      ) : (
        chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.clear}
            className={`chip chip-sm ${c.accent ? "accent" : "active"}`}
            style={{ cursor: "pointer" }}
          >
            {c.label}
            <Ico name="x" size={13} className="muted" />
          </button>
        ))
      )}

      {/* "+ Add filter" affordances — each opens a small inline picker */}
      <AddFilterChip
        label="+ category"
        hidden={Boolean(filter.category)}
        options={meta.categories.map((c) => ({
          id: c.category,
          label: `${getCategory(c.category).emoji} ${c.category} (${c.count})`,
        }))}
        onPick={(id) => onSetFilter({ category: id })}
      />
      <AddFilterChip
        label="+ account"
        hidden={filter.accountId != null}
        options={meta.accounts.map((a) => ({
          id: String(a.id),
          label: `${a.bank} ${a.type} ···${a.last4} (${a.count})`,
        }))}
        onPick={(id) => onSetFilter({ accountId: Number(id) })}
      />
      <AddFilterChip
        label="+ shared"
        hidden={Boolean(filter.shareStatus)}
        options={[
          { id: "personal", label: "👤 Just me" },
          { id: "shared", label: "👥 Shared with friends" },
        ]}
        onPick={(id) =>
          onSetFilter({ shareStatus: id as "personal" | "shared" })
        }
      />
      <AddFilterChip
        label="+ recurrence"
        hidden={Boolean(filter.recurrenceClass)}
        options={[
          { id: "one_time", label: "💫 One-time" },
          { id: "recurring", label: "🔁 Recurring (any cadence)" },
        ]}
        onPick={(id) =>
          onSetFilter({ recurrenceClass: id as "one_time" | "recurring" })
        }
      />
      <AddFilterChip
        label="+ time of day"
        hidden={Boolean(filter.timeOfDay)}
        options={[
          { id: "morning", label: "🌅 Morning (06–12)" },
          { id: "afternoon", label: "☀️ Afternoon (12–17)" },
          { id: "evening", label: "🌆 Evening (17–21)" },
          { id: "night", label: "🌙 Night (21–06)" },
        ]}
        onPick={(id) =>
          onSetFilter({
            timeOfDay: id as "morning" | "afternoon" | "evening" | "night",
          })
        }
      />

      <span style={{ marginLeft: "auto" }} className="tag">
        <span className="mono fg-2">{totalMatching.toLocaleString()}</span>{" "}
        {chips.length === 0 ? "total" : "matches"} · sum{" "}
        <span className="mono fg-2">−{fmtInr(matchSum)}</span> · avg{" "}
        <span className="mono fg-2">−{fmtInr(Math.round(matchAvg))}</span>
      </span>
      {chips.length > 0 && (
        <button type="button" className="btn btn-sm ghost" onClick={onClearAll}>
          <Ico name="x" size={13} /> Clear all
        </button>
      )}
    </div>
  );
}

// AddFilterChip — dashed "+ name" pill that opens a small popover with the
// given options. Closes on pick or click-outside.
function AddFilterChip({
  label,
  hidden,
  options,
  onPick,
}: {
  label: string;
  hidden?: boolean;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  if (hidden) return null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="chip chip-sm ghost"
        style={{ cursor: "pointer" }}
      >
        {label}
      </button>
      {open && options.length > 0 && (
        <div
          role="menu"
          className="surface"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 220,
            maxHeight: 320,
            overflow: "auto",
            padding: 4,
            zIndex: 30,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
          }}
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onPick(o.id);
                setOpen(false);
              }}
              className="flex items-center"
              style={{
                display: "flex",
                width: "100%",
                padding: "6px 10px",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                color: "var(--fg-2)",
                fontSize: 12.5,
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {open && options.length === 0 && (
        <div
          className="surface small muted"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            padding: "8px 12px",
            zIndex: 30,
            whiteSpace: "nowrap",
          }}
        >
          nothing to pick yet
        </div>
      )}
    </div>
  );
}

function describeTime(buckets: TimeBuckets): string | null {
  const { selectedYear, selectedMonth, selectedDay } = buckets;
  if (selectedYear == null) return null;
  if (selectedDay != null && selectedMonth != null) {
    return `${selectedDay} ${MONTH_SHORT[selectedMonth - 1]} ${selectedYear}`;
  }
  if (selectedMonth != null) {
    return `${MONTH_SHORT[selectedMonth - 1]} ${selectedYear}`;
  }
  return String(selectedYear);
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

// ────────────────────────────────────────────────────────────────────────────
// Scrubber — 8-month strip + day-of-month heatmap for the active month
// ────────────────────────────────────────────────────────────────────────────

function Scrubber({
  buckets,
  filter,
  onPick,
}: {
  buckets: TimeBuckets;
  filter: ReviewListFilter;
  onPick: (patch: Partial<ReviewListFilter>) => void;
}) {
  const { selectedYear, selectedMonth } = buckets;

  // The strip is fed by `recentMonths` (most recent 12, server-aggregated
  // across all years). That way the user can navigate between months
  // without having to first drill into a year.
  const monthsStrip = buckets.recentMonths;

  // Day heatmap target: the explicitly selected month if any, otherwise the
  // most-recent month in `recentMonths` so the strip is always live.
  const heatTarget =
    selectedYear && selectedMonth
      ? { year: selectedYear, month: selectedMonth }
      : monthsStrip.length > 0
      ? {
          year: monthsStrip[monthsStrip.length - 1]!.year,
          month: monthsStrip[monthsStrip.length - 1]!.month,
        }
      : null;
  const lastDay = heatTarget
    ? new Date(Date.UTC(heatTarget.year, heatTarget.month, 0)).getUTCDate()
    : 31;
  const dayCounts = new Map(buckets.days.map((d) => [d.day, d.count]));
  const maxDay = Math.max(1, ...buckets.days.map((d) => d.count));

  const monthLabel = heatTarget
    ? `${MONTH_SHORT[heatTarget.month - 1]} ${heatTarget.year} · day by day${
        selectedMonth ? "" : " (most recent)"
      }`
    : "No transactions to scrub yet";

  return (
    <div
      className="flex"
      style={{
        padding: "12px 32px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        gap: 24,
        alignItems: "stretch",
      }}
    >
      {/* Month strip — horizontally scrollable through ALL months. The
          active month auto-scrolls into view; the latest month sits on the
          right edge by default so the most-relevant data is one glance away. */}
      <MonthStrip
        months={monthsStrip}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onPick={onPick}
      />

      <span style={{ width: 1, background: "var(--border)" }} />

      {/* Day heatmap — always renders against heatTarget month */}
      <div className="flex flex-col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <div className="flex items-center justify-between">
          <span className="eyebrow">{monthLabel}</span>
          <div className="flex items-center gap-3 tiny">
            <span className="flex items-center gap-1">
              <span
                className="dot"
                style={{ background: "var(--accent)" }}
              />{" "}
              spend
            </span>
            <span className="muted-2">· click to jump to a day</span>
          </div>
        </div>
        <div
          className="flex items-end gap-1 scrubber-day-bars"
          style={{ height: 32 }}
        >
          {Array.from({ length: lastDay }, (_, i) => i + 1).map((day) => {
            const count = selectedMonth ? dayCounts.get(day) ?? 0 : 0;
            const intensity = count > 0 ? Math.max(0.18, count / maxDay) : 0.04;
            const isActive = filter.from?.endsWith(
              `-${String(day).padStart(2, "0")}`,
            );
            return (
              <button
                key={day}
                type="button"
                disabled={!heatTarget}
                onClick={() => {
                  if (!heatTarget) return;
                  const iso = `${heatTarget.year}-${String(heatTarget.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  onPick({ from: iso, to: iso });
                }}
                title={`${day}: ${count} txn${count === 1 ? "" : "s"}`}
                className="scrubber-day-bar"
                aria-pressed={isActive ? "true" : "false"}
              >
                <span
                  style={{
                    height: `${Math.max(2, intensity * 22)}px`,
                    background: isActive
                      ? "var(--accent)"
                      : `color-mix(in srgb, var(--accent) ${Math.round(intensity * 80)}%, transparent)`,
                  }}
                />
              </button>
            );
          })}
        </div>
        <div
          className="flex justify-between tiny"
          style={{ color: "var(--muted-2)" }}
        >
          <span>1</span>
          <span>8</span>
          <span>15</span>
          <span>22</span>
          <span>{lastDay}</span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MonthStrip — horizontally scrollable list of every month with data. The
// active month gets the amber outline; on mount or selection-change we
// auto-scroll it into view. The strip is capped to a ~520px viewport so it
// doesn't crowd the day heatmap.
// ────────────────────────────────────────────────────────────────────────────

function MonthStrip({
  months,
  selectedYear,
  selectedMonth,
  onPick,
}: {
  months: TimeBuckets["recentMonths"];
  selectedYear: number | null;
  selectedMonth: number | null;
  onPick: (patch: Partial<ReviewListFilter>) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Custom spring scroll. We replace the browser's scrollIntoView with a
  // hand-rolled animation using easeOutExpo over 380ms — feels closer to
  // macOS's "Reveal in Finder" animation than the inconsistent default
  // smooth-scroll across browsers. We also throttle so consecutive
  // selection-changes don't fight each other.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target =
      scroller.querySelector<HTMLElement>("[data-month-active='true']") ??
      (scroller.lastElementChild as HTMLElement | null);
    if (!target) return;

    const scRect = scroller.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const targetCenter = tRect.left + tRect.width / 2;
    const scCenter = scRect.left + scRect.width / 2;
    const delta = targetCenter - scCenter;
    const startScroll = scroller.scrollLeft;
    const endScroll = startScroll + delta;

    let frame = 0;
    const start = performance.now();
    const duration = 380;
    const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      scroller.scrollLeft = startScroll + (endScroll - startScroll) * easeOutExpo(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [selectedYear, selectedMonth, months.length]);

  return (
    <div className="flex flex-col" style={{ gap: 6, minWidth: 0, maxWidth: 520 }}>
      <span className="eyebrow">Range</span>
      {months.length === 0 ? (
        <span className="small muted">no month data</span>
      ) : (
        <div
          ref={scrollerRef}
          className="flex items-stretch gap-1"
          style={{
            overflowX: "auto",
            scrollBehavior: "smooth",
            scrollbarWidth: "thin",
            paddingBottom: 2,
          }}
        >
          {months.map((mo) => {
            const active =
              selectedYear === mo.year && selectedMonth === mo.month;
            return (
              <button
                key={`${mo.year}-${mo.month}`}
                data-month-active={active ? "true" : "false"}
                type="button"
                onClick={() => {
                  const from = `${mo.year}-${String(mo.month).padStart(2, "0")}-01`;
                  const lastD = new Date(
                    Date.UTC(mo.year, mo.month, 0),
                  ).getUTCDate();
                  const to = `${mo.year}-${String(mo.month).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
                  onPick({ from, to });
                }}
                className={`flex flex-col items-center scrubber-month-tile${
                  active ? " is-active" : ""
                }`}
              >
                <span
                  className="tag"
                  style={{
                    color: active ? "var(--accent)" : "var(--muted)",
                    fontSize: 10,
                  }}
                >
                  {MONTH_SHORT[mo.month - 1]} &rsquo;{String(mo.year).slice(-2)}
                </span>
                <span
                  className="mono tabular"
                  style={{
                    fontSize: 13,
                    color: active ? "var(--fg)" : "var(--fg-2)",
                  }}
                >
                  {mo.count.toLocaleString()}
                </span>
                {mo.unreviewed > 0 && (
                  <span
                    className="dot warn"
                    style={{ width: 5, height: 5 }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TxnDayList — grouped rows with sticky headers (group by date or merchant)
// ────────────────────────────────────────────────────────────────────────────

export type ListGroupMode = "date" | "merchant";

interface DayGroup {
  date: string;
  rows: ReviewListRow[];
  debitTotal: number;
}

interface MerchantGroup {
  /** Display name — same string the row would render in its lede. */
  merchant: string;
  rows: ReviewListRow[];
  debitTotal: number;
}

function groupByDate(rows: ReviewListRow[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  const order: string[] = [];
  for (const r of rows) {
    let g = map.get(r.txnDate);
    if (!g) {
      g = { date: r.txnDate, rows: [], debitTotal: 0 };
      map.set(r.txnDate, g);
      order.push(r.txnDate);
    }
    g.rows.push(r);
    if (r.direction === "debit") g.debitTotal += r.amount;
  }
  return order.map((d) => map.get(d)!);
}

const UNKNOWN_MERCHANT_KEY = "—";

function groupByMerchant(rows: ReviewListRow[]): MerchantGroup[] {
  const map = new Map<string, MerchantGroup>();
  for (const r of rows) {
    const key =
      displayCounterparty(r.counterparty, r.narration) ?? UNKNOWN_MERCHANT_KEY;
    let g = map.get(key);
    if (!g) {
      g = { merchant: key, rows: [], debitTotal: 0 };
      map.set(key, g);
    }
    g.rows.push(r);
    if (r.direction === "debit") g.debitTotal += r.amount;
  }
  // Highest-spend merchants first within the filtered window. Tie-break
  // by transaction count. "—" (unknown) sinks last regardless.
  return [...map.values()].sort((a, b) => {
    if (a.merchant === UNKNOWN_MERCHANT_KEY) return 1;
    if (b.merchant === UNKNOWN_MERCHANT_KEY) return -1;
    if (b.debitTotal !== a.debitTotal) return b.debitTotal - a.debitTotal;
    return b.rows.length - a.rows.length;
  });
}

function fmtDayHeader(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_OF_WEEK[dow]} ${d} ${MONTH_SHORT[m - 1]}`;
}

function fmtRowDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTH_SHORT[m - 1]}`;
}

function TxnDayList({
  rows,
  totalMatching,
  activeId,
  selected,
  q,
  groupMode,
  merchantAggregates,
  onSelectId,
  onSelectMerchant,
  onToggleSelected,
}: {
  rows: ReviewListRow[];
  totalMatching: number;
  activeId: number | null;
  selected: Set<number>;
  q: string;
  groupMode: ListGroupMode;
  merchantAggregates: MerchantAggregate[];
  onSelectId: (id: number) => void;
  /** Click on a merchant leaderboard row — opens the per-merchant detail
   *  modal. `focusTxnId` is one of the merchant's txns (we use the first
   *  row in the group as a stable handle for MerchantDetailView). */
  onSelectMerchant: (counterparty: string, focusTxnId: number) => void;
  onToggleSelected: (id: number) => void;
}) {
  const dayGroups = useMemo(
    () => (groupMode === "date" ? groupByDate(rows) : []),
    [rows, groupMode],
  );
  const merchantGroups = useMemo(
    () => (groupMode === "merchant" ? groupByMerchant(rows) : []),
    [rows, groupMode],
  );
  // Map merchant name → rich aggregate so each group can attach the
  // sparkline, lifetime count, raw narration, etc. without a re-query.
  const aggByMerchant = useMemo(() => {
    const m = new Map<string, MerchantAggregate>();
    for (const a of merchantAggregates) m.set(a.counterparty, a);
    return m;
  }, [merchantAggregates]);
  // Inline-expand state for the by-merchant view — keyed by merchant name
  // so a render with the same key keeps the same open state.
  const [openMerchants, setOpenMerchants] = useState<Set<string>>(new Set());
  const toggleMerchant = useCallback((key: string) => {
    setOpenMerchants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center surface-dashed" style={{ height: 240 }}>
        <div className="flex flex-col items-center gap-2 muted small">
          <Ico name="search" size={20} />
          No transactions match this filter.
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{
        overflow: "auto",
        minHeight: 0,
        flex: 1,
        paddingTop: 16,
        paddingBottom: 80,
      }}
    >
      {groupMode === "date"
        ? dayGroups.map((g) => (
            <section
              key={g.date}
              className="flex flex-col"
              style={{ marginBottom: 18 }}
            >
              <ListGroupHeader
                label={fmtDayHeader(g.date)}
                count={g.rows.length}
                debitTotal={g.debitTotal}
              />
              {g.rows.map((r) => (
                <TxnRow
                  key={r.id}
                  row={r}
                  active={r.id === activeId}
                  selected={selected.has(r.id)}
                  q={q}
                  showDate={false}
                  onOpen={() => onSelectId(r.id)}
                  onToggleSelect={() => onToggleSelected(r.id)}
                />
              ))}
            </section>
          ))
        : merchantGroups.map((g) => {
            // First row is the freshest under the current sort (default desc);
            // gives MerchantDetailView a sensible txn to focus on initially.
            const focusTxnId = g.rows[0]?.id;
            if (focusTxnId == null) return null;
            const agg = aggByMerchant.get(g.merchant);
            const open = openMerchants.has(g.merchant);
            return (
              <RichMerchantRow
                key={g.merchant}
                merchant={g.merchant}
                group={g}
                agg={agg ?? null}
                open={open}
                activeId={activeId}
                selected={selected}
                q={q}
                onToggleOpen={() => toggleMerchant(g.merchant)}
                onOpenDetail={() => onSelectMerchant(g.merchant, focusTxnId)}
                onSelectId={onSelectId}
                onToggleSelected={onToggleSelected}
              />
            );
          })}
      {totalMatching > rows.length && (
        <div
          className="flex items-center justify-center small muted"
          style={{ padding: 24 }}
        >
          showing first {rows.length.toLocaleString()} of{" "}
          {totalMatching.toLocaleString()} — narrow the filter to see more
        </div>
      )}
    </div>
  );
}

function MerchantLeaderRow({
  merchant,
  count,
  debitTotal,
  onOpen,
}: {
  merchant: string;
  count: number;
  debitTotal: number;
  /** Open the per-merchant detail modal. */
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-between merchant-leader-row"
      style={{
        padding: "12px 14px",
        background: "var(--bg)",
        border: "none",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <div className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "-0.005em",
            color: "var(--fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {merchant}
        </span>
        <span className="tag mono">
          {count} txn{count === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {debitTotal > 0 && (
          <span className="num-amount muted" style={{ fontSize: 14 }}>
            −{fmtInr(debitTotal)}
          </span>
        )}
        <Ico name="chevron-right" size={13} />
      </div>
    </button>
  );
}

/**
 * The design-handoff merchant row for the by-merchant view.
 *
 * 7-column grid, mirroring the hi-fi design at
 *   splitlens/project/hifi-review-list-v2.jsx:
 *
 *   chev (28) · avatar (36) · name+raw (1fr) · category (110)
 *                                             · sparkline (100)
 *                                             · last+range (110)
 *                                             · total+avg (112, right)
 *
 * Click anywhere on the row toggles inline expand. The expanded state
 * renders the merchant's in-filter txns underneath, plus an AI nudge
 * banner with an "Open merchant" link that navigates to
 *   /merchants/<personId or counterparty>
 * — the dedicated dark-themed detail page.
 */
function RichMerchantRow({
  merchant,
  group,
  agg,
  open,
  activeId,
  selected,
  q,
  onToggleOpen,
  onOpenDetail,
  onSelectId,
  onToggleSelected,
}: {
  merchant: string;
  group: MerchantGroup;
  /** Backend aggregate. May be null for the "—" / unknown row, which has
   *  no real counterparty and so doesn't get sparkline / lifetime data. */
  agg: MerchantAggregate | null;
  open: boolean;
  activeId: number | null;
  selected: Set<number>;
  q: string;
  onToggleOpen: () => void;
  /** Opens the in-review MerchantDetailView modal (alt path). */
  onOpenDetail: () => void;
  onSelectId: (id: number) => void;
  onToggleSelected: (id: number) => void;
}) {
  const isUnknown = merchant === UNKNOWN_MERCHANT_KEY || agg == null;
  const initials = agg?.initials ?? "·";
  const kind = agg?.kind ?? "business";
  const avi =
    kind === "person"
      ? {
          background: "rgba(209, 134, 114, 0.16)",
          color: "#d18672",
          borderRadius: 999,
          border: "1px solid rgba(209, 134, 114, 0.3)",
        }
      : {
          background: "rgba(173, 154, 216, 0.16)",
          color: "#ad9ad8",
          borderRadius: 8,
        };

  const lastLabel = agg?.lastSeenInFilter
    ? fmtRowDate(agg.lastSeenInFilter)
    : "—";
  const rangeLabel = agg
    ? `${agg.countInFilter} in scope · ${agg.lifetimeCount} lifetime`
    : `${group.rows.length} in scope`;
  const total = group.debitTotal;
  const avg =
    group.rows.length > 0 && total > 0
      ? Math.round(total / group.rows.length)
      : 0;

  const detailHref = agg
    ? `/merchants/${encodeURIComponent(agg.slug)}`
    : null;

  return (
    <div>
      <button
        type="button"
        onClick={onToggleOpen}
        className={`mrow${open ? " open" : ""}`}
        aria-expanded={open}
      >
        <span className="mrow-chev" aria-hidden>
          <Ico name={open ? "chevron-down" : "chevron-right"} size={13} />
        </span>
        <span className="mrow-avi" style={avi}>
          {initials}
        </span>
        <span className="mrow-name">
          <span className="mrow-name-line">
            <span className="mrow-name-text" title={merchant}>
              {merchant}
            </span>
            {agg?.recurring && (
              <span className="mrow-chip">
                <Ico name="repeat" size={11} /> recurring
              </span>
            )}
            {!isUnknown && agg?.category == null && (
              <span className="mrow-chip mrow-chip-warn">
                needs category
              </span>
            )}
          </span>
          {agg?.rawNarrationSample && (
            <span
              className="mrow-raw"
              title={agg.rawNarrationSample}
            >
              {agg.rawNarrationSample}
            </span>
          )}
        </span>
        <span className="mrow-cat" title={agg?.category ?? "Uncategorized"}>
          {agg?.category ?? (
            <span style={{ color: "var(--warn)" }}>Uncategorized</span>
          )}
        </span>
        <span className="mrow-spark" aria-hidden>
          <Sparkline values={agg?.sparkline ?? []} hi={agg?.sparkHighlights ?? []} />
        </span>
        <span className="mrow-range">
          <span className="mrow-range-last">{lastLabel}</span>
          <span className="mrow-range-freq">{rangeLabel}</span>
        </span>
        <span className="mrow-tot">
          <span className="mrow-tot-amt">
            {total > 0 ? `−${fmtInr(total)}` : "—"}
          </span>
          <span className="mrow-tot-avg">
            {group.rows.length > 1 && avg > 0
              ? `avg −${fmtInr(avg)}`
              : `${group.rows.length} txn${group.rows.length === 1 ? "" : "s"}`}
          </span>
        </span>
      </button>

      {open && (
        <div className="mrow-expand">
          {/* AI nudge — pure stats today; tag-suggestion is a future feature.
              We surface what we know (txn count, average, lifetime) so the
              expanded state has context beyond just the txn list. */}
          {agg && (
            <div className="mrow-nudge">
              <Ico name="sparkles" size={13} className="accent" />
              <span>
                {agg.kind === "person"
                  ? `${agg.lifetimeCount} prior transfer${agg.lifetimeCount === 1 ? "" : "s"} with ${merchant}`
                  : `${agg.lifetimeCount} lifetime txn${agg.lifetimeCount === 1 ? "" : "s"} at ${merchant}`}
                {group.rows.length > 1 && avg > 0 && (
                  <>
                    {" · "}avg <b style={{ fontWeight: 500 }}>−{fmtInr(avg)}</b>
                  </>
                )}
              </span>
              <span style={{ flex: 1 }} />
              {detailHref && (
                <Link href={detailHref} className="btn btn-sm primary">
                  Open merchant <span className="kbd kbd-on-accent">⏎</span>
                </Link>
              )}
              <button
                type="button"
                className="btn btn-sm ghost"
                onClick={onOpenDetail}
              >
                Quick look
              </button>
            </div>
          )}

          {/* Child txns — each clickable, opens the InboxModal for that row. */}
          <div className="mrow-children">
            {group.rows.map((r) => (
              <TxnRow
                key={r.id}
                row={r}
                active={r.id === activeId}
                selected={selected.has(r.id)}
                q={q}
                showDate
                onOpen={() => onSelectId(r.id)}
                onToggleSelect={() => onToggleSelected(r.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 12-cell bar sparkline for the merchant row. Values are counts; bars
 * scale to the local max so the visualization is comparable within the
 * row, not against the whole list. Highlighted indices render in accent.
 */
function Sparkline({ values, hi }: { values: number[]; hi: number[] }) {
  const slots = values.length > 0 ? values : new Array(12).fill(0);
  const max = Math.max(1, ...slots);
  const hiSet = new Set(hi);
  return (
    <span className="mrow-spark-bars">
      {slots.map((v, i) => (
        <i
          key={i}
          className={hiSet.has(i) ? "hi" : ""}
          style={{ height: `${4 + (v / max) * 18}px` }}
        />
      ))}
    </span>
  );
}

function ListGroupModeToggle({
  mode,
  onChange,
}: {
  mode: ListGroupMode;
  onChange: (mode: ListGroupMode) => void;
}) {
  const opts: Array<{ id: ListGroupMode; label: string; title: string }> = [
    { id: "date", label: "By date", title: "Group transactions by day, newest first" },
    {
      id: "merchant",
      label: "By merchant",
      title:
        "Group by counterparty; most-frequent merchants in the filtered range first",
    },
  ];
  return (
    <div
      role="tablist"
      aria-label="Group transactions by"
      className="flex items-center gap-1"
      style={{ padding: "4px 0 8px" }}
    >
      {opts.map((o) => {
        const active = o.id === mode;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={`btn btn-sm ${active ? "" : "ghost"}`}
            style={{
              fontSize: 12,
              padding: "4px 10px",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ListGroupHeader({
  label,
  count,
  debitTotal,
}: {
  label: string;
  count: number;
  debitTotal: number;
}) {
  return (
    <header
      className="flex items-baseline justify-between"
      style={{
        padding: "8px 14px",
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
        position: "sticky",
        top: 0,
        zIndex: 1,
      }}
    >
      <div className="flex items-baseline gap-3" style={{ minWidth: 0 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "-0.005em",
            color: "var(--fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span className="tag mono">
          {count} txn{count === 1 ? "" : "s"}
        </span>
      </div>
      {debitTotal > 0 && (
        <span className="num-amount muted" style={{ fontSize: 14 }}>
          −{fmtInr(debitTotal)}
        </span>
      )}
    </header>
  );
}

function TxnRow({
  row,
  active,
  selected,
  q,
  showDate,
  onOpen,
  onToggleSelect,
}: {
  row: ReviewListRow;
  active: boolean;
  selected: boolean;
  q: string;
  /** Show the date alongside the time. Used by the merchant-grouped view
   *  where the group header is the merchant name, not the date. */
  showDate: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  const lede = displayCounterparty(row.counterparty, row.narration);
  const def = getCategory(row.category);
  const uncategorized = !row.category;
  const bg = active
    ? "var(--accent-soft)"
    : selected
    ? "color-mix(in srgb, var(--accent) 5%, transparent)"
    : "transparent";

  const matchesQ =
    q && lede && lede.toLowerCase().includes(q.toLowerCase());

  return (
    <div
      className={`flex items-center gap-3 ${active ? "row-focus" : ""}`}
      style={{
        padding: "10px 14px",
        background: bg,
        borderBottom: "1px dashed var(--border-dashed)",
        cursor: "pointer",
        position: "relative",
        paddingLeft: active ? 17 : 14,
      }}
      onClick={onOpen}
    >
      <button
        type="button"
        aria-label={selected ? "Deselect" : "Select"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
          background: selected ? "var(--accent)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
          cursor: "pointer",
          color: "var(--accent-ink)",
        }}
      >
        {selected && <Ico name="check" size={13} />}
      </button>

      {showDate ? (
        <span
          className="mono tabular muted"
          style={{ fontSize: 11.5, width: 78, flexShrink: 0 }}
          title={row.txnDate}
        >
          {fmtRowDate(row.txnDate)}
          {row.txnTime ? ` · ${row.txnTime}` : ""}
        </span>
      ) : (
        row.txnTime && (
          <span
            className="mono tabular muted"
            style={{ fontSize: 11.5, width: 38, flexShrink: 0 }}
          >
            {row.txnTime}
          </span>
        )
      )}

      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <div className="flex items-baseline gap-2" style={{ minWidth: 0 }}>
          <span
            style={{
              fontSize: 14,
              color: lede ? "var(--fg)" : "var(--muted)",
              fontStyle: lede ? "normal" : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lede ?? "—"}
          </span>
          {matchesQ && (
            <span className="chip chip-sm accent" style={{ fontSize: 10 }}>
              matches “{q}”
            </span>
          )}
          {active && (
            <span className="chip chip-sm accent" style={{ fontSize: 10 }}>
              open in inbox{" "}
              <span className="kbd" style={{ marginLeft: 2 }}>
                ⏎
              </span>
            </span>
          )}
        </div>
      </div>

      <span
        className={`chip chip-sm ${uncategorized ? "ghost" : ""}`}
        style={{
          minWidth: 140,
          justifyContent: "flex-start",
          fontSize: 11.5,
        }}
      >
        <span aria-hidden>{def.emoji}</span>
        {row.category ?? "Uncategorized"}
      </span>

      <span
        className={`num-amount ${row.direction === "debit" ? "debit" : "credit"}`}
        style={{
          fontSize: 14,
          width: 100,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {row.direction === "debit" ? "−" : "+"}
        {fmtInr(row.amount)}
      </span>

      <button
        type="button"
        className="btn btn-sm ghost"
        style={{
          padding: "4px 6px",
          visibility: active ? "visible" : "hidden",
        }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <Ico name="arrow-right" size={13} />
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ReviewRightRail — saved views (UI only), bundle hint, stats
// ────────────────────────────────────────────────────────────────────────────

function ReviewRightRail({
  list,
  filter,
  onSetFilter,
}: {
  list: ReviewListResult;
  filter: ReviewListFilter;
  onSetFilter: (patch: Partial<ReviewListFilter & { unreviewed: boolean }>) => void;
}) {
  // Saved views are pre-baked filter patches; clicking applies them.
  // The `active` predicate decides whether to render the row with the accent
  // dot to confirm the view is currently in effect.
  // Saved views are toggles — clicking an active view clears its filter,
  // clicking an inactive view applies it. The `apply` closure reads the
  // current `active` value so a single click always does the right thing
  // regardless of prior state.
  const unreviewedActive = Boolean(filter.unreviewedOnly);
  const recurringActive = filter.recurrenceClass === "recurring";
  const oneTimeActive = filter.recurrenceClass === "one_time";
  const sharedActive = filter.shareStatus === "shared";
  const personalActive = filter.shareStatus === "personal";
  const savedViews: {
    name: string;
    n: number | null;
    apply: () => void;
    active: boolean;
  }[] = [
    {
      name: "Unreviewed only",
      n: list.totalUnreviewed,
      apply: () =>
        onSetFilter({ unreviewedOnly: !unreviewedActive }),
      active: unreviewedActive,
    },
    {
      name: "Recurring",
      n: null,
      apply: () =>
        onSetFilter({ recurrenceClass: recurringActive ? null : "recurring" }),
      active: recurringActive,
    },
    {
      name: "One-time only",
      n: null,
      apply: () =>
        onSetFilter({ recurrenceClass: oneTimeActive ? null : "one_time" }),
      active: oneTimeActive,
    },
    {
      name: "Shared with friends",
      n: null,
      apply: () =>
        onSetFilter({ shareStatus: sharedActive ? null : "shared" }),
      active: sharedActive,
    },
    {
      name: "Just me",
      n: null,
      apply: () =>
        onSetFilter({ shareStatus: personalActive ? null : "personal" }),
      active: personalActive,
    },
  ];

  // Bundle hint — derived: when several uncategorized rows share a
  // counterparty, surface a one-click "filter to all of them" so the user
  // can review the lot in the InboxModal.
  const counterpartyCounts = new Map<string, { n: number; sum: number }>();
  for (const r of list.rows) {
    if (!r.counterparty || r.category) continue;
    const c = counterpartyCounts.get(r.counterparty) ?? { n: 0, sum: 0 };
    c.n += 1;
    c.sum += r.amount;
    counterpartyCounts.set(r.counterparty, c);
  }
  let bundleCandidate: { cp: string; n: number; sum: number } | null = null;
  for (const [cp, stats] of counterpartyCounts) {
    if (stats.n < 3) continue;
    if (!bundleCandidate || stats.n > bundleCandidate.n) {
      bundleCandidate = { cp, n: stats.n, sum: stats.sum };
    }
  }

  return (
    <div
      className="flex flex-col"
      style={{ paddingTop: 16, paddingBottom: 80, gap: 16, overflow: "auto" }}
    >
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Saved views</span>
        <div className="flex flex-col gap-1">
          {savedViews.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={v.apply}
              className="flex items-center justify-between"
              style={{
                padding: "7px 10px",
                background: v.active ? "var(--accent-soft)" : "var(--surface)",
                border: `1px solid ${v.active ? "var(--accent-line)" : "var(--border)"}`,
                borderRadius: 7,
                fontSize: 13,
                textAlign: "left",
                cursor: "pointer",
                color: v.active ? "var(--accent)" : "inherit",
                fontFamily: "inherit",
              }}
            >
              <span className="flex items-center gap-2">
                <span className={`dot ${v.active ? "accent" : "warn"}`} />
                <span>{v.name}</span>
              </span>
              {v.n != null && (
                <span className="mono tabular muted">{v.n.toLocaleString()}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-sm ghost"
            title="Saved filter persistence is a follow-up — for now use the saved views above"
            style={{ justifyContent: "flex-start", marginTop: 2 }}
          >
            <Ico name="plus" size={13} /> Save current filters
          </button>
        </div>
      </div>

      {bundleCandidate && (
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
            <span className="eyebrow eyebrow-accent">Bundle hint</span>
          </div>
          <div className="h2" style={{ marginBottom: 6 }}>
            {bundleCandidate.n} {bundleCandidate.cp} txns, all uncategorized.
          </div>
          <p className="small" style={{ margin: 0 }}>
            Tag them all in one click — saves ~{Math.ceil(bundleCandidate.n / 3)} minutes.
          </p>
          <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-sm primary"
              onClick={() =>
                onSetFilter({ q: bundleCandidate!.cp })
              }
              style={{ marginLeft: "auto" }}
            >
              Filter to {bundleCandidate.n} txns <Ico name="arrow-right" size={13} />
            </button>
          </div>
        </div>
      )}

      <div className="surface" style={{ padding: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          For these {list.totalMatching.toLocaleString()} matches
        </div>
        <div className="flex flex-col gap-1.5">
          <StatRow label="Outflow" value={`−${fmtInr(list.totalDebit)}`} cls="debit" />
          <StatRow label="Inflow" value={`+${fmtInr(list.totalCredit)}`} cls="credit" />
          <StatRow
            label="Net"
            value={`${list.totalCredit - list.totalDebit >= 0 ? "+" : "−"}${fmtInr(Math.abs(list.totalCredit - list.totalDebit))}`}
            cls={list.totalCredit >= list.totalDebit ? "credit" : "debit"}
          />
          <StatRow
            label="Unreviewed"
            value={`${list.totalUnreviewed.toLocaleString()} of ${list.totalMatching.toLocaleString()}`}
          />
          {filter.q && (
            <StatRow label="Search" value={`“${filter.q}”`} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  cls = "",
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ fontSize: 12.5 }}
    >
      <span className="muted">{label}</span>
      <span className={`mono tabular ${cls || "fg-2"}`}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SelectionBar — bottom strip when one or more rows are picked
// ────────────────────────────────────────────────────────────────────────────

function SelectionBar({
  count,
  sum,
  onClear,
}: {
  count: number;
  sum: number;
  onClear: () => void;
}) {
  if (count === 0) {
    return (
      <div
        className="flex items-center"
        style={{
          padding: "10px 32px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <span className="muted small">
          Click a row to open · select with the checkbox · keyboard:
        </span>
        <span className="flex items-center gap-3 muted" style={{ fontSize: 11.5 }}>
          <span className="flex items-center gap-1">
            <span className="kbd">J</span>/<span className="kbd">K</span> nav
          </span>
          <span className="flex items-center gap-1">
            <span className="kbd">⏎</span> open
          </span>
          <span className="flex items-center gap-1">
            <span className="kbd">N</span> next unreviewed
          </span>
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center"
      style={{
        padding: "10px 32px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
        gap: 16,
        flexShrink: 0,
      }}
    >
      <span className="chip accent">
        <span className="mono">{count}</span> selected
      </span>
      {sum > 0 && (
        <span className="tag mono">sum −{fmtInr(sum)}</span>
      )}
      <button type="button" className="btn btn-sm ghost" onClick={onClear}>
        <Ico name="x" size={13} /> Clear
      </button>
      <div style={{ flex: 1 }} />
      <div className="flex items-center gap-2 small muted">
        <span>Bulk actions land in the inbox modal · open one to apply across selection</span>
      </div>
    </div>
  );
}
