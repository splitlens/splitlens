"use client";

/**
 * Client-side surface for /review/split. Same client-side filtering
 * architecture as /review/category — server ships the whole ledger
 * once; we filter + categorize in-browser on every range/chip click
 * via useMemo, so the queue updates on the same frame as the click.
 *
 * Renders the shared filter chrome (Scrubber + FilterRow + SearchBar)
 * at the top, then the queue itself as three sections (Persons /
 * Recurring / Large) below. Per-row click opens SplitTxnModal.
 */
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Ico } from "@/components/Ico";
import { fmtInr } from "@/lib/format";
import type {
  ClientMerchantContext,
  ClientReviewRow,
  ReviewFilterMeta,
  ReviewListFilter,
  SplitQueueRow,
} from "@/lib/review-repo";
import {
  applyClientFilter,
  buildClientTimeBuckets,
} from "@/lib/review-client";

import { FilterRow, Scrubber, SearchBar } from "./ReviewLayout";
import { SplitTxnModal } from "./SplitTxnModal";

/** How the queue rows in each section are arranged.
 *   "txn"       → flat list, one row per transaction (default)
 *   "merchant"  → collapse rows that share a counterparty
 *   "category"  → collapse rows that share a category
 *
 * Mirrors the /review/category "By date / By merchant" segment with
 * an extra option, since the split queue's "Other un-reviewed"
 * section commonly repeats both. */
type GroupMode = "txn" | "merchant" | "category";

interface Props {
  filter: ReviewListFilter;
  allRows: ClientReviewRow[];
  merchantContexts: ClientMerchantContext[];
  meta: ReviewFilterMeta;
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  largeThreshold: number;
}

