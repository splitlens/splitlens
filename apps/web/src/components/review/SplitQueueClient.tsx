"use client";

/**
 * The client-side surface for /review/split. Renders the queue as
 * three sections and owns the open-modal state for SplitTxnModal.
 *
 * Lightweight by design — the queue is a triage list, not a deep
 * analytical view. The actual split decisions happen in the modal;
 * heavier per-person ledger work lives at /friends/[personId].
 */
import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Ico } from "@/components/Ico";
import { fmtInr } from "@/lib/format";
import type { SplitQueueRow } from "@/lib/review-repo";

import { SplitTxnModal } from "./SplitTxnModal";

interface Props {
  personRows: SplitQueueRow[];
  recurringRows: SplitQueueRow[];
  largeRows: SplitQueueRow[];
  people: Array<{
    id: string;
    displayName: string;
    relationship: string;
    txnCount: number;
  }>;
  largeThreshold: number;
}

export function SplitQueueClient({
  personRows,
  recurringRows,
  largeRows,
  people,
  largeThreshold,
}: Props) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  // Flat list (priority-ordered) used by the modal to navigate
  // Prev/Next without losing the queue's grouping.
  const flat = useMemo(
    () => [...personRows, ...recurringRows, ...largeRows],
    [personRows, recurringRows, largeRows],
  );

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

  const totalAmount = flat.reduce(
    (s, r) => s + (r.direction === "debit" ? r.amount : 0),
    0,
  );

  if (flat.length === 0) {
    return (
      <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
        <div style={{ padding: "28px 40px 22px" }}>
          <h1 className="display" style={{ fontSize: 36, margin: 0 }}>
            Nothing waiting to split.{" "}
            <span className="muted">You&rsquo;re square.</span>
          </h1>
          <p className="body" style={{ marginTop: 8, maxWidth: 640 }}>
            We&rsquo;ll surface txns here whenever a likely-split
            candidate shows up — person-kind transfers without a split,
            large un-reviewed expenses (≥{" "}
            {fmtInr(largeThreshold)}), or recurring monthly transfers to
            people. Open the <Link href="/friends" className="accent">Friends ledger</Link> for the per-person view.
          </p>
        </div>
      </main>
    );
  }

  const active = activeId != null ? flat.find((r) => r.id === activeId) ?? null : null;

  return (
    <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero */}
      <div style={{ padding: "28px 40px 18px" }}>
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
            <h1 className="display" style={{ fontSize: 36, marginTop: 8 }}>
              {flat.length} txn{flat.length === 1 ? "" : "s"} look split-able.
              <span className="muted">
                {" "}Decide once, settle later.
              </span>
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="flex flex-col items-end"
              style={{ minWidth: 160 }}
            >
              <span className="eyebrow">Outflow in queue</span>
              <span
                className="num-amount debit"
                style={{ fontSize: 22 }}
              >
                −{fmtInr(totalAmount)}
              </span>
            </div>
            <Link href="/friends" className="btn btn-sm outline">
              <Ico name="users" size={13} /> Friends ledger
            </Link>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div style={{ padding: "0 40px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
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
            title={`Large expenses · ≥ ${fmtInr(largeThreshold)}`}
            hint="Sizable un-reviewed txns. Most likely candidates for splitting with someone."
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
      <div
        className="flex flex-col"
        style={{ marginTop: 8, gap: 2 }}
      >
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
        <span
          className="tiny"
          style={{ color: "var(--muted-2)" }}
        >
          {row.category ?? "Uncategorized"}
          {row.recurrence && row.recurrence !== "one_time" && (
            <span style={{ marginLeft: 8, color: "var(--accent)" }}>
              · {row.recurrence}
            </span>
          )}
        </span>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {row.suggestedSplitWith ? (
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
