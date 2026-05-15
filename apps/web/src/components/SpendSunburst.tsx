"use client";

/**
 * Sunburst chart of spend, broken down Group → Sub.
 *
 * ECharts is ~900KB, so we lazy-load via next/dynamic with ssr:false. The
 * chart only ships to clients that actually navigate to the dashboard.
 */
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { CategorySummary } from "@/lib/repo";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] items-center justify-center text-[color:var(--color-muted)]">
      Loading chart…
    </div>
  ),
});

/**
 * Group → hex color. Mirrors TransactionTable.GROUP_COLORS so the same group
 * looks the same across pills, sunburst slices, and the monthly report bars.
 * Using mid-saturation tones that read on the dark theme.
 */
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

interface SunburstNode {
  name: string;
  value?: number;
  itemStyle?: { color: string };
  children?: SunburstNode[];
}

/**
 * Reshape flat (group:sub, totalOut) rows into a 2-level tree the sunburst
 * understands. Categories without a sub-portion get folded into a "(general)"
 * leaf so they're still visible in the outer ring.
 */
function buildTree(cats: CategorySummary[]): SunburstNode[] {
  const groups = new Map<string, SunburstNode>();
  for (const c of cats) {
    if (c.totalOut <= 0) continue;
    const grp = c.group;
    const sub = c.category.includes(":")
      ? c.category.slice(c.category.indexOf(":") + 1)
      : "(general)";
    const color = GROUP_HEX[grp] ?? "#8b5cf6";

    let node = groups.get(grp);
    if (!node) {
      node = { name: grp, itemStyle: { color }, children: [] };
      groups.set(grp, node);
    }
    node.children!.push({ name: sub, value: c.totalOut });
  }
  // Sort groups by total spend desc so dominant groups land at the top of the wheel.
  return Array.from(groups.values()).sort((a, b) => {
    const sumA = a.children!.reduce((s, n) => s + (n.value ?? 0), 0);
    const sumB = b.children!.reduce((s, n) => s + (n.value ?? 0), 0);
    return sumB - sumA;
  });
}

interface TooltipParams {
  name: string;
  value?: number;
  treePathInfo?: { name: string }[];
}

export function SpendSunburst({ categories }: { categories: CategorySummary[] }) {
  const tree = useMemo(() => buildTree(categories), [categories]);
  const total = useMemo(
    () =>
      tree.reduce(
        (s, g) => s + (g.children?.reduce((ss, n) => ss + (n.value ?? 0), 0) ?? 0),
        0,
      ),
    [tree],
  );

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15,15,20,0.95)",
        borderColor: "rgba(255,255,255,0.15)",
        textStyle: { color: "#e4e4e7" },
        formatter: (info: TooltipParams) => {
          const v = info.value ?? 0;
          const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
          const path = (info.treePathInfo ?? []).map((p) => p.name).filter(Boolean).join(" › ");
          return `<div style="font-size:12px;line-height:1.5">
            <div style="opacity:0.7">${path || info.name}</div>
            <div style="font-weight:600;font-size:14px">₹${v.toLocaleString("en-IN", {
              maximumFractionDigits: 0,
            })}</div>
            <div style="opacity:0.7">${pct}% of total</div>
          </div>`;
        },
      },
      series: [
        {
          type: "sunburst",
          radius: ["15%", "95%"],
          data: tree,
          // Nice silky transitions when zooming
          animationDurationUpdate: 600,
          itemStyle: {
            borderColor: "rgba(0,0,0,0.4)",
            borderWidth: 2,
          },
          label: {
            color: "#fafafa",
            textBorderColor: "rgba(0,0,0,0.6)",
            textBorderWidth: 2,
          },
          emphasis: { focus: "ancestor" },
          levels: [
            {},
            // Inner ring: groups
            {
              r0: "15%",
              r: "55%",
              label: {
                rotate: "tangential" as const,
                fontSize: 12,
                fontWeight: 600,
              },
            },
            // Outer ring: sub-categories
            {
              r0: "55%",
              r: "95%",
              label: {
                rotate: "radial" as const,
                fontSize: 10,
                align: "right" as const,
              },
              itemStyle: {
                opacity: 0.85,
              },
            },
          ],
        },
      ],
    }),
    [tree, total],
  );

  if (tree.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Spend hierarchy</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 0 })} across {tree.length}{" "}
          groups · click a slice to drill in
        </p>
      </div>
      <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <ReactECharts option={option} style={{ height: 500 }} opts={{ renderer: "canvas" }} />
      </div>
    </section>
  );
}
