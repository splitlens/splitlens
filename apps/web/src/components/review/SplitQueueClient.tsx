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
    // Sort each section by date desc.
    const sortDesc = (a: SplitQueueRow, b: SplitQueueRow) =>
      b.txnDate.localeCompare(a.txnDate) ||
      (b.txnTime ?? "").localeCompare(a.txnTime ?? "");
    personRows.sort(sortDesc);
    recurringRows.sort(sortDesc);
    largeRows.sort(sortDesc);
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
            {personRows.map((r) => (
              <Row key={r.id} row={r} onOpen={() => setActiveId(r.id)} />
            ))}
          </Section>
        )}
        {recurringRows.length > 0 && (
          <Section
            title="Recurring with people"
            hint="Rent / utility / regular shared expenses. Setting one rule auto-classifies the rest."
            count={recurringRows.length}
            tone="accent"
          >
            {recurringRows.map((r) => (
              <Row key={r.id} row={r} onOpen={() => setActiveId(r.id)} />
            ))}
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
            {largeRows.map((r) => (
              <Row key={r.id} row={r} onOpen={() => setActiveId(r.id)} />
            ))}
          </Section>
        )}
      </div>

      {active && (
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
        />
      )}
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
