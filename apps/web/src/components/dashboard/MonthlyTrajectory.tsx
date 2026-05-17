"use client";

import { useRouter } from "next/navigation";

import type { MonthlySpendPoint } from "@/lib/repo";
import { fmtInr } from "@/lib/format";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "./ChartFrame";

/**
 * Monthly outflow over the full multi-year window. Shows lifestyle creep
 * (or restraint) at a glance — the spread is wider than any single statement.
 *
 * Colors come from the active palette via CSS variables. We read --accent
 * from the document root at render time so recharts (which can't consume
 * CSS variables in its SVG attributes) still picks up palette switches.
 */
export function MonthlyTrajectory({ points }: { points: MonthlySpendPoint[] }) {
  const router = useRouter();
  if (points.length === 0) return null;

  const data = points.map((p) => ({
    yearMonth: p.yearMonth,
    label: humanYearMonth(p.yearMonth),
    out: p.totalOut,
    txns: p.txnCount,
  }));

  // Recharts fires AreaChart.onClick with `activePayload` describing the
  // nearest data point. We use that to drill into the monthly report —
  // the /reports/[yearMonth] route already exists, so this is purely a
  // navigation wire-up. The chart-level handler is typed loosely by
  // recharts (MouseHandlerDataParam), so we narrow at the boundary.
  const handleChartClick = (state: unknown) => {
    const s = state as
      | { activePayload?: Array<{ payload?: { yearMonth?: string } }> }
      | null
      | undefined;
    const ym = s?.activePayload?.[0]?.payload?.yearMonth;
    if (ym && /^\d{4}-\d{2}$/.test(ym)) {
      router.push(`/reports/${ym}`);
    }
  };

  const total = data.reduce((s, d) => s + d.out, 0);
  const avg = total / Math.max(data.length, 1);

  // recharts hard-codes stroke/fill into the rendered SVG, so we resolve the
  // active palette accent at render time. Browser-only, so this runs after
  // ChartFrame has gated SSR.
  const accent = readCssVar("--accent", "#b8732d");
  const muted = readCssVar("--muted-2", "#888");
  const border = readCssVar("--border", "rgba(120,120,120,0.2)");

  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Trajectory</span>
          <h3 className="h2">Monthly outflow over time</h3>
        </div>
        <div
          className="flex items-baseline"
          style={{ gap: 10, flexShrink: 0 }}
        >
          <span className="tiny muted">click a month to drill in</span>
          <span className="tag mono">
            avg <span className="fg-2">{fmtInr(Math.round(avg))}/mo</span>
          </span>
        </div>
      </div>
      <ChartFrame height={256}>
        <ResponsiveContainer>
          <AreaChart
            data={data}
            margin={{ top: 12, right: 10, bottom: 0, left: 0 }}
            onClick={handleChartClick}
            style={{ cursor: "pointer" }}
          >
            <defs>
              <linearGradient id="trajectoryFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.32} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
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
              tickFormatter={(v) => fmtInr(v)}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ stroke: accent, strokeWidth: 1 }}
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
              formatter={(_value, _name, item) => {
                const data = (
                  item as { payload?: { out: number; txns: number } }
                )?.payload;
                if (!data) return ["—", "Outflow"];
                return [`${fmtInr(data.out)} (${data.txns} txns)`, "Outflow"];
              }}
            />
            <Area
              type="monotone"
              dataKey="out"
              stroke={accent}
              strokeWidth={2}
              fill="url(#trajectoryFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

function humanYearMonth(ym: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = ym.split("-").map(Number);
  if (y == null || m == null) return ym;
  return `${months[m - 1]} ${y.toString().slice(2)}`;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}