export function SplitQueueClient({
  filter: initialFilter,
  allRows,
  meta,
  people,
  largeThreshold,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  // Local filter state — same pattern as /review/category. URL drives
  // the initial value; subsequent changes update local state instantly
  // and sync back to the URL on a debounced effect.
  const [filter, setLocalFilter] = useState<ReviewListFilter>(initialFilter);

  // Toggle: show everything in the slice, including rows already
  // marked reviewed or already split? Off by default so the queue
  // surfaces just the open candidates (the "fresh inbox" intent).
  // Flip on to see all counterparty txns in the slice — useful when
  // every txn in the active filter is already done and the user
  // wants to verify or edit existing splits.
  const [showAll, setShowAll] = useState(false);

  // Grouping mode. Mirrors the /review/category "By date / By merchant"
  // toggle but with a third option, "By category", since the split
  // queue's "Other un-reviewed" section tends to repeat merchants and
  // categories that benefit from aggregation. Default: by txn (flat
  // list), the original behavior.
  const [groupMode, setGroupMode] = useState<GroupMode>("txn");

  // Which group keys are currently expanded (each section's groups
  // are keyed by `${sectionId}:${groupName}`). Closed by default —
  // user opens to see child rows.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filteredRows = useMemo(
    () => applyClientFilter(allRows, filter),
    [allRows, filter],
  );

  // Scrubber needs the time buckets derived from ALL rows (so the
  // strip shows every month with data, not just the currently-filtered
  // ones — same as /review/category).
  const buckets = useMemo(
    () => buildClientTimeBuckets(allRows, filter),
    [allRows, filter],
  );

  // Categorize the filtered rows into the three split-queue sections.
  // Ported from the server-side SQL `getSplitQueueRows` so we can run
  // it on the filtered slice without a round-trip. Same priority order
  // (person > recurring > large) and the same de-dup rule (a row is
  // tagged once with its strongest reason).
  const peopleByPersonId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) m.set(p.id, p.displayName);
    return m;
  }, [people]);

  const { personRows, recurringRows, largeRows } = useMemo(() => {
    const personRows: SplitQueueRow[] = [];
    const recurringRows: SplitQueueRow[] = [];
    const largeRows: SplitQueueRow[] = [];
    for (const r of filteredRows) {
      // Default mode = "candidates only": un-reviewed AND un-split.
      // Show-all mode = include everything in the slice (reviewed and
      // already-split rows are still rendered so the user can verify
      // or edit existing decisions). Empty counterparties are never
      // shown either way — there's nothing meaningful to split.
      if (!showAll) {
        if (r.reviewed) continue;
        if ((r.shareCount ?? 1) > 1) continue;
      }
      if (!r.counterparty || r.counterparty === "") continue;

      const isPersonKind = r.counterpartyKind === "person";
      const isUnsplit = (r.shareCount ?? 1) <= 1;
      const isLarge = r.amount >= largeThreshold;
      const isRecurring =
        r.recurrence === "monthly" ||
        r.recurrence === "weekly" ||
        r.recurrence === "quarterly";
      const isRecurringWithPerson = isRecurring && isPersonKind;

      const matches =
        (isPersonKind && isUnsplit) || isLarge || isRecurringWithPerson;
      if (!matches) continue;

      // Priority: person > recurring > large.
      let reason: SplitQueueRow["reason"];
      if (isPersonKind && isUnsplit && !isRecurringWithPerson) {
        reason = "person";
      } else if (isRecurringWithPerson) {
        reason = "recurring";
      } else {
        reason = "large";
      }

      const suggestedSplitWith =
        r.personId && peopleByPersonId.get(r.personId)
          ? peopleByPersonId.get(r.personId)!
          : null;

      const queueRow: SplitQueueRow = {
        id: r.id,
        txnDate: r.txnDate,
        txnTime: r.txnTime,
        amount: r.amount,
        direction: r.direction,
        counterparty: r.counterparty,
        counterpartyKind: r.counterpartyKind,
        personId: r.personId,
        category: r.category,
        recurrence: r.recurrence,
        reason,
        suggestedSplitWith,
        reviewed: r.reviewed,
        shareCount: r.shareCount ?? 1,
        sharedWith: r.sharedWith ?? [],
      };

      if (reason === "person") personRows.push(queueRow);
      else if (reason === "recurring") recurringRows.push(queueRow);
      else largeRows.push(queueRow);
    }
    // Sort each section by (category, date desc). Co-locating
    // same-category rows means arrow-keying through the modal walks
    // the user through all the Tea & Cigarettes txns, then all the
    // Food txns, etc. — much less context switching per decision
    // than jumping by date alone. The modal header animates when
    // the category changes between rows so the transition is
    // visible.
    const sortCatThenDate = (a: SplitQueueRow, b: SplitQueueRow) => {
      const ac = a.category ?? "￿uncategorized";
      const bc = b.category ?? "￿uncategorized";
      // Uncategorized rows sink to the end of each section via the
      // large-codepoint prefix; everything else collates by name.
      if (ac !== bc) return ac.localeCompare(bc);
      return (
        b.txnDate.localeCompare(a.txnDate) ||
        (b.txnTime ?? "").localeCompare(a.txnTime ?? "")
      );
    };
    personRows.sort(sortCatThenDate);
    recurringRows.sort(sortCatThenDate);
    largeRows.sort(sortCatThenDate);
    return { personRows, recurringRows, largeRows };
  }, [filteredRows, largeThreshold, peopleByPersonId, showAll]);

  const flat = useMemo(
    () => [...personRows, ...recurringRows, ...largeRows],
    [personRows, recurringRows, largeRows],
  );

  // setFilter: same shape as /review/category's setFilter so the
  // shared FilterRow + Scrubber + SearchBar work unchanged.
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
        if ("accountId" in patch) next.accountId = patch.accountId ?? null;
        if ("q" in patch) next.q = patch.q ?? null;
        if ("sort" in patch) next.sort = patch.sort ?? undefined;
        if ("timeOfDay" in patch) next.timeOfDay = patch.timeOfDay ?? null;
        if ("shareStatus" in patch) next.shareStatus = patch.shareStatus ?? null;
        if ("recurrenceClass" in patch)
          next.recurrenceClass = patch.recurrenceClass ?? null;
        return next;
      });
    },
    [],
  );

  // Debounced URL sync so back/forward + shareable links still work.
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
        router.replace(`/review/split?${nextStr}`, { scroll: false });
      }
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Live sum + match counts for the search/header — derived from the
  // filtered slice, not just the queue rows.
  const matchSum = useMemo(
    () =>
      filteredRows.reduce(
        (s, r) => s + (r.direction === "debit" ? r.amount : 0),
        0,
      ),
    [filteredRows],
  );

  const totalQueueOutflow = flat.reduce(
    (s, r) => s + (r.direction === "debit" ? r.amount : 0),
    0,
  );

  // Modal nav across the entire flat queue (regardless of section).
  const [activeId, setActiveId] = useState<number | null>(null);
  const goPrev = useCallback(() => {
    if (activeId == null) return;
    const idx = flat.findIndex((r) => r.id === activeId);
    if (idx > 0) setActiveId(flat[idx - 1]!.id);
  }, [activeId, flat]);
  const goNext = useCallback(() => {
    if (activeId == null) return;
    const idx = flat.findIndex((r) => r.id === activeId);
    if (idx >= 0 && idx < flat.length - 1) setActiveId(flat[idx + 1]!.id);
    else setActiveId(null);
  }, [activeId, flat]);

  /**
   * Category-jump nav. The flat queue is already sorted (category,
   * date desc) per section, so we walk `flat` once and remember each
   * category's first index — that's where `]` / category-picker
   * jumps land. Categories are presented in queue order (i.e. the
   * order the user encounters them while arrow-keying through),
   * which means the picker matches the user's mental model of the
   * sequence, not alphabetical sort.
   */
  const categoryNav = useMemo(() => {
    const seen = new Map<string, { name: string; firstIndex: number; count: number }>();
    flat.forEach((r, i) => {
      const name = r.category ?? "Uncategorized";
      const existing = seen.get(name);
      if (existing) existing.count += 1;
      else seen.set(name, { name, firstIndex: i, count: 1 });
    });
    return Array.from(seen.values()).sort(
      (a, b) => a.firstIndex - b.firstIndex,
    );
  }, [flat]);

  const goPrevCategory = useCallback(() => {
    if (activeId == null) return;
    const idx = flat.findIndex((r) => r.id === activeId);
    if (idx < 0) return;
    const currentCat = flat[idx]!.category ?? "Uncategorized";
    const navIdx = categoryNav.findIndex((c) => c.name === currentCat);
    const target = categoryNav[navIdx - 1];
    if (target) setActiveId(flat[target.firstIndex]!.id);
  }, [activeId, flat, categoryNav]);

  const goNextCategory = useCallback(() => {
    if (activeId == null) return;
    const idx = flat.findIndex((r) => r.id === activeId);
    if (idx < 0) return;
    const currentCat = flat[idx]!.category ?? "Uncategorized";
    const navIdx = categoryNav.findIndex((c) => c.name === currentCat);
    const target = categoryNav[navIdx + 1];
    if (target) setActiveId(flat[target.firstIndex]!.id);
  }, [activeId, flat, categoryNav]);

  const goToCategory = useCallback(
    (name: string) => {
      const target = categoryNav.find((c) => c.name === name);
      if (target) setActiveId(flat[target.firstIndex]!.id);
    },
    [categoryNav, flat],
  );

  /**
   * Merchant-jump nav. Same shape as categoryNav but keyed by
   * counterparty name. Merchants repeat across categories in the
   * queue (one merchant can appear in many categories), so we
   * collapse to distinct names and remember the first index in
   * queue order — that's where the picker / `]` jumps land. Empty
   * counterparties are dropped (they'd collapse all "unknown" rows
   * into a single confusing entry).
   */
  const merchantNav = useMemo(() => {
    const seen = new Map<string, { name: string; firstIndex: number; count: number }>();
    flat.forEach((r, i) => {
      const name = r.counterparty;
      if (!name) return;
      const existing = seen.get(name);
      if (existing) existing.count += 1;
      else seen.set(name, { name, firstIndex: i, count: 1 });
    });
    return Array.from(seen.values()).sort(
      (a, b) => a.firstIndex - b.firstIndex,
    );
  }, [flat]);

  const goPrevMerchant = useCallback(() => {
    if (activeId == null) return;
    const idx = flat.findIndex((r) => r.id === activeId);
    if (idx < 0) return;
    const currentName = flat[idx]!.counterparty;
    const navIdx = merchantNav.findIndex((m) => m.name === currentName);
    const target = merchantNav[navIdx - 1];
    if (target) setActiveId(flat[target.firstIndex]!.id);
  }, [activeId, flat, merchantNav]);

  const goNextMerchant = useCallback(() => {
    if (activeId == null) return;
    const idx = flat.findIndex((r) => r.id === activeId);
    if (idx < 0) return;
    const currentName = flat[idx]!.counterparty;
    const navIdx = merchantNav.findIndex((m) => m.name === currentName);
    const target = merchantNav[navIdx + 1];
    if (target) setActiveId(flat[target.firstIndex]!.id);
  }, [activeId, flat, merchantNav]);

  const goToMerchant = useCallback(
    (name: string) => {
      const target = merchantNav.find((m) => m.name === name);
      if (target) setActiveId(flat[target.firstIndex]!.id);
    },
    [merchantNav, flat],
  );

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  const active = activeId != null ? flat.find((r) => r.id === activeId) ?? null : null;

  return (
    <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero */}
      <div style={{ padding: "20px 40px 14px" }}>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div style={{ flex: 1, minWidth: 320 }}>
            <div className="flex items-center gap-3">
              <span className="eyebrow eyebrow-accent">
                Review · who owes whom?
              </span>
              <span className="tag">
                Split<span className="muted-2">/</span>queue
                <span className="muted-2">/</span>
                {flat.length.toLocaleString()} candidate
                {flat.length === 1 ? "" : "s"}
              </span>
            </div>
            <h1 className="display" style={{ fontSize: 30, marginTop: 8 }}>
              {flat.length} txn{flat.length === 1 ? "" : "s"} look split-able.
              <span className="muted">
                {" "}Decide once, settle later.
              </span>
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end" style={{ minWidth: 160 }}>
              <span className="eyebrow">Outflow in queue</span>
              <span className="num-amount debit" style={{ fontSize: 22 }}>
                −{fmtInr(totalQueueOutflow)}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm outline"
              onClick={() => setShowAll((v) => !v)}
              aria-pressed={showAll}
              title={
                showAll
                  ? "Showing every counterparty txn in the slice, including reviewed and already-split"
                  : "Also surface reviewed-as-personal and already-split rows"
              }
              style={{
                background: showAll ? "var(--accent-soft)" : "transparent",
                borderColor: showAll ? "var(--accent-line)" : undefined,
                color: showAll ? "var(--accent)" : undefined,
              }}
            >
              <Ico
                name={showAll ? "check" : "eye"}
                size={13}
              />
              {showAll ? "Showing all" : "Show all"}
            </button>
            <Link href="/friends" className="btn btn-sm outline">
              <Ico name="users" size={13} /> Friends ledger
            </Link>
          </div>
        </div>

        {/* Search */}
        <div style={{ marginTop: 14 }}>
          <SearchBar
            initial={filter.q ?? ""}
            matches={filteredRows.length}
            sum={matchSum}
            onSubmit={(q) => setFilter({ q: q || null })}
          />
        </div>

        {/* Filter chips */}
        <div style={{ marginTop: 10 }}>
          <FilterRow
            filter={filter}
            buckets={buckets}
            meta={meta}
            totalMatching={filteredRows.length}
            matchSum={matchSum}
            matchAvg={
              filteredRows.length > 0
                ? Math.round(matchSum / filteredRows.length)
                : 0
            }
            onSetFilter={setFilter}
            onClear={(key) => {
              if (key === "time") setFilter({ from: null, to: null });
              else if (key === "category") setFilter({ category: null });
              else if (key === "account") setFilter({ accountId: null });
              else if (key === "unreviewed")
                setFilter({ unreviewedOnly: false });
              else if (key === "share") setFilter({ shareStatus: null });
              else if (key === "rec") setFilter({ recurrenceClass: null });
              else if (key === "tod") setFilter({ timeOfDay: null });
              else if (key === "q") setFilter({ q: null });
            }}
            onClearAll={() =>
              setFilter({
                from: null,
                to: null,
                category: null,
                unreviewedOnly: false,
                personId: null,
                accountId: null,
                q: null,
                timeOfDay: null,
                shareStatus: null,
                recurrenceClass: null,
              })
            }
          />
        </div>
      </div>

      {/* Timeline scrubber — RANGE strip + DAY BY DAY chart, same as
          /review/category. Click a month to scope the queue; click a
          day to narrow to that single day. */}
      <Scrubber buckets={buckets} filter={filter} onPick={setFilter} />

      {/* Group-mode toggle. Same idea as /review/category's by-date /
          by-merchant, with an extra "by category" since the split
          queue's Other section tends to repeat both. */}
      <div
        role="tablist"
        aria-label="Group queue rows by"
        className="flex items-center gap-1"
        style={{ padding: "12px 40px 0" }}
      >
        {[
          { id: "txn" as const, label: "By txn", hint: "Each row individually" },
          {
            id: "merchant" as const,
            label: "By merchant",
            hint: "Collapse repeats per counterparty",
          },
          {
            id: "category" as const,
            label: "By category",
            hint: "Collapse repeats per category",
          },
        ].map((o) => {
          const active = o.id === groupMode;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={o.hint}
              onClick={() => {
                setGroupMode(o.id);
                setOpenGroups(new Set());
              }}
              className={`btn btn-sm ${active ? "" : "ghost"}`}
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Queue sections */}
      <div
        style={{
          padding: "20px 40px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {flat.length === 0 && (
          <div
            className="surface"
            style={{ padding: 24, textAlign: "center" }}
          >
            <div className="display" style={{ fontSize: 22, marginBottom: 6 }}>
              Nothing to split in this slice.
            </div>
            <div className="muted small">
              {filteredRows.length === 0 ? (
                <>
                  No txns match the current filter. Try widening the
                  range or clearing chips above.
                </>
              ) : showAll ? (
                <>
                  {filteredRows.length.toLocaleString()} txn
                  {filteredRows.length === 1 ? "" : "s"} match the
                  filter, but none have a counterparty to split.
                  Widen the range to find candidates.
                </>
              ) : (
                <>
                  {filteredRows.length.toLocaleString()} txn
                  {filteredRows.length === 1 ? "" : "s"} match the
                  filter, but they&rsquo;re all either already split
                  or marked reviewed-as-personal.{" "}
                  <button
                    type="button"
                    className="btn btn-sm ghost"
                    onClick={() => setShowAll(true)}
                    style={{
                      display: "inline-flex",
                      padding: "2px 8px",
                      fontSize: 11.5,
                      marginLeft: 4,
                    }}
                  >
                    <Ico name="eye" size={11} /> Show all
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {personRows.length > 0 && (
          <Section
            title="Person transfers · not yet split"
            hint="Direct transfers to known people. Default split is 2-way."
            count={personRows.length}
            tone="primary"
          >
            <QueueBody
              rows={personRows}
              sectionId="person"
              groupMode={groupMode}
              openGroups={openGroups}
              onToggleGroup={toggleGroup}
              onOpenRow={(id) => setActiveId(id)}
            />
          </Section>
        )}
        {recurringRows.length > 0 && (
          <Section
            title="Recurring with people"
            hint="Rent / utility / regular shared expenses. Setting one rule auto-classifies the rest."
            count={recurringRows.length}
            tone="accent"
          >
            <QueueBody
              rows={recurringRows}
              sectionId="recurring"
              groupMode={groupMode}
              openGroups={openGroups}
              onToggleGroup={toggleGroup}
              onOpenRow={(id) => setActiveId(id)}
            />
          </Section>
        )}
        {largeRows.length > 0 && (
          <Section
            title={
              largeThreshold > 0
                ? `Large expenses · ≥ ${fmtInr(largeThreshold)}`
                : "Other un-reviewed"
            }
            hint={
              largeThreshold > 0
                ? "Sizable un-reviewed txns. Most likely candidates for splitting with someone."
                : "Every other un-reviewed counterparty txn in this slice — pick the ones you split."
            }
            count={largeRows.length}
            tone="warn"
          >
            <QueueBody
              rows={largeRows}
              sectionId="other"
              groupMode={groupMode}
              openGroups={openGroups}
              onToggleGroup={toggleGroup}
              onOpenRow={(id) => setActiveId(id)}
            />
          </Section>
        )}
      </div>

      {active && (() => {
        // Compute "N of M in this category" for the modal header.
        // Because the queue is sorted (category, date desc) per
        // section, all same-category rows are contiguous within each
        // section — but cross-section the same category may appear
        // again. We count across the WHOLE flat array so the user
        // sees the global progress, not just within-section.
        const activeCat = active.category ?? "Uncategorized";
        const sameCat = flat.filter(
          (r) => (r.category ?? "Uncategorized") === activeCat,
        );
        const positionInCategory =
          sameCat.findIndex((r) => r.id === active.id) + 1;
        const currentNavIdx = categoryNav.findIndex(
          (c) => c.name === activeCat,
        );
        // Merchant context — mirrors the category context shape so
        // the modal can render two parallel strips + pickers.
        const activeMerchant = active.counterparty;
        const sameMerchant = flat.filter(
          (r) => r.counterparty === activeMerchant,
        );
        const positionInMerchant =
          sameMerchant.findIndex((r) => r.id === active.id) + 1;
        const currentMerchantNavIdx = merchantNav.findIndex(
          (m) => m.name === activeMerchant,
        );
        return (
          <SplitTxnModal
            row={active}
            people={people}
            onClose={() => setActiveId(null)}
            onPrev={goPrev}
            onNext={goNext}
            onAfterSave={() => {
              refresh();
              goNext();
            }}
            positionIdx={flat.findIndex((r) => r.id === active.id) + 1}
            positionTotal={flat.length}
            category={{
              name: activeCat,
              positionInCategory,
              totalInCategory: sameCat.length,
            }}
            categoryNav={categoryNav}
            categoryNavIdx={currentNavIdx}
            onPrevCategory={goPrevCategory}
            onNextCategory={goNextCategory}
            onJumpToCategory={goToCategory}
            merchant={{
              name: activeMerchant,
              positionInMerchant,
              totalInMerchant: sameMerchant.length,
            }}
            merchantNav={merchantNav}
            merchantNavIdx={currentMerchantNavIdx}
            onPrevMerchant={goPrevMerchant}
            onNextMerchant={goNextMerchant}
            onJumpToMerchant={goToMerchant}
          />
        );
      })()}
    </main>
  );
}

function Section({
  title,
  hint,
  count,
  tone,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  tone: "primary" | "accent" | "warn";
  children: React.ReactNode;
}) {
  const dot =
    tone === "primary"
      ? "var(--accent)"
      : tone === "accent"
        ? "var(--credit)"
        : "var(--warn)";
  return (
    <section className="surface" style={{ padding: 18 }}>
      <header
        className="flex items-baseline justify-between"
        style={{
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
          gap: 12,
        }}
      >
        <div className="flex items-center gap-3" style={{ minWidth: 0, flex: 1 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: dot,
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="h2">
              {title}{" "}
              <span className="muted" style={{ fontSize: 13 }}>
                · {count}
              </span>
            </span>
            <span className="tiny" style={{ color: "var(--muted-2)" }}>
              {hint}
            </span>
          </div>
        </div>
      </header>
      <div className="flex flex-col" style={{ marginTop: 8, gap: 2 }}>
        {children}
      </div>
    </section>
  );
}

function Row({
  row,
  onOpen,
}: {
  row: SplitQueueRow;
  onOpen: () => void;
}) {
  const date = fmtDayMonth(row.txnDate);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="split-queue-row"
      style={{
        display: "grid",
        gridTemplateColumns: "80px 1fr auto auto",
        gap: 14,
        alignItems: "center",
        padding: "11px 10px",
        background: "transparent",
        border: "1px solid transparent",
        borderTop: "1px dashed var(--border-dashed)",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        color: "inherit",
        fontFamily: "inherit",
        transition:
          "background 140ms var(--ease-out), border-color 140ms var(--ease-out)",
      }}
    >
      <span
        className="mono tiny"
        style={{
          color: "var(--muted)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {date}
        {row.txnTime && (
          <span style={{ marginLeft: 8, color: "var(--muted-2)" }}>
            {row.txnTime}
          </span>
        )}
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: "var(--fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.counterparty}
        </span>
        <span className="tiny" style={{ color: "var(--muted-2)" }}>
          {row.category ?? "Uncategorized"}
          {row.recurrence && row.recurrence !== "one_time" && (
            <span style={{ marginLeft: 8, color: "var(--accent)" }}>
              · {row.recurrence}
            </span>
          )}
        </span>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {row.shareCount > 1 ? (
          // Already-split row — show a calm muted badge stating the
          // current split. Visually distinct from the accent
          // "suggested split" pill so the user can tell at a glance
          // which queue rows are decisions vs done.
          <span
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              padding: "2px 8px",
              border: "1px solid var(--border)",
              borderRadius: 999,
              background: "var(--surface-2)",
            }}
          >
            split {row.shareCount}-way
            {row.sharedWith.length > 0
              ? ` with ${row.sharedWith.join(", ")}`
              : ""}
          </span>
        ) : row.reviewed ? (
          // Reviewed-as-personal — also done. Subtle "reviewed" tag.
          <span
            style={{
              fontSize: 11.5,
              color: "var(--muted-2)",
              padding: "2px 8px",
              border: "1px dashed var(--border)",
              borderRadius: 999,
              background: "transparent",
            }}
          >
            reviewed · just me
          </span>
        ) : row.suggestedSplitWith ? (
          <span
            style={{
              fontSize: 11.5,
              color: "var(--accent)",
              padding: "2px 8px",
              border: "1px solid var(--accent-line)",
              borderRadius: 999,
              background: "var(--accent-soft)",
            }}
          >
            ✨ split 2-way with {row.suggestedSplitWith}
          </span>
        ) : (
          <span className="tiny muted">choose split</span>
        )}
      </div>
      <span
        className="num-amount"
        style={{
          fontSize: 14,
          color:
            row.direction === "debit" ? "var(--debit)" : "var(--credit)",
          minWidth: 90,
          textAlign: "right",
        }}
      >
        {row.direction === "debit" ? "−" : "+"}
        {fmtInr(row.amount)}
      </span>
    </button>
  );
}

function fmtDayMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[m - 1]} ’${String(y).slice(2)}`;
}

/**
 * Renders the body of a queue section. Switches on groupMode:
 *   "txn"       — flat list (one Row per txn)
 *   "merchant"  — group rows by counterparty; each group collapses
 *   "category"  — group rows by category; each group collapses
 *
 * Groups are sorted by total absolute amount desc so the biggest
 * batches surface first. Within a group, children sort by date desc
 * (already the case from the parent's section sort).
 */
function QueueBody({
  rows,
  sectionId,
  groupMode,
  openGroups,
  onToggleGroup,
  onOpenRow,
}: {
  rows: SplitQueueRow[];
  sectionId: string;
  groupMode: GroupMode;
  openGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onOpenRow: (id: number) => void;
}) {
  if (groupMode === "txn") {
    return (
      <>
        {rows.map((r) => (
          <Row key={r.id} row={r} onOpen={() => onOpenRow(r.id)} />
        ))}
      </>
    );
  }

  // Group by merchant or category. Anonymous / missing keys land
  // under "(unknown)" so they aren't silently dropped.
  const keyFn = (r: SplitQueueRow): string =>
    groupMode === "merchant"
      ? r.counterparty || "(unknown)"
      : r.category ?? "Uncategorized";

  const groups = new Map<string, SplitQueueRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  const sorted = Array.from(groups.entries())
    .map(([name, rs]) => ({
      name,
      rows: rs,
      total: rs.reduce((s, r) => s + r.amount, 0),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <>
      {sorted.map((g) => {
        const groupId = `${sectionId}:${g.name}`;
        const isOpen = openGroups.has(groupId);
        return (
          <div key={groupId}>
            <GroupRow
              name={g.name}
              rows={g.rows}
              total={g.total}
              isOpen={isOpen}
              onToggle={() => onToggleGroup(groupId)}
            />
            {isOpen && (
              <div
                style={{
                  paddingLeft: 28,
                  borderLeft: "1px solid var(--border)",
                  marginLeft: 14,
                }}
              >
                {g.rows.map((r) => (
                  <Row
                    key={r.id}
                    row={r}
                    onOpen={() => onOpenRow(r.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Aggregated group row — collapsible.
 *
 * Layout mirrors the flat Row (chevron, name+meta, suggested-split
 * badge, amount) so the user's eye doesn't have to re-anchor when
 * switching grouping modes. The right-side badge prefers the
 * "✨ split N-way" suggestion if every child shares the same target;
 * otherwise it shows the txn count and a "choose split" hint.
 */
function GroupRow({
  name,
  rows,
  total,
  isOpen,
  onToggle,
}: {
  name: string;
  rows: SplitQueueRow[];
  total: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  // If every child suggests the same person, surface that as the
  // group-level suggestion. Otherwise leave it null — the user has
  // to expand to decide each one.
  const suggested = useMemo(() => {
    const first = rows[0]?.suggestedSplitWith ?? null;
    if (!first) return null;
    return rows.every((r) => r.suggestedSplitWith === first) ? first : null;
  }, [rows]);

  const oldest = rows[rows.length - 1]?.txnDate;
  const newest = rows[0]?.txnDate;
  const dateRange =
    oldest && newest && oldest !== newest
      ? `${fmtDayMonth(oldest)} → ${fmtDayMonth(newest)}`
      : newest
        ? fmtDayMonth(newest)
        : "";

  const avg = rows.length > 0 ? total / rows.length : 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr auto auto",
        gap: 14,
        alignItems: "center",
        padding: "12px 10px",
        background: isOpen
          ? "color-mix(in srgb, var(--fg) 3%, transparent)"
          : "transparent",
        border: "1px solid transparent",
        borderTop: "1px dashed var(--border-dashed)",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        color: "inherit",
        fontFamily: "inherit",
        width: "100%",
        transition:
          "background 140ms var(--ease-out), border-color 140ms var(--ease-out)",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted-2)",
        }}
      >
        <Ico name={isOpen ? "chevron-down" : "chevron-right"} size={13} />
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: "var(--fg)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span
          className="tiny"
          style={{ color: "var(--muted-2)" }}
        >
          {rows.length} txn{rows.length === 1 ? "" : "s"}
          {avg > 0 && (
            <span style={{ marginLeft: 8 }}>· avg {fmtInr(Math.round(avg))}</span>
          )}
          {dateRange && (
            <span style={{ marginLeft: 8 }}>· {dateRange}</span>
          )}
        </span>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {suggested ? (
          <span
            style={{
              fontSize: 11.5,
              color: "var(--accent)",
              padding: "2px 8px",
              border: "1px solid var(--accent-line)",
              borderRadius: 999,
              background: "var(--accent-soft)",
            }}
          >
            ✨ split 2-way with {suggested}
          </span>
        ) : (
          <span className="tiny muted">expand to choose</span>
        )}
      </div>
      <span
        className="num-amount"
        style={{
          fontSize: 14,
          color: "var(--debit)",
          minWidth: 90,
          textAlign: "right",
        }}
      >
        −{fmtInr(total)}
      </span>
    </button>
  );
}
