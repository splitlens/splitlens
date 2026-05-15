"use client";

/**
 * Monthly spending report. Two views:
 *   1. Stacked bar — each month's spend split by category group
 *   2. Compact KPI strip — total / avg / month-over-month delta
 *
 * Designed to answer "where did the money go this month vs last month" at a
 * glance, with the bar chart letting you spot category-level drift.
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { MonthlyBucket, CategoryByMonth } from "@/lib/repo";
import { fmtInr } from "@/lib/format";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center text-[color:var(--color-muted)]">
      Loading chart…
    </div>
  ),
});

/** Same palette as SpendSunburst — kept duplicated to avoid a circular import. */
const GROUP_HEX: Record<string, string> = {
  Income: "#10b981",
  Investment: "#3b82f6",
  Bills: "#f97316",
  Household: "#f43f5e",
  Subscription: "#a855f7",
  Food: "#f59e0b",
  Personal: "#ec4899",
  Transport: "#14b8a6",
  Shopping: "#d946ef",
  Health: "#ef4444",
  Travel: "#0ea5e9",
  Cash: "#71717a",
  Charges: "#64748b",
  Transfer: "#8b5cf6",
  Uncategorized: "#525252",
};

/** Pretty-print a YYYY-MM key as "Mar 2026". */
function monthLabel(m: string): string {
  const [yyyy, mm] = m.split("-");
  if (!yyyy || !mm) return m;
  const date = new Date(Number(yyyy), Number(mm) - 1, 1);
  return date.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

interface SeriesTooltipParam {
  seriesName: string;
  value: number;
  color: string;
}

export function MonthlyReport({
  buckets,
  byGroup,
}: {
  buckets: MonthlyBucket[];
  byGroup: CategoryByMonth[];
}) {
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);

  /** Pivot {month, group, totalOut}[] into ECharts series — one series per group. */
  const { months, series, allGroups } = useMemo(() => {
    const monthSet = new Set(buckets.map((b) => b.month));
    const months = Array.from(monthSet).sort();

    const groupTotals = new Map<string, number>();
    for (const r of byGroup) {
      groupTotals.set(r.group, (groupTotals.get(r.group) ?? 0) + r.totalOut);
    }
    // Order groups by total spend desc — biggest groups stack at the bottom.
    const allGroups = Array.from(groupTotals.keys()).sort(
      (a, b) => (groupTotals.get(b) ?? 0) - (groupTotals.get(a) ?? 0),
    );

    // Build a (month → group → total) lookup for fast pivot
    const byMonth = new Map<string, Map<string, number>>();
    for (const r of byGroup) {
      let bucket = byMonth.get(r.month);
      if (!bucket) {
        bucket = new Map();
        byMonth.set(r.month, bucket);
      }
      bucket.set(r.group, (bucket.get(r.group) ?? 0) + r.totalOut);
    }

    const series = allGroups.map((g) => ({
      name: g,
      type: "bar" as const,
      stack: "spend",
      data: months.map((m) => byMonth.get(m)?.get(g) ?? 0),
      itemStyle: { color: GROUP_HEX[g] ?? "#8b5cf6" },
      emphasis: { focus: "series" as const },
    }));

    return { months, series, allGroups };
  }, [buckets, byGroup]);

  const stats = useMemo(() => {
    if (buckets.length === 0) return null;
    const totalSpend = buckets.reduce((s, b) => s + b.totalOut, 0);
    const totalIn = buckets.reduce((s, b) => s + b.totalIn, 0);
    const avgMonthlySpend = totalSpend / buckets.length;
    const last = buckets[buckets.length - 1]!;
    const prev = buckets.length >= 2 ? buckets[buckets.length - 2]! : null;
    const momDelta = prev && prev.totalOut > 0 ? (last.totalOut - prev.totalOut) / prev.totalOut : null;
    return {
      totalSpend,
      totalIn,
      avgMonthlySpend,
      lastMonth: last,
      prevMonth: prev,
      momDelta,
    };
  }, [buckets]);

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 60, right: 20, top: 60, bottom: 50 },
      legend: {
        type: "scroll" as const,
        top: 10,
        textStyle: { color: "#a1a1aa", fontSize: 11 },
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 12,
        pageTextStyle: { color: "#a1a1aa" },
        pageIconColor: "#a1a1aa",
      },
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        backgroundColor: "rgba(15,15,20,0.95)",
        borderColor: "rgba(255,255,255,0.15)",
        textStyle: { color: "#e4e4e7" },
        formatter: (params: SeriesTooltipParam[] | SeriesTooltipParam) => {
          const arr = Array.isArray(params) ? params : [params];
          if (arr.length === 0) return "";
          // Skip empty series so the tooltip stays scannable
          const nonZero = arr.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
          const total = nonZero.reduce((s, p) => s + p.value, 0);
          const monthName =
            "axisValue" in arr[0]! ? (arr[0] as unknown as { axisValue: string }).axisValue : "";
          const rows = nonZero
            .map(
              (p) =>
                `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">
                  <span><span style="display:inline-block;width:8px;height:8px;background:${p.color};border-radius:2px;margin-right:6px"></span>${p.seriesName}</span>
                  <span style="font-weight:600">${fmtInr(p.value)}</span>
                </div>`,
            )
            .join("");
          return `<div style="line-height:1.6">
            <div style="font-weight:600;margin-bottom:6px">${monthName}</div>
            ${rows}
            <div style="border-top:1px solid rgba(255,255,255,0.15);margin-top:6px;padding-top:6px;font-weight:600;display:flex;justify-content:space-between;gap:12px">
              <span>Total</span><span>${fmtInr(total)}</span>
            </div>
          </div>`;
        },
      },
      xAxis: {
        type: "category" as const,
        data: months.map(monthLabel),
        axisLabel: { color: "#a1a1aa", fontSize: 11 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: {
          color: "#a1a1aa",
          fontSize: 11,
          formatter: (v: number) =>
            v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`,
        },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      series,
    }),
    [series, months],
  );

  const onEvents = useMemo(
    () => ({
      mouseover: (e: { name?: string }) => {
        if (e.name) setHoveredMonth(e.name);
      },
      mouseout: () => setHoveredMonth(null),
    }),
    [],
  );

  if (buckets.length === 0 || !stats) return null;

  // Highlight the hovered (or latest) month in the strip below
  const focusedMonthIdx = hoveredMonth
    ? months.findIndex((m) => monthLabel(m) === hoveredMonth)
    : months.length - 1;
  const focusedMonth = focusedMonthIdx >= 0 ? buckets[focusedMonthIdx] : stats.lastMonth;
  const safeFocused = focusedMonth ?? stats.lastMonth;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Monthly report</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          {buckets.length} months · {allGroups.length} categories · stacked
        </p>
      </div>

      {/* KPI strip */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi
          label={hoveredMonth ?? monthLabel(safeFocused.month)}
          value={fmtInr(safeFocused.totalOut)}
          sub={`${safeFocused.txnCount} txns`}
          accent="danger"
        />
        <Kpi
          label="Avg / month"
          value={fmtInr(stats.avgMonthlySpend)}
          sub={`across ${buckets.length} mo`}
        />
        <Kpi
          label="Last vs prev"
          value={
            stats.momDelta == null
              ? "—"
              : `${stats.momDelta >= 0 ? "+" : ""}${(stats.momDelta * 100).toFixed(1)}%`
          }
          sub={
            stats.prevMonth
              ? `${monthLabel(stats.prevMonth.month)} → ${monthLabel(stats.lastMonth.month)}`
              : "—"
          }
          accent={stats.momDelta == null ? undefined : stats.momDelta > 0 ? "danger" : "success"}
        />
        <Kpi label="Total spend" value={fmtInr(stats.totalSpend)} sub={`in ${buckets.length} mo`} />
      </div>

      <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <ReactECharts
          option={option}
          style={{ height: 400 }}
          opts={{ renderer: "canvas" }}
          onEvents={onEvents}
        />
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "success" | "danger";
}) {
  const color =
    accent === "success"
      ? "text-[color:var(--color-success)]"
      : accent === "danger"
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-fg)]";
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="truncate text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[color:var(--color-muted)]">{sub}</div>}
    </div>
  );
}
