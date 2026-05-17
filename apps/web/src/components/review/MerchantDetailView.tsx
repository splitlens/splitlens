"use client";

/**
 * MerchantDetailView — full-bleed takeover inside InboxModal that shows
 * every transaction with the current counterparty, plus insights.
 *
 * Opens when the user clicks the MerchantHistoryCard in the right rail. The
 * back arrow returns to the txn view; clicking a row in the list jumps to
 * that txn (which also returns us to txn mode).
 *
 * Data is fetched lazily — we don't ship 500 rows into the inbox payload
 * by default, since most users never click in.
 *
 * Layout:
 *   1. Header strip (back · merchant name · close)
 *   2. KPI strip (total, avg, first/last, biggest)
 *   3. Monthly spend bar chart (recharts, zero-filled)
 *   4. "When you visit" — DOW always, hour-of-day when CC time data exists
 *   5. Full txn list (scrollable, clickable rows)
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Ico } from "@/components/Ico";
import { ChartFrame } from "@/components/dashboard/ChartFrame";
import { fmtInr } from "@/lib/format";
import {
  getMerchantDetail,
  type MerchantDetail,
  type MerchantDetailTxn,
} from "@/app/review/actions";
import { getCategory } from "@/lib/taxonomy";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; data: MerchantDetail }
  | { kind: "error"; message: string };

export function MerchantDetailView({
  counterparty,
  focusTxnId,
  onBack,
  onClose,
  onSelectId,
}: {
  counterparty: string;
  /** Highlight this row in the list (the txn the user came from). */
  focusTxnId: number | null;
  onBack: () => void;
  onClose: () => void;
  /** Jump the inbox to a specific txn (and return to txn view). */
  onSelectId: (id: number) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const data = await getMerchantDetail(counterparty);
        if (cancelled) return;
        if (!data) {
          setState({ kind: "error", message: "No transactions found." });
          return;
        }
        setState({ kind: "loaded", data });
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not load merchant.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [counterparty]);

  // Esc routing is owned by InboxModal — see its keydown handler. When
  // we're in merchant mode it calls onBack; otherwise it closes the modal.

  return (
    <div
      className="flex flex-col"
      style={{ height: "100%", overflow: "hidden", minHeight: 0 }}
    >
      {/* Header */}
      <div
        className="flex items-center"
        style={{
          gap: 12,
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          flex: "0 0 auto",
        }}
      >
        <button
          type="button"
          className="btn btn-sm ghost"
          onClick={onBack}
          aria-label="Back to transaction"
          style={{ padding: "4px 8px" }}
        >
          <Ico name="arrow-left" size={14} /> Back
        </button>
        <div className="flex items-baseline" style={{ gap: 8, flex: 1, minWidth: 0 }}>
          <span className="eyebrow muted">Merchant</span>
          <span
            className="h2"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {counterparty}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-sm ghost"
          onClick={onClose}
          aria-label="Close"
          style={{ padding: "4px 8px" }}
        >
          <Ico name="x" size={14} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: "1 1 auto",
          overflow: "auto",
          padding: "18px 20px 24px",
          minHeight: 0,
        }}
      >
        {state.kind === "loading" && <LoadingSkeleton />}
        {state.kind === "error" && (
          <div className="surface" style={{ padding: 14 }}>
            <span className="small muted">{state.message}</span>
          </div>
        )}
        {state.kind === "loaded" && (
          <MerchantDetailBody
            detail={state.data}
            focusTxnId={focusTxnId}
            onSelectId={onSelectId}
          />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Drill-in filter applied across the body. Each dimension is independent;
 * a filter on multiple dimensions is interpreted as AND. Click a bar to
 * set; click the same bar again (or the chip ×) to clear that dimension.
 */
interface MerchantFilter {
  yearMonth: string | null;
  dow: number | null;
  hour: number | null;
}

const EMPTY_FILTER: MerchantFilter = {
  yearMonth: null,
  dow: null,
  hour: null,
};

function isFilterEmpty(f: MerchantFilter): boolean {
  return f.yearMonth == null && f.dow == null && f.hour == null;
}

function MerchantDetailBody({
  detail,
  focusTxnId,
  onSelectId,
}: {
  detail: MerchantDetail;
  focusTxnId: number | null;
  onSelectId: (id: number) => void;
}) {
  const [filter, setFilter] = useState<MerchantFilter>(EMPTY_FILTER);

  // Toggle semantics — clicking an already-active bar clears that
  // dimension. Keeps "click to drill, click to undo" as a single gesture.
  const toggleMonth = (ym: string) =>
    setFilter((f) => ({ ...f, yearMonth: f.yearMonth === ym ? null : ym }));
  const toggleDow = (d: number) =>
    setFilter((f) => ({ ...f, dow: f.dow === d ? null : d }));
  const toggleHour = (h: number) =>
    setFilter((f) => ({ ...f, hour: f.hour === h ? null : h }));
  const clearDim = (dim: keyof MerchantFilter) =>
    setFilter((f) => ({ ...f, [dim]: null }));
  // Always-set (not toggle) variant — used by KPI tiles that should land
  // the user in a specific month regardless of current filter state.
  const setMonth = (ym: string) =>
    setFilter((f) => ({ ...f, yearMonth: ym }));

  const filteredTxns = useMemo(
    () => applyFilter(detail.txns, filter),
    [detail.txns, filter],
  );

  return (
    <div className="flex flex-col" style={{ gap: 18 }}>
      <KpiStrip detail={detail} onSelectMonth={setMonth} />
      <MonthlySpendChart
        detail={detail}
        activeMonth={filter.yearMonth}
        onSelectMonth={toggleMonth}
      />
      <WhenYouVisit
        detail={detail}
        activeDow={filter.dow}
        activeHour={filter.hour}
        onSelectDow={toggleDow}
        onSelectHour={toggleHour}
      />
      <TxnList
        txns={filteredTxns}
        totalCount={detail.txns.length}
        truncated={detail.truncated}
        focusTxnId={focusTxnId}
        onSelectId={onSelectId}
        filter={filter}
        onClearDim={clearDim}
        onClearAll={() => setFilter(EMPTY_FILTER)}
      />
    </div>
  );
}

function applyFilter(
  txns: MerchantDetailTxn[],
  f: MerchantFilter,
): MerchantDetailTxn[] {
  if (isFilterEmpty(f)) return txns;
  return txns.filter((t) => {
    if (f.yearMonth != null && t.txnDate.slice(0, 7) !== f.yearMonth) return false;
    if (f.dow != null && dowOfIso(t.txnDate) !== f.dow) return false;
    if (f.hour != null) {
      const h = t.txnTime ? hourOfHHMM(t.txnTime) : null;
      if (h !== f.hour) return false;
    }
    return true;
  });
}

function dowOfIso(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  if (Number.isNaN(ms)) return null;
  return new Date(ms).getUTCDay();
}

function hourOfHHMM(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return h;
}

// ────────────────────────────────────────────────────────────────────────────
// KPI strip — five stat tiles. Picked to answer the questions a user asks
// when staring at a merchant: how much in total, how much per visit, how
// long has this been going, and what was the worst single hit.
//
// "Largest charge" is intentionally explicit — without the qualifier, it
// reads like "the biggest bar in the chart," which is the monthly TOTAL,
// not the single-txn max. The tile is also clickable: it filters the txn
// list below to the month containing that biggest charge so the user can
// scan to find the actual row and verify it.

function KpiStrip({
  detail,
  onSelectMonth,
}: {
  detail: MerchantDetail;
  onSelectMonth: (yearMonth: string) => void;
}) {
  const biggestYearMonth = detail.biggestDate.slice(0, 7);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 10,
      }}
    >
      <KpiTile label="Total spent" value={fmtInr(detail.totalSpentInr)} emphasis />
      <KpiTile
        label="Avg / charge"
        value={fmtInr(detail.avgInr)}
        sub={`median ${fmtInr(detail.medianInr)}`}
      />
      <KpiTile
        label="Charges"
        value={String(detail.count)}
        sub={detail.truncated ? "showing latest 500" : null}
      />
      <KpiTile
        label="Active"
        value={formatYearMonth(detail.firstSeen)}
        sub={`→ ${formatYearMonth(detail.lastSeen)}`}
      />
      <KpiTile
        label="Largest charge"
        value={fmtInr(detail.biggestInr)}
        sub={`single txn · ${formatYearMonth(detail.biggestDate)}`}
        onClick={() => onSelectMonth(biggestYearMonth)}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  emphasis = false,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string | null;
  emphasis?: boolean;
  /** When set, the tile becomes a clickable button (e.g. filter the list). */
  onClick?: () => void;
}) {
  const baseStyle: CSSProperties = {
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };
  const content = (
    <>
      <span className="eyebrow muted">{label}</span>
      <span
        className="num-amount"
        style={{
          fontSize: emphasis ? 22 : 18,
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      {sub && <span className="tiny muted">{sub}</span>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="surface"
        title="Click to see this month in the list"
        style={{
          ...baseStyle,
          textAlign: "left",
          cursor: "pointer",
          color: "inherit",
          font: "inherit",
          alignItems: "flex-start",
        }}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="surface" style={baseStyle}>
      {content}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Monthly spend — recharts BarChart. Empty months are zero-filled in the
// repo so the x-axis is continuous, not just "months where you spent."

function MonthlySpendChart({
  detail,
  activeMonth,
  onSelectMonth,
}: {
  detail: MerchantDetail;
  activeMonth: string | null;
  onSelectMonth: (yearMonth: string) => void;
}) {
  if (detail.monthly.length === 0) return null;

  const accent = readCssVar("--accent", "#b8732d");
  const muted = readCssVar("--muted-2", "#888");
  const border = readCssVar("--border", "rgba(120,120,120,0.2)");

  const data = detail.monthly.map((m) => ({
    yearMonth: m.yearMonth,
    label: formatYearMonthShort(m.yearMonth),
    out: m.totalInr,
    txns: m.count,
  }));

  const hasActive = activeMonth != null;
  const opacityFor = (d: (typeof data)[number]): number => {
    if (d.txns === 0) return 0.15;
    if (!hasActive) return 0.9;
    return d.yearMonth === activeMonth ? 1 : 0.25;
  };

  return (
    <div className="surface" style={{ padding: 14 }}>
      <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
        <span className="eyebrow">Monthly spend</span>
        <span className="tiny muted">
          {detail.monthly.length} month{detail.monthly.length === 1 ? "" : "s"}
          {" · click a bar to filter"}
        </span>
      </div>
      <ChartFrame height={180}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={border} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: muted }}
              tickLine={false}
              axisLine={{ stroke: border }}
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: muted }}
              tickFormatter={(v) => fmtInr(v as number)}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)", opacity: 0.5 }}
              wrapperStyle={{ outline: "none" }}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--surface)",
                color: "var(--fg)",
                fontSize: 12,
                padding: "8px 12px",
              }}
              labelStyle={{ color: "var(--fg-2)" }}
              itemStyle={{ color: "var(--fg)" }}
              formatter={(_v, _n, item) => {
                const p = (item as { payload?: { out: number; txns: number } })
                  ?.payload;
                if (!p) return ["—", "Spend"];
                return [`${fmtInr(p.out)} (${p.txns})`, "Spend"];
              }}
            />
            <Bar
              dataKey="out"
              radius={[3, 3, 0, 0]}
              onClick={(payload: unknown) => {
                // recharts passes the row payload through; only navigate on
                // months with actual charges (zero-fill bars are display-only).
                const p = payload as { yearMonth?: string; txns?: number } | null;
                if (p?.yearMonth && (p.txns ?? 0) > 0) {
                  onSelectMonth(p.yearMonth);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              {data.map((d) => (
                <Cell
                  key={d.yearMonth}
                  fill={accent}
                  fillOpacity={opacityFor(d)}
                  // Force the per-month cursor — empty months shouldn't
                  // look interactive, since their click is a no-op.
                  cursor={d.txns > 0 ? "pointer" : "default"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// "When you visit" — two inline bar lanes. Custom-drawn so we can fit both
// side by side in a tight grid without dragging in another recharts setup.

function WhenYouVisit({
  detail,
  activeDow,
  activeHour,
  onSelectDow,
  onSelectHour,
}: {
  detail: MerchantDetail;
  activeDow: number | null;
  activeHour: number | null;
  onSelectDow: (dow: number) => void;
  onSelectHour: (hour: number) => void;
}) {
  const hasHour = detail.hour.length > 0;
  const dowMaxCount = Math.max(...detail.dow.map((d) => d.count), 1);
  const hourMaxCount = hasHour
    ? Math.max(...detail.hour.map((h) => h.count), 1)
    : 1;

  return (
    <div
      className="surface"
      style={{
        padding: 14,
        display: "grid",
        gridTemplateColumns: hasHour ? "1fr 1fr" : "1fr",
        gap: 18,
      }}
    >
      <div className="flex flex-col" style={{ gap: 8 }}>
        <div
          className="flex items-baseline justify-between"
          style={{ gap: 8 }}
        >
          <span className="eyebrow">Day of week</span>
          <span className="tiny muted">click to filter</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 4,
            alignItems: "end",
            height: 80,
          }}
        >
          {detail.dow.map((d) => (
            <BarColumn
              key={d.dow}
              ratio={d.count / dowMaxCount}
              label={DOW_LABELS[d.dow] ?? String(d.dow)}
              value={String(d.count)}
              active={activeDow === d.dow}
              dimmed={activeDow != null && activeDow !== d.dow}
              onClick={d.count > 0 ? () => onSelectDow(d.dow) : undefined}
            />
          ))}
        </div>
      </div>

      {hasHour && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <div
            className="flex items-baseline justify-between"
            style={{ gap: 8 }}
          >
            <span className="eyebrow">Hour of day</span>
            <span className="tiny muted">click to filter</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(24, 1fr)",
              gap: 2,
              alignItems: "end",
              height: 80,
            }}
          >
            {detail.hour.map((h) => (
              <BarColumn
                key={h.hour}
                ratio={h.count / hourMaxCount}
                label={h.hour % 6 === 0 ? String(h.hour) : ""}
                value={String(h.count)}
                compact
                active={activeHour === h.hour}
                dimmed={activeHour != null && activeHour !== h.hour}
                onClick={h.count > 0 ? () => onSelectHour(h.hour) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BarColumn({
  ratio,
  label,
  value,
  compact = false,
  active = false,
  dimmed = false,
  onClick,
}: {
  ratio: number;
  label: string;
  value: string;
  compact?: boolean;
  active?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  // Minimum 2px so empty buckets still register visually.
  const heightPct = Math.max(ratio * 100, ratio > 0 ? 4 : 2);
  const baseOpacity = ratio > 0 ? 0.9 : 0.4;
  const opacity = active ? 1 : dimmed ? 0.25 : baseOpacity;
  const clickable = onClick != null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className="flex flex-col"
      title={`${label || ""}: ${value}`}
      style={{
        alignItems: "center",
        gap: 4,
        height: "100%",
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: clickable ? "pointer" : "default",
        color: "inherit",
        font: "inherit",
      }}
    >
      <div
        style={{
          flex: 1,
          width: "100%",
          display: "flex",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            width: "100%",
            height: `${heightPct}%`,
            background: ratio > 0 ? "var(--accent)" : "var(--border)",
            borderRadius: 2,
            opacity,
            outline: active ? "1px solid var(--accent)" : "none",
            outlineOffset: 1,
            transition: "opacity 0.12s ease",
          }}
        />
      </div>
      {!compact && (
        <span className="tiny muted" style={{ fontSize: 10 }}>
          {label}
        </span>
      )}
      {compact && label && (
        <span className="tiny muted" style={{ fontSize: 9 }}>
          {label}
        </span>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Full txn list. Each row links to the inbox view of that txn.

function TxnList({
  txns,
  totalCount,
  truncated,
  focusTxnId,
  onSelectId,
  filter,
  onClearDim,
  onClearAll,
}: {
  txns: MerchantDetailTxn[];
  /** Pre-filter count, for the "M of N" subhead. */
  totalCount: number;
  truncated: boolean;
  focusTxnId: number | null;
  onSelectId: (id: number) => void;
  filter: MerchantFilter;
  onClearDim: (dim: keyof MerchantFilter) => void;
  onClearAll: () => void;
}) {
  const filterActive = !isFilterEmpty(filter);
  return (
    <div className="surface" style={{ padding: 14 }}>
      <div
        className="flex items-baseline justify-between"
        style={{ gap: 8, marginBottom: 10 }}
      >
        <span className="eyebrow">
          {filterActive ? "Filtered charges" : "All charges"}
        </span>
        <span className="tiny muted">
          {filterActive ? `${txns.length} of ${totalCount}` : `${txns.length}`}
          {truncated && " (latest 500)"}
        </span>
      </div>
      {filterActive && (
        <FilterChips
          filter={filter}
          onClearDim={onClearDim}
          onClearAll={onClearAll}
        />
      )}
      {txns.length === 0 ? (
        <div
          className="flex items-center justify-center"
          style={{
            padding: "24px 8px",
            color: "var(--fg-muted)",
            fontSize: 13,
          }}
        >
          No charges match this filter.
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 2 }}>
          {txns.map((t) => (
            <TxnRow
              key={t.id}
              txn={t}
              isFocus={t.id === focusTxnId}
              onClick={() => onSelectId(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Shows the active dimensions of the merchant filter as removable chips,
 * with a "clear all" affordance when more than one dimension is set.
 * Hidden entirely when the filter is empty (handled by caller).
 */
function FilterChips({
  filter,
  onClearDim,
  onClearAll,
}: {
  filter: MerchantFilter;
  onClearDim: (dim: keyof MerchantFilter) => void;
  onClearAll: () => void;
}) {
  const dims: Array<{ key: keyof MerchantFilter; label: string }> = [];
  if (filter.yearMonth) {
    dims.push({
      key: "yearMonth",
      label: formatYearMonth(`${filter.yearMonth}-01`),
    });
  }
  if (filter.dow != null) {
    dims.push({
      key: "dow",
      label: DOW_LABELS[filter.dow] ?? `Day ${filter.dow}`,
    });
  }
  if (filter.hour != null) {
    dims.push({
      key: "hour",
      label: `${String(filter.hour).padStart(2, "0")}:00`,
    });
  }
  if (dims.length === 0) return null;

  return (
    <div
      className="flex items-center"
      style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}
    >
      <span className="tiny muted">Showing:</span>
      {dims.map((d) => (
        <button
          key={d.key}
          type="button"
          onClick={() => onClearDim(d.key)}
          className="flex items-center"
          aria-label={`Clear ${d.label} filter`}
          style={{
            gap: 4,
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-line)",
            color: "var(--fg)",
            font: "inherit",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {d.label}
          <Ico name="x" size={10} />
        </button>
      ))}
      {dims.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="tiny"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--fg-muted)",
            cursor: "pointer",
            padding: "2px 4px",
            textDecoration: "underline",
          }}
        >
          clear all
        </button>
      )}
    </div>
  );
}

function TxnRow({
  txn,
  isFocus,
  onClick,
}: {
  txn: MerchantDetailTxn;
  isFocus: boolean;
  onClick: () => void;
}) {
  const cat = txn.category ? getCategory(txn.category) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center"
      style={{
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        background: isFocus ? "var(--accent-soft)" : "transparent",
        border: isFocus
          ? "1px solid var(--accent-line)"
          : "1px solid transparent",
        textAlign: "left",
        cursor: "pointer",
        color: "inherit",
        font: "inherit",
        width: "100%",
      }}
      onMouseEnter={(e) => {
        if (!isFocus) {
          (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isFocus) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }
      }}
    >
      <span
        className="mono small muted"
        style={{ minWidth: 84, flex: "0 0 auto" }}
      >
        {txn.txnDate}
      </span>
      <span
        className="mono tiny muted"
        style={{ minWidth: 44, flex: "0 0 auto" }}
      >
        {txn.txnTime ?? "—"}
      </span>
      <span
        className="num-amount"
        style={{
          minWidth: 80,
          flex: "0 0 auto",
          fontSize: 13,
          color: txn.isCredit ? "var(--credit)" : "var(--fg)",
        }}
      >
        {txn.isCredit ? "+" : "−"}
        {fmtInr(txn.amountInr)}
      </span>
      <span
        className="small"
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: cat ? "var(--fg)" : "var(--fg-muted)",
        }}
      >
        {cat?.label ?? "Uncategorized"}
      </span>
      <span className="tiny muted" style={{ flex: "0 0 auto" }}>
        {txn.accountBank} · {txn.accountLast4}
      </span>
      {isFocus && (
        <span
          className="tiny"
          style={{ flex: "0 0 auto", color: "var(--accent)" }}
        >
          this one
        </span>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {[180, 200, 280].map((h, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: h,
            width: "100%",
            background: "var(--surface-2)",
            borderRadius: 8,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

function formatYearMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  return `${MONTHS[m - 1]} '${String(y).slice(-2)}`;
}

function formatYearMonthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ${String(y).slice(-2)}`;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}
