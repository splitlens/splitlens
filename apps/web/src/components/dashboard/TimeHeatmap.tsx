import type { HeatmapCell } from "@/lib/repo";
import { fmtInr } from "@/lib/format";

/**
 * GitHub-contributions-style heatmap: 7 weekday rows × 24 hour columns,
 * cell color intensity scaled by total spend in that bucket.
 *
 * Renders as plain SVG — small enough to ship as a Server Component, no
 * recharts overhead for a grid of 168 cells. Cell color is derived from
 * `--accent` via color-mix() so it tracks the active palette.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CELL = 20;
const CELL_GAP = 3;
const LEFT_PAD = 36; // for day labels
const TOP_PAD = 22; // for hour labels

export function TimeHeatmap({ cells }: { cells: HeatmapCell[] }) {
  // Aggregate to a 7x24 dense grid.
  const grid: { total: number; count: number }[][] = Array.from(
    { length: 7 },
    () => Array.from({ length: 24 }, () => ({ total: 0, count: 0 })),
  );
  for (const c of cells) {
    if (c.dayOfWeek < 0 || c.dayOfWeek > 6 || c.hour < 0 || c.hour > 23)
      continue;
    const cell = grid[c.dayOfWeek]![c.hour]!;
    cell.total += c.totalSpend;
    cell.count += c.txnCount;
  }
  const maxTotal = Math.max(...grid.flat().map((g) => g.total), 1);

  const width = LEFT_PAD + 24 * (CELL + CELL_GAP);
  const height = TOP_PAD + 7 * (CELL + CELL_GAP);

  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Time heatmap</span>
          <h3 className="h2">When you spend — hour × day of week</h3>
        </div>
        <span className="tiny">deeper colour = bigger spend</span>
      </div>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <svg width={width} height={height} role="img" aria-label="Spending heatmap">
          {/* Hour labels along the top (every 3 hours) */}
          {Array.from({ length: 24 }, (_, h) => h)
            .filter((h) => h % 3 === 0)
            .map((h) => (
              <text
                key={`hr-${h}`}
                x={LEFT_PAD + h * (CELL + CELL_GAP) + CELL / 2}
                y={TOP_PAD - 8}
                textAnchor="middle"
                fontSize="10"
                fill="var(--muted)"
                fontFamily="var(--font-mono)"
              >
                {h.toString().padStart(2, "0")}
              </text>
            ))}
          {/* Day labels along the left */}
          {DAY_NAMES.map((name, dayIdx) => (
            <text
              key={`d-${name}`}
              x={LEFT_PAD - 8}
              y={TOP_PAD + dayIdx * (CELL + CELL_GAP) + CELL / 2 + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted)"
              fontFamily="var(--font-mono)"
            >
              {name}
            </text>
          ))}
          {/* Cells */}
          {grid.map((row, dayIdx) =>
            row.map((cell, hourIdx) => {
              const intensity = cell.total / maxTotal;
              const fill = colourFor(intensity);
              const title = `${DAY_NAMES[dayIdx]} ${hourIdx
                .toString()
                .padStart(2, "0")}:00 — ${fmtInr(cell.total)} across ${cell.count} txn${cell.count === 1 ? "" : "s"}`;
              return (
                <rect
                  key={`${dayIdx}-${hourIdx}`}
                  x={LEFT_PAD + hourIdx * (CELL + CELL_GAP)}
                  y={TOP_PAD + dayIdx * (CELL + CELL_GAP)}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill={fill}
                  stroke="var(--border)"
                >
                  <title>{title}</title>
                </rect>
              );
            }),
          )}
        </svg>
      </div>
    </div>
  );
}

/** Accent-based gradient. The lightest steps come from --surface-2/--accent-soft
 * so the empty cells blend with the card; the heavier steps mix --accent with
 * the bg in increasing weight so the deepest cells read like a full accent
 * swatch. All values come from CSS variables so palette switching follows. */
function colourFor(intensity: number): string {
  if (intensity === 0) return "var(--surface-2)";
  if (intensity < 0.05) return "var(--accent-soft)";
  if (intensity < 0.2)
    return "color-mix(in srgb, var(--accent) 22%, var(--surface) 78%)";
  if (intensity < 0.4)
    return "color-mix(in srgb, var(--accent) 45%, var(--surface) 55%)";
  if (intensity < 0.7)
    return "color-mix(in srgb, var(--accent) 72%, var(--surface) 28%)";
  return "var(--accent)";
}
