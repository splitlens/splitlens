"use client";

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
 */
export function MonthlyTrajectory({ points }: { points: MonthlySpendPoint[] }) {
  if (points.length === 0) return null;

  const data = points.map((p) => ({
    label: humanYearMonth(p.yearMonth),
    out: p.totalOut,
    txns: p.txnCount,
  }));

  const total = data.reduce((s, d) => s + d.out, 0);
  const avg = total / Math.max(data.length, 1);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Monthly outflow over time
        </h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          ₹{Math.round(avg).toLocaleString("en-IN")} / month average
        </span>
      </div>
      <ChartFrame height={256}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="trajectoryFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(113,113,122,0.15)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(113,113,122,0.2)" }}
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickFormatter={(v) => fmtInr(v).replace("₹", "₹")}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ stroke: "#a5b4fc", strokeWidth: 1 }}
              wrapperStyle={{ outline: "none" }}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid rgba(113,113,122,0.3)",
                background: "rgba(24,24,27,0.94)",
                color: "#fafafa",
                fontSize: 12,
                padding: "8px 12px",
              }}
              labelStyle={{ color: "#e4e4e7" }}
              itemStyle={{ color: "#fafafa" }}
              formatter={(_value, _name, item) => {
                const data = (item as { payload?: { out: number; txns: number } })?.payload;
                if (!data) return ["—", "Outflow"];
                return [`${fmtInr(data.out)} (${data.txns} txns)`, "Outflow"];
              }}
            />
            <Area
              type="monotone"
              dataKey="out"
              stroke="#6366f1"
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
