"use client";

import { useMemo } from "react";
import type { CategoryTreeLeaf } from "@/lib/repo";
import { fmtInr } from "@/lib/format";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { ChartFrame } from "./ChartFrame";

/**
 * Two-level category treemap (group → subcategory). Block size = total spend
 * in that subcategory. Eyeballable answer to "where does my money go?".
 *
 * Hover shows exact amount + txn count for that leaf.
 *
 * Colors are drawn from a sequential mix of --accent with --surface so the
 * palette tracks the active theme — biggest groups land on full accent, the
 * tail fades toward surface.
 */
export function CategoryTreemap({ leaves }: { leaves: CategoryTreeLeaf[] }) {
  // Roll up leaves into a recharts-friendly hierarchy. Memoized so the
  // recharts treemap doesn't reflow on every render.
  const data = useMemo(() => {
    const byGroup = new Map<string, CategoryTreeLeaf[]>();
    for (const leaf of leaves) {
      const arr = byGroup.get(leaf.group) ?? [];
      arr.push(leaf);
      byGroup.set(leaf.group, arr);
    }
    return [...byGroup.entries()]
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
  }, [leaves]);

  if (leaves.length === 0) {
    return (
      <div className="surface" style={{ padding: 20 }}>
        <span className="eyebrow">Category breakdown</span>
        <p className="small" style={{ marginTop: 8 }}>
          No categorized spend yet — rules engine hasn&apos;t tagged any txns.
        </p>
      </div>
    );
  }

  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Category breakdown</span>
          <h3 className="h2">Where your money goes</h3>
        </div>
        <span className="tiny">block size = total spend</span>
      </div>
      <ChartFrame height={320}>
        <ResponsiveContainer>
          <Treemap
            data={data}
            dataKey="size"
            stroke="var(--surface)"
            fill="var(--accent)"
            content={<TreemapNode />}
          >
            <Tooltip
              cursor={{ stroke: "var(--accent)", strokeWidth: 1 }}
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
              formatter={(value, _name, item) => {
                const p = (
                  item as { payload?: { name: string; txns?: number } }
                )?.payload;
                const n = typeof value === "number" ? value : Number(value ?? 0);
                if (!p) return [fmtInr(n), ""];
                return [
                  `${fmtInr(n)}${p.txns ? ` (${p.txns} txns)` : ""}`,
                  p.name,
                ];
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

// Accent-derived sequential palette. recharts can't read CSS vars from
// element style, so we use color-mix() literal strings — browsers resolve
// them at paint time, picking up the active --accent / --surface.
const PALETTE = [
  "var(--accent)",
  "color-mix(in srgb, var(--accent) 82%, var(--surface) 18%)",
  "color-mix(in srgb, var(--accent) 64%, var(--surface) 36%)",
  "color-mix(in srgb, var(--accent) 50%, var(--surface) 50%)",
  "color-mix(in srgb, var(--accent) 38%, var(--surface) 62%)",
  "color-mix(in srgb, var(--accent) 28%, var(--surface) 72%)",
  "color-mix(in srgb, var(--accent) 20%, var(--surface) 80%)",
  "color-mix(in srgb, var(--accent) 14%, var(--surface) 86%)",
  "color-mix(in srgb, var(--accent) 10%, var(--surface) 90%)",
  "var(--accent-soft)",
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
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    index = 0,
    name,
    depth = 0,
  } = props;
  if (depth === 1) {
    const colour = PALETTE[index % PALETTE.length]!;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={colour}
          stroke="var(--surface)"
          strokeWidth={2}
          rx={4}
        />
        {width > 60 && height > 20 && (
          <text
            x={x + 8}
            y={y + 18}
            fontSize={11}
            fill="var(--accent-ink)"
            fontFamily="var(--font-sans)"
          >
            {name}
          </text>
        )}
      </g>
    );
  }
  // Group: just outline (recharts draws the children).
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        stroke="var(--border)"
        strokeWidth={1}
      />
    </g>
  );
}
