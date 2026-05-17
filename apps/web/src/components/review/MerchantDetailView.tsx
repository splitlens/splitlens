"use client";

/**
 * MerchantDetailView — full-bleed takeover inside InboxModal that answers
 * one ADHD-friendly question for the picked counterparty:
 *
 *   "Have you paid them more, or have they paid you more — and how did
 *    we get here?"
 *
 * Three blocks, in priority order:
 *   1. Scoreboard      — net flow asymmetry, big and unambiguous
 *   2. Balance ribbon  — cumulative net over time, so the user can see
 *                        when the balance tipped
 *   3. Timeline        — chronological list of every txn with this person,
 *                        most recent first, with directional arrows
 *
 * Time-range selector at the top: 1M / 3M / 6M / 1Y / All. All client-side
 * filtering over the lifetime data returned by `getMerchantDetail`.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
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
          aria-label="Back"
          style={{ padding: "4px 8px" }}
        >
          <Ico name="arrow-left" size={14} /> Back
        </button>
        <div
          className="flex items-baseline"
          style={{ gap: 8, flex: 1, minWidth: 0 }}
        >
          <span className="eyebrow muted">With</span>
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
          <SettlementBody
            counterparty={counterparty}
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
// Settlement body — the three story blocks
// ────────────────────────────────────────────────────────────────────────────

type RangeKey = "1m" | "3m" | "6m" | "1y" | "all";

const RANGE_OPTIONS: Array<{ id: RangeKey; label: string; days: number | null }> = [
  { id: "1m", label: "1M", days: 31 },
  { id: "3m", label: "3M", days: 92 },
  { id: "6m", label: "6M", days: 183 },
  { id: "1y", label: "1Y", days: 366 },
  { id: "all", label: "All", days: null },
];

function SettlementBody({
  counterparty,
  detail,
  focusTxnId,
  onSelectId,
}: {
  counterparty: string;
  detail: MerchantDetail;
  focusTxnId: number | null;
  onSelectId: (id: number) => void;
}) {
  const [range, setRange] = useState<RangeKey>("all");

  // Filter txns by the chosen window. Detail.txns are newest-first.
  const filtered = useMemo(
    () => filterByRange(detail.txns, range),
    [detail.txns, range],
  );

  // Sign convention: positive = inflow (they paid me); negative = outflow
  // (I paid them). Net is sum of signed amounts.
  const signed = useMemo(
    () => filtered.map((t) => (t.isCredit ? t.amountInr : -t.amountInr)),
    [filtered],
  );
  const totalIn = useMemo(
    () => filtered.filter((t) => t.isCredit).reduce((s, t) => s + t.amountInr, 0),
    [filtered],
  );
  const totalOut = useMemo(
    () =>
      filtered.filter((t) => !t.isCredit).reduce((s, t) => s + t.amountInr, 0),
    [filtered],
  );
  const inCount = filtered.filter((t) => t.isCredit).length;
  const outCount = filtered.length - inCount;
  const net = totalIn - totalOut;

  // Running balance points for the ribbon — sort asc by date, accumulate.
  const balanceSeries = useMemo(() => {
    const asc = [...filtered].sort((a, b) =>
      a.txnDate < b.txnDate ? -1 : a.txnDate > b.txnDate ? 1 : 0,
    );
    let bal = 0;
    return asc.map((t, idx) => {
      bal += t.isCredit ? t.amountInr : -t.amountInr;
      return {
        idx,
        date: t.txnDate,
        balance: Math.round(bal),
        txnSigned: Math.round(t.isCredit ? t.amountInr : -t.amountInr),
      };
    });
  }, [filtered]);

  return (
    <div className="flex flex-col" style={{ gap: 18 }}>
      <RangeSelector
        range={range}
        onChange={setRange}
        counts={Object.fromEntries(
          RANGE_OPTIONS.map((r) => [
            r.id,
            filterByRange(detail.txns, r.id).length,
          ]),
        )}
      />

      <Scoreboard
        counterparty={counterparty}
        net={net}
        totalIn={totalIn}
        totalOut={totalOut}
        inCount={inCount}
        outCount={outCount}
        txnCount={filtered.length}
      />

      {balanceSeries.length >= 2 && (
        <BalanceRibbon series={balanceSeries} />
      )}

      <TimelineList
        counterparty={counterparty}
        txns={filtered}
        signed={signed}
        focusTxnId={focusTxnId}
        onSelectId={onSelectId}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Range selector
// ────────────────────────────────────────────────────────────────────────────

function RangeSelector({
  range,
  onChange,
  counts,
}: {
  range: RangeKey;
  onChange: (r: RangeKey) => void;
  counts: Record<string, number>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Time range"
      className="flex items-center"
      style={{ gap: 4 }}
    >
      {RANGE_OPTIONS.map((opt) => {
        const active = opt.id === range;
        const n = counts[opt.id] ?? 0;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            disabled={n === 0 && !active}
            className={`btn btn-sm ${active ? "" : "ghost"}`}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              opacity: n === 0 && !active ? 0.4 : 1,
            }}
            title={`${n} transaction${n === 1 ? "" : "s"} in this window`}
          >
            {opt.label}
            <span className="muted" style={{ marginLeft: 6, fontSize: 10 }}>
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Scoreboard — the one-glance answer
// ────────────────────────────────────────────────────────────────────────────

function Scoreboard({
  counterparty,
  net,
  totalIn,
  totalOut,
  inCount,
  outCount,
  txnCount,
}: {
  counterparty: string;
  net: number;
  totalIn: number;
  totalOut: number;
  inCount: number;
  outCount: number;
  txnCount: number;
}) {
  const headline =
    txnCount === 0
      ? { label: "No transactions in this window", tone: "muted" as const }
      : net > 0
      ? {
          label: `${counterparty} has paid you ₹${fmtInr(net)} more`,
          tone: "credit" as const,
        }
      : net < 0
      ? {
          label: `You have paid ${counterparty} ₹${fmtInr(-net)} more`,
          tone: "debit" as const,
        }
      : { label: "You're even", tone: "neutral" as const };

  return (
    <div
      className="surface flex flex-col"
      style={{ padding: 20, gap: 14 }}
    >
      <div className="flex flex-col" style={{ gap: 6 }}>
        <span className="eyebrow muted">Net flow</span>
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color:
              headline.tone === "credit"
                ? "var(--credit)"
                : headline.tone === "debit"
                ? "var(--debit)"
                : "var(--fg)",
          }}
        >
          {headline.label}
        </span>
      </div>

      {txnCount > 0 && (
        <div
          className="flex items-stretch"
          style={{
            gap: 14,
            paddingTop: 6,
            borderTop: "1px solid var(--border)",
          }}
        >
          <FlowSide
            label="You paid"
            counterparty={counterparty}
            amount={totalOut}
            count={outCount}
            direction="out"
          />
          <div
            aria-hidden
            style={{
              width: 1,
              background: "var(--border)",
              alignSelf: "stretch",
            }}
          />
          <FlowSide
            label="Paid you"
            counterparty={counterparty}
            amount={totalIn}
            count={inCount}
            direction="in"
          />
        </div>
      )}
    </div>
  );
}

function FlowSide({
  label,
  counterparty,
  amount,
  count,
  direction,
}: {
  label: string;
  counterparty: string;
  amount: number;
  count: number;
  direction: "in" | "out";
}) {
  return (
    <div className="flex flex-col" style={{ flex: 1, gap: 4, minWidth: 0 }}>
      <div className="small muted flex items-center" style={{ gap: 6 }}>
        <Ico name={direction === "out" ? "arrow-right" : "arrow-left"} size={11} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label} {direction === "out" ? "→" : "←"} {counterparty}
        </span>
      </div>
      <span
        className={`num-amount ${direction === "out" ? "debit" : "credit"}`}
        style={{ fontSize: 18, fontWeight: 600 }}
      >
        {direction === "out" ? "−" : "+"}₹{fmtInr(amount)}
      </span>
      <span className="small muted">
        {count} txn{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Balance ribbon — running net over time
// ────────────────────────────────────────────────────────────────────────────

interface BalancePoint {
  idx: number;
  date: string;
  balance: number;
  txnSigned: number;
}

function BalanceRibbon({ series }: { series: BalancePoint[] }) {
  const maxAbs = Math.max(
    1,
    ...series.map((p) => Math.abs(p.balance)),
  );
  const creditColor = readCssVar("--credit", "#3fbf7f");
  const debitColor = readCssVar("--debit", "#e15c5c");

  return (
    <section
      className="surface flex flex-col"
      style={{ padding: 16, gap: 6 }}
    >
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span className="eyebrow muted">Running balance over time</span>
        <span className="small muted">
          Above zero — they&apos;ve paid more · Below zero — you&apos;ve paid more
        </span>
      </div>
      <ChartFrame height={172}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={series}
            margin={{ top: 6, right: 8, left: 0, bottom: 6 }}
          >
            <defs>
              <linearGradient id="balPos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={creditColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={creditColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="balNeg" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={debitColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={debitColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => fmtBalanceTick(d)}
              minTickGap={32}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              domain={[-maxAbs, maxAbs]}
              tickFormatter={(v: number) =>
                v === 0 ? "0" : `${v > 0 ? "+" : "−"}₹${fmtInrShort(Math.abs(v))}`
              }
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={62}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={<BalanceTooltip />}
            />
            <ReferenceLine y={0} stroke="var(--fg)" strokeOpacity={0.4} />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={creditColor}
              strokeWidth={1.5}
              fill="url(#balPos)"
              isAnimationActive={false}
              activeDot={{ r: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </section>
  );
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: BalancePoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const balLabel =
    p.balance === 0
      ? "Even"
      : p.balance > 0
      ? `They ahead by ₹${fmtInr(p.balance)}`
      : `You ahead by ₹${fmtInr(-p.balance)}`;
  return (
    <div
      className="surface"
      style={{ padding: "6px 9px", fontSize: 11.5, lineHeight: 1.45 }}
    >
      <div className="muted">{fmtBalanceTick(p.date)}</div>
      <div>{balLabel}</div>
      <div className={p.txnSigned >= 0 ? "credit" : "debit"}>
        {p.txnSigned >= 0 ? "+" : "−"}₹{fmtInr(Math.abs(p.txnSigned))} this txn
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Timeline list — chronological story
// ────────────────────────────────────────────────────────────────────────────

function TimelineList({
  counterparty,
  txns,
  signed,
  focusTxnId,
  onSelectId,
}: {
  counterparty: string;
  txns: MerchantDetailTxn[];
  signed: number[];
  focusTxnId: number | null;
  onSelectId: (id: number) => void;
}) {
  if (txns.length === 0) {
    return (
      <div className="surface-dashed flex items-center justify-center" style={{ padding: 28 }}>
        <span className="small muted">No transactions in this window.</span>
      </div>
    );
  }

  return (
    <section className="flex flex-col" style={{ gap: 6 }}>
      <div className="eyebrow muted">Timeline · most recent first</div>
      <ul
        className="flex flex-col"
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {txns.map((t, i) => (
          <TimelineRow
            key={t.id}
            txn={t}
            counterparty={counterparty}
            isLast={i === txns.length - 1}
            isFocused={t.id === focusTxnId}
            onSelect={() => onSelectId(t.id)}
            runningBalanceAtThisPoint={signed
              .slice(i)
              .reduce((s, v) => s + v, 0)}
          />
        ))}
      </ul>
    </section>
  );
}

function TimelineRow({
  txn,
  counterparty,
  isLast,
  isFocused,
  onSelect,
  runningBalanceAtThisPoint,
}: {
  txn: MerchantDetailTxn;
  counterparty: string;
  isLast: boolean;
  isFocused: boolean;
  onSelect: () => void;
  runningBalanceAtThisPoint: number;
}) {
  const cat = getCategory(txn.category);
  const directionLabel = txn.isCredit
    ? `${counterparty} → You`
    : `You → ${counterparty}`;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center"
        style={{
          width: "100%",
          gap: 12,
          padding: "10px 14px",
          background: isFocused ? "var(--accent-soft)" : "var(--bg)",
          border: "none",
          borderBottom: isLast ? "none" : "1px solid var(--border)",
          cursor: "pointer",
          textAlign: "left",
        }}
        title={
          runningBalanceAtThisPoint === 0
            ? "Even after this txn"
            : runningBalanceAtThisPoint > 0
            ? `After this: they ahead by ₹${fmtInr(runningBalanceAtThisPoint)}`
            : `After this: you ahead by ₹${fmtInr(-runningBalanceAtThisPoint)}`
        }
      >
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: txn.isCredit ? "var(--credit-soft, rgba(63,191,127,0.16))" : "var(--debit-soft, rgba(225,92,92,0.14))",
            color: txn.isCredit ? "var(--credit)" : "var(--debit)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Ico name={txn.isCredit ? "arrow-left" : "arrow-right"} size={12} />
        </span>
        <span
          className="mono tabular muted"
          style={{ fontSize: 11.5, width: 86, flexShrink: 0 }}
        >
          {fmtRowDate(txn.txnDate)}
          {txn.txnTime ? ` · ${txn.txnTime}` : ""}
        </span>
        <span
          className="flex flex-col"
          style={{ flex: 1, minWidth: 0, gap: 2 }}
        >
          <span
            style={{
              fontSize: 13,
              color: "var(--fg)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {directionLabel}
          </span>
          {txn.narration && (
            <span
              className="small muted"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={txn.narration}
            >
              {txn.narration}
            </span>
          )}
        </span>
        <span
          className="chip chip-sm"
          style={{
            fontSize: 11,
            minWidth: 0,
            maxWidth: 160,
            justifyContent: "flex-start",
          }}
        >
          <span aria-hidden>{cat.emoji}</span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {txn.category ?? "Uncategorized"}
          </span>
        </span>
        <span
          className={`num-amount ${txn.isCredit ? "credit" : "debit"}`}
          style={{ fontSize: 14, fontWeight: 500, minWidth: 96, textAlign: "right" }}
        >
          {txn.isCredit ? "+" : "−"}₹{fmtInr(txn.amountInr)}
        </span>
      </button>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function filterByRange(
  txns: MerchantDetailTxn[],
  range: RangeKey,
): MerchantDetailTxn[] {
  const opt = RANGE_OPTIONS.find((r) => r.id === range);
  if (!opt || opt.days == null) return txns;
  if (txns.length === 0) return txns;
  // Anchor the window to the most-recent txn in the dataset, not "now" —
  // it's more useful for review (e.g. data ends in May but you're looking
  // in November). Date math in UTC to stay TZ-stable.
  const newest = txns
    .map((t) => parseIsoDate(t.txnDate))
    .reduce<Date | null>((a, b) => (a && (!b || a > b) ? a : b ?? a), null);
  if (!newest) return txns;
  const cutoff = new Date(newest.getTime() - opt.days * 86_400_000);
  return txns.filter((t) => {
    const d = parseIsoDate(t.txnDate);
    return d ? d >= cutoff : false;
  });
}

function parseIsoDate(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtRowDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

function fmtBalanceTick(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(-2)}`;
}

function fmtInrShort(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}

// ────────────────────────────────────────────────────────────────────────────
// Loading
// ────────────────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col" style={{ gap: 18 }}>
      <div className="flex" style={{ gap: 4 }}>
        {RANGE_OPTIONS.map((r) => (
          <div
            key={r.id}
            className="skeleton"
            style={{ height: 26, width: 48, borderRadius: 8 }}
          />
        ))}
      </div>
      <div className="skeleton" style={{ height: 132, borderRadius: 10 }} />
      <div className="skeleton" style={{ height: 180, borderRadius: 10 }} />
      <div className="skeleton" style={{ height: 240, borderRadius: 8 }} />
    </div>
  );
}
