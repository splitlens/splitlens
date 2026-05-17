"use client";

import type { CategoryTreeLeaf } from "@/lib/repo";
import { fmtInr } from "@/lib/format";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { ChartFrame } from "./ChartFrame";

/**
 * Two-level category treemap (group → subcategory). Block size = total spend
 * in that subcategory. Eyeballable answer to "where does my money go?".
 *
 * Hover shows exact amount + txn count for that leaf.
 */
export function CategoryTreemap({ leaves }: { leaves: CategoryTreeLeaf[] }) {
  if (leaves.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Category breakdown
        </h3>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
          No categorized spend yet — rules engine hasn&apos;t tagged any txns.
        </p>
      </div>
    );
  }

  // Roll up leaves into a recharts-friendly hierarchy.
  const byGroup = new Map<string, CategoryTreeLeaf[]>();
  for (const leaf of leaves) {
    const arr = byGroup.get(leaf.group) ?? [];
    arr.push(leaf);
    byGroup.set(leaf.group, arr);
  }

  const data = [...byGroup.entries()]
    .map(([group, items]) => ({
      name: group,
      children: items.map((it) => ({
        name: it.subcategory,
        size: Math.round(it.totalOut),
        txns: it.txnCount,
      })),
    }))
    .sort(
      (a, b) =>
        b.children.reduce((s, c) => s + c.size, 0) -
        a.children.reduce((s, c) => s + c.size, 0),
    );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Where your money goes
        </h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">block size = total spend</span>
      </div>
      <ChartFrame height={320}>
        <ResponsiveContainer>
          <Treemap
            data={data}
            dataKey="size"
            stroke="rgba(255,255,255,0.6)"
            fill="#6366f1"
            content={<TreemapNode />}
          >
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
              formatter={(value, _name, item) => {
                const p = (item as { payload?: { name: string; txns?: number } })?.payload;
                const n = typeof value === "number" ? value : Number(value ?? 0);
                if (!p) return [fmtInr(n), ""];
                return [`${fmtInr(n)}${p.txns ? ` (${p.txns} txns)` : ""}`, p.name];
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

const PALETTE = [
  "#4f46e5", // indigo-600
  "#7c3aed", // violet-600
  "#0891b2", // cyan-600
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#dc2626", // red-600
  "#db2777", // pink-600
  "#65a30d", // lime-600
  "#0284c7", // sky-600
  "#7e22ce", // purple-700
];

interface NodeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  rank?: number;
  name?: string;
  depth?: number;
  root?: { children?: { name: string }[] };
}

function TreemapNode(props: NodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name, depth = 0, root } = props;
  if (depth === 1) {
    // Leaf: subcategory rectangle.
    const parentIdx = (root?.children ?? []).findIndex((c) =>
      // recharts doesn't pass parent ref directly; map by name match
      Object.is(c, c),
    );
    void parentIdx;
    const colour = PALETTE[index % PALETTE.length]!;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={colour}
          stroke="#fff"
          strokeWidth={2}
          rx={3}
        />
        {width > 60 && height > 20 && (
          <text
            x={x + 6}
            y={y + 16}
            fontSize={11}
            fill="#fff"
            fontFamily="ui-sans-serif, system-ui"
          >
            {name}
          </text>
        )}
      </g>
    );
  }
  // Group: just outline (recharts will draw the children).
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="rgba(0,0,0,0)"
        stroke="rgba(0,0,0,0.08)"
        strokeWidth={1}
      />
    </g>
  );
}
