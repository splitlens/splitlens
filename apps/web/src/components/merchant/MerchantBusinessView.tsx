"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import type {
  MerchantBusinessDetail,
  MerchantBusinessMonth,
  MerchantBusinessTxn,
} from "@/lib/repo";
import { fmtDate, fmtInr } from "@/lib/format";
import { TimelineRangeControl } from "./TimelineRangeControl";
import {
  type TimelineRange,
  useTimelineRange,
} from "./useTimelineRange";

/**
 * Business merchant detail — trend + cleanup register.
 *
 * Layout, left → right and top → bottom:
 *   1. Breadcrumb with range pill
 *   2. Timeline range control (preset segmented)
 *   3. 5-column KPI identity strip (avatar + name + 4 numeric cells)
 *   4. 12-month bar chart with avg line + drag-to-scrub
 *   5. Two-column body: txn list (grouped) + right rail (settings / suggested / siblings)
 *   6. Footer with bulk actions
 *
 * The whole page is a client component because the range state lives here
 * — the bar chart, KPI strip, and txn list all subscribe to the same
 * derived `range`, recomputing in memo blocks.
 */
export function MerchantBusinessView({ data }: { data: MerchantBusinessDetail }) {
  const { state, range, setPreset, setDragRange, reset } = useTimelineRange(
    data.months,
  );

  const isCustom = state.preset === "custom";

  return (
    <div className="md-board">
      <BizBreadcrumb data={data} rangeLabel={range.label} />
      <TimelineRangeControl
        preset={state.preset}
        onPresetChange={setPreset}
        onReset={reset}
        rangeLabel={range.label}
        isCustom={isCustom}
      />
      <BizIdentity data={data} range={range} />
      <BizTrend data={data} range={range} onDrag={setDragRange} />
      <div className="biz-grid">
        <BizTxnList data={data} range={range} />
        <BizRail data={data} range={range} />
      </div>
      <BizFootbar data={data} range={range} />
    </div>
  );
}

/* ── Breadcrumb ─────────────────────────────────────────────────────────── */

function BizBreadcrumb({
  data,
  rangeLabel,
}: {
  data: MerchantBusinessDetail;
  rangeLabel: string;
}) {
  return (
    <div className="md-crumb">
      <Link href="/review">Review</Link>
      <span style={{ color: "var(--muted-3)" }}>›</span>
      <Link href="/dashboard">By merchant</Link>
      <span style={{ color: "var(--muted-3)" }}>›</span>
      <span className="here">{data.displayName}</span>
      <span style={{ color: "var(--muted-3)" }}>·</span>
      <span className="range-pill">{rangeLabel}</span>
      <span style={{ flex: 1 }} />
      <Link href="/review" className="btn ghost">
        ← Back
      </Link>
    </div>
  );
}

/* ── Identity / KPI strip ───────────────────────────────────────────────── */

function BizIdentity({
  data,
  range,
}: {
  data: MerchantBusinessDetail;
  range: TimelineRange<MerchantBusinessMonth>;
}) {
  const stats = useMemo(() => {
    const inRange = range.months.filter((m) => m.inRange);
    const sumV = inRange.reduce((s, m) => s + m.v, 0);
    const sumN = inRange.reduce((s, m) => s + m.n, 0);
    const avgPerTxn = sumN > 0 ? Math.round(sumV / sumN) : 0;

    const priorEnd = range.startIdx - 1;
    const priorStart = Math.max(0, priorEnd - range.nMonths + 1);
    const prior =
      priorEnd >= 0 ? range.months.slice(priorStart, priorEnd + 1) : [];
    const priorSum = prior.reduce((s, m) => s + m.v, 0);
    const priorN = prior.reduce((s, m) => s + m.n, 0);
    const delta = sumV - priorSum;
    const ratio = priorSum > 0 ? sumV / priorSum : null;
    const cadenceDays =
      range.nMonths > 0 && sumN > 0
        ? ((range.nMonths * 30) / sumN).toFixed(1)
        : "—";
    return { sumV, sumN, avgPerTxn, prior, priorN, priorSum, delta, ratio, cadenceDays };
  }, [range]);

  const since = data.firstSeen ? new Date(data.firstSeen) : null;
  const sinceLabel = since
    ? `since ${since.toLocaleString("en-IN", { month: "short", year: "2-digit" })}`
    : "—";

  const lifetimeMonths = monthSpan(data.firstSeen, data.lastSeen);

  return (
    <div className="biz-id-grid">
      <div className="biz-id-cell">
        <div className="biz-identity">
          <div className="biz-avi">{data.initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>{data.displayName}</h1>
            <div className="sub">
              <span>{data.topCategory ?? "Uncategorized"}</span>
              <span style={{ color: "var(--muted-3)" }}>·</span>
              <span>
                {data.lifetimeCount} lifetime · {sinceLabel}
              </span>
            </div>
            <div className="tags">
              <span className="chip">
                <span className="dot" style={{ background: "#ad9ad8" }} />
                Business
              </span>
              {data.topCategory && (
                <span className="chip accent">{data.topCategory.split(":")[1] ?? data.topCategory}</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <KpiCell
        label={range.label}
        value={`−${fmtInr(stats.sumV, { showZero: true })}`}
        tone="debit"
        hint={`${stats.sumN} txn${stats.sumN === 1 ? "" : "s"} · avg ₹${stats.avgPerTxn.toLocaleString("en-IN")}`}
      />
      <KpiCell
        label={`vs prior ${range.nMonths === 1 ? "month" : `${range.nMonths} mo`}`}
        value={`${stats.delta >= 0 ? "+" : "−"}${fmtInr(Math.abs(stats.delta), { showZero: true })}`}
        tone={stats.delta > 0 ? "warn" : stats.delta < 0 ? "credit" : "muted"}
        hint={`${
          stats.ratio
            ? stats.ratio >= 1
              ? `↑ ${stats.ratio.toFixed(1)}× `
              : `↓ ${(1 / stats.ratio).toFixed(1)}× `
            : "— "
        }· ${stats.priorN} → ${stats.sumN} txns`}
      />
      <KpiCell
        label="Lifetime"
        value={`−${fmtInr(data.lifetimeSum, { showZero: true })}`}
        hint={`${data.lifetimeCount} txns · ${lifetimeMonths} mo`}
      />
      <KpiCell
        label="Cadence"
        value={`~${stats.cadenceDays}d`}
        hint="in this period"
      />
    </div>
  );
}

function KpiCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "debit" | "credit" | "warn" | "muted";
}) {
  const color =
    tone === "debit"
      ? "var(--debit)"
      : tone === "credit"
        ? "var(--credit)"
        : tone === "warn"
          ? "var(--warn)"
          : tone === "muted"
            ? "var(--muted-2)"
            : undefined;
  return (
    <div className="biz-id-cell">
      <div className="lab">{label}</div>
      <div className="v" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="s">{hint}</div>
    </div>
  );
}

function monthSpan(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  return Math.max(
    1,
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
      (b.getUTCMonth() - a.getUTCMonth()) +
      1,
  );
}

/* ── 12-month trend chart (drag-to-scrub) ───────────────────────────────── */

function BizTrend({
  data,
  range,
  onDrag,
}: {
  data: MerchantBusinessDetail;
  range: TimelineRange<MerchantBusinessMonth>;
  onDrag: (a: number, b: number) => void;
}) {
  const max = Math.max(1, ...data.months.map((m) => m.v));
  const avg =
    data.months.reduce((s, m) => s + m.v, 0) / Math.max(1, data.months.length);
  const inRange = range.months.filter((m) => m.inRange);
  const inAvg =
    inRange.length > 0
      ? inRange.reduce((s, m) => s + m.v, 0) / inRange.length
      : 0;
  const ratio = avg > 0 ? inAvg / avg : 0;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<number | null>(null);

  const idxFromX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const pct = (clientX - r.left) / r.width;
    return Math.max(0, Math.min(11, Math.floor(pct * 12)));
  };

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const i0 = idxFromX(e.clientX);
    dragStart.current = i0;
    onDrag(i0, i0);
    const move = (ev: PointerEvent) => {
      if (dragStart.current == null) return;
      const i = idxFromX(ev.clientX);
      onDrag(
        Math.min(dragStart.current, i),
        Math.max(dragStart.current, i),
      );
    };
    const up = () => {
      dragStart.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const headline = () => {
    if (range.nMonths === 0) return "No months selected.";
    if (ratio >= 1.4) return `Selected period runs ${ratio.toFixed(1)}× the 12-month average.`;
    if (ratio >= 0.8) return "Selected period is in line with the 12-month average.";
    if (ratio === 0) return "Nothing spent at this merchant in the selected window.";
    return `Selected period is ${(1 / ratio).toFixed(1)}× quieter than the 12-month average.`;
  };

  return (
    <div className="biz-trend">
      <div className="biz-trend-head">
        <div>
          <div className="eyebrow">
            Spend at {data.displayName} · last 12 months
          </div>
          <div className="headline">{headline()}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            <span className="accent">{range.label}</span> · drag across the bars
            to change the window
          </div>
        </div>
        <div className="axis-buttons">
          <button type="button" className="on">Spend</button>
          <button type="button">Count</button>
          <button type="button">Avg basket</button>
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <div
          ref={trackRef}
          className="biz-bars"
          onPointerDown={onPointerDown}
        >
          {range.months.map((mo) => {
            const isEdge =
              range.nMonths > 0 &&
              (mo.idx === range.startIdx || mo.idx === range.endIdx);
            const hot = mo.v > avg * 1.5;
            const cls = [
              "biz-bar",
              mo.inRange ? "in" : "",
              hot ? "hot" : "",
              isEdge ? "edge" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const h = Math.max(0, (mo.v / max) * 80);
            return (
              <div key={mo.idx} className={cls}>
                <span className="v">
                  {mo.v >= 1000
                    ? `₹${(mo.v / 1000).toFixed(1)}K`
                    : `₹${mo.v}`}
                </span>
                <div className="b" style={{ height: `${h}%` }} />
                <span className="lab">{mo.m}</span>
              </div>
            );
          })}
        </div>
        {/* 12-month average line */}
        {avg > 0 && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${24 + (1 - avg / max) * 80 * 1.2}px`,
              height: 1,
              borderTop: "1px dashed var(--border-strong)",
              pointerEvents: "none",
            }}
          />
        )}
        {avg > 0 && (
          <span
            style={{
              position: "absolute",
              right: 0,
              top: `${24 + (1 - avg / max) * 80 * 1.2 - 14}px`,
              fontSize: 10.5,
              color: "var(--muted-2)",
              fontVariantNumeric: "tabular-nums",
              padding: "0 2px",
              background: "var(--bg)",
              pointerEvents: "none",
            }}
          >
            12-mo avg · {fmtInr(Math.round(avg))}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Transaction list — adapts shape to window ──────────────────────────── */

function BizTxnList({
  data,
  range,
}: {
  data: MerchantBusinessDetail;
  range: TimelineRange<MerchantBusinessMonth>;
}) {
  const inRange = range.months.filter((m) => m.inRange);
  const sumV = inRange.reduce((s, m) => s + m.v, 0);
  const sumN = inRange.reduce((s, m) => s + m.n, 0);

  // Map "YYYY-MM" → axis idx for O(1) inRange checks on each txn.
  const inRangeYms = useMemo(() => {
    const s = new Set<string>();
    for (const m of inRange) s.add(m.ym);
    return s;
  }, [inRange]);

  const txnsInRange = useMemo(
    () => data.txns.filter((t) => inRangeYms.has(t.txnDate.slice(0, 7))),
    [data.txns, inRangeYms],
  );

  const byDay = useMemo(() => groupByDay(txnsInRange), [txnsInRange]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="biz-txn-head">
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            padding: 2,
            borderRadius: 8,
          }}
        >
          <button
            type="button"
            style={{
              padding: "5px 10px",
              background: "var(--surface-2)",
              color: "var(--fg)",
              border: 0,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "inherit",
            }}
          >
            {range.label}
          </button>
          <button
            type="button"
            style={{
              padding: "5px 10px",
              background: "transparent",
              color: "var(--muted)",
              border: 0,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "inherit",
            }}
          >
            All time · {data.lifetimeCount}
          </button>
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {sumN} transactions · −{fmtInr(sumV, { showZero: true })}
        </span>
      </div>

      {inRange.length === 0 && (
        <div className="md-empty">
          No months in selection.
          <div className="hint">Drag across the bars above.</div>
        </div>
      )}

      {/* Multi-month: collapse each month to a summary row; expand only the
          newest in-range month inline so the freshest txns stay visible. */}
      {inRange.length > 1 && (
        <div style={{ paddingTop: 12 }}>
          {[...inRange].reverse().map((mo, i) => {
            const isNewest = i === 0;
            const monthTxns = data.txns.filter(
              (t) => t.txnDate.slice(0, 7) === mo.ym,
            );
            if (isNewest) {
              const days = groupByDay(monthTxns);
              return (
                <div key={mo.idx}>
                  <div
                    className="biz-day"
                    style={{
                      borderTop: "1px solid var(--border)",
                      paddingTop: 14,
                    }}
                  >
                    <span className="d">
                      {mo.m} ’{mo.y} · expanded
                    </span>
                    <span className="meta">
                      {mo.n} txn · −{fmtInr(mo.v, { showZero: true })}
                    </span>
                  </div>
                  <DayList days={days} />
                </div>
              );
            }
            return (
              <div key={mo.idx} className="biz-month-row">
                <span className="n">
                  {mo.m} ’{mo.y}
                </span>
                <span className="ax">{mo.n} txns</span>
                <span className="ax">
                  avg ₹
                  {mo.n > 0 ? Math.round(mo.v / mo.n).toLocaleString("en-IN") : 0}
                </span>
                <span className="amt">−{fmtInr(mo.v, { showZero: true })}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Single month: expand the day stream directly. */}
      {inRange.length === 1 && <DayList days={byDay} />}

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "20px 0",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
          — end of selection
        </span>
      </div>
    </div>
  );
}

function groupByDay(
  txns: MerchantBusinessTxn[],
): Array<{ date: string; total: number; items: MerchantBusinessTxn[] }> {
  const m = new Map<string, MerchantBusinessTxn[]>();
  for (const t of txns) {
    const arr = m.get(t.txnDate) ?? [];
    arr.push(t);
    m.set(t.txnDate, arr);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({
      date,
      total: items.reduce((s, it) => s + it.amount, 0),
      items,
    }));
}

function DayList({
  days,
}: {
  days: Array<{ date: string; total: number; items: MerchantBusinessTxn[] }>;
}) {
  if (days.length === 0) {
    return <div className="md-empty">No transactions in the selection.</div>;
  }
  return (
    <>
      {days.map((d) => (
        <div key={d.date}>
          <div className="biz-day">
            <span className="d">{fmtDate(d.date)}</span>
            <span className="meta">
              {d.items.length} txn · {fmtInr(d.total)}
            </span>
          </div>
          {d.items.map((it) => (
            <div key={it.id} className="biz-txn">
              <span className="when">{it.txnTime ?? "—"}</span>
              <span className="narr" title={it.rawNarration ?? undefined}>
                {it.narration}
                {it.rawNarration && it.rawNarration !== it.narration && (
                  <span className="small">{it.rawNarration}</span>
                )}
              </span>
              <span className="cat">{it.category ?? "—"}</span>
              <span className="src">{it.account}</span>
              <span className="amt">{fmtInr(it.amount)}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/* ── Right rail — settings + suggested + sibling merchants ─────────────── */

function BizRail({
  data,
  range,
}: {
  data: MerchantBusinessDetail;
  range: TimelineRange<MerchantBusinessMonth>;
}) {
  const inRange = range.months.filter((m) => m.inRange);
  const sumV = inRange.reduce((s, m) => s + m.v, 0);
  const avgV = inRange.length > 0 ? sumV / inRange.length : 0;
  const lifetimeMonths = Math.max(1, monthSpan(data.firstSeen, data.lastSeen));
  const lifetimeAvg = data.lifetimeSum / lifetimeMonths;
  const elevated = avgV > lifetimeAvg * 1.4 && avgV > 0;

  // Scale sibling totals into the selected window — keeps the comparison fair
  // when the user shrinks to 1m / 3m.
  const scale = range.nMonths / 12;

  return (
    <div style={{ paddingTop: 16 }}>
      <div className="rail-card">
        <div className="h">
          <span>Merchant settings</span>
          <span style={{ color: "var(--muted-2)" }}>applies to all {data.lifetimeCount}</span>
        </div>
        <div className="edit-row">
          <span className="l">Display</span>
          <span className="v">{data.displayName}</span>
        </div>
        <div className="edit-row">
          <span className="l">Category</span>
          <span className="v">{data.topCategory ?? "Uncategorized"}</span>
        </div>
        <div className="edit-row">
          <span className="l">Recurring</span>
          <span className="v" style={{ color: "var(--muted-2)" }}>
            {data.lifetimeCount >= 6 ? "Yes · weekly" : "No · single-purchase"}
          </span>
        </div>
        <div className="edit-row">
          <span className="l">Budget</span>
          <span className="v" style={{ color: "var(--muted-2)" }}>
            Not set
          </span>
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "2px 8px", fontSize: 11 }}
          >
            Set
          </button>
        </div>
        <div className="edit-row">
          <span className="l">First seen</span>
          <span className="v">{fmtDate(data.firstSeen)}</span>
        </div>
      </div>

      {elevated ? (
        <div
          className="rail-card"
          style={{
            borderColor: "var(--accent-line)",
            background:
              "linear-gradient(180deg, var(--accent-soft), transparent 70%)",
          }}
        >
          <div className="h" style={{ color: "var(--accent)" }}>
            <span>Suggested · {range.label}</span>
          </div>
          <div
            style={{
              fontSize: 13.5,
              color: "var(--fg)",
              marginBottom: 8,
              lineHeight: 1.4,
            }}
          >
            Set a{" "}
            <b style={{ fontWeight: 500 }}>
              {fmtInr(Math.round((lifetimeAvg * 1.2) / 100) * 100)}/mo budget
            </b>
            ? Selected window averages {fmtInr(Math.round(avgV))}/mo —{" "}
            {(avgV / lifetimeAvg).toFixed(1)}× usual.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn primary">
              Set budget
            </button>
            <button type="button" className="btn ghost">
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <div className="rail-card">
          <div className="h">
            <span>For {range.label}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.4 }}>
            Selected window is within normal range — averaging{" "}
            {fmtInr(Math.round(avgV))}/mo vs lifetime{" "}
            {fmtInr(Math.round(lifetimeAvg))}/mo. No action needed.
          </div>
        </div>
      )}

      {data.siblings.length > 0 && (
        <div className="rail-card">
          <div className="h">
            <span>
              Your other{" "}
              {(data.topCategory?.split(":")[0] ?? "merchants").toLowerCase()}
            </span>
            <span style={{ color: "var(--muted-2)" }}>{range.label}</span>
          </div>
          {data.siblings.map((s) => (
            <Link
              key={s.counterparty}
              href={`/merchants/${encodeURIComponent(s.counterparty)}`}
              className="similar-row"
              style={{ textDecoration: "none" }}
            >
              <div className="similar-avi" style={{ background: "rgba(173, 154, 216, 0.18)", color: "#ad9ad8" }}>
                {s.initials}
              </div>
              <span className="n">{s.displayName}</span>
              <span className="ax">{Math.round(s.count * scale)} txns</span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--debit)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                −{fmtInr(Math.round(s.sum * scale))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Footer ────────────────────────────────────────────────────────────── */

function BizFootbar({
  data,
  range,
}: {
  data: MerchantBusinessDetail;
  range: TimelineRange<MerchantBusinessMonth>;
}) {
  const inRange = range.months.filter((m) => m.inRange);
  const sumN = inRange.reduce((s, m) => s + m.n, 0);
  return (
    <div className="biz-foot">
      <span style={{ fontSize: 12, color: "var(--muted)" }}>
        {sumN} txns · {range.label}
      </span>
      <span style={{ flex: 1 }} />
      <button type="button" className="btn outline">
        Bulk-tag {sumN} as{" "}
        {data.topCategory?.split(":")[1] ?? data.topCategory ?? "—"}
      </button>
      <button type="button" className="btn primary">
        ✓ Mark {sumN} reviewed
      </button>
    </div>
  );
}
