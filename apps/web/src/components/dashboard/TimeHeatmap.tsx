import type { HeatmapCell } from "@/lib/repo";
import { fmtInr } from "@/lib/format";

/**
 * GitHub-contributions-style heatmap: 7 weekday rows × 24 hour columns,
 * cell color intensity scaled by total spend in that bucket.
 *
 * Renders as plain SVG — small enough to ship as a Server Component, no
 * recharts overhead for a grid of 168 cells.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CELL = 20;
const CELL_GAP = 3;
const LEFT_PAD = 36; // for day labels
const TOP_PAD = 22; // for hour labels

export function TimeHeatmap({ cells }: { cells: HeatmapCell[] }) {
  // Aggregate to a 7x24 dense grid.
  const grid: { total: number; count: number }[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ total: 0, count: 0 })),
  );
  for (const c of cells) {
    if (c.dayOfWeek < 0 || c.dayOfWeek > 6 || c.hour < 0 || c.hour > 23) continue;
    const cell = grid[c.dayOfWeek]![c.hour]!;
    cell.total += c.totalSpend;
    cell.count += c.txnCount;
  }
  const maxTotal = Math.max(...grid.flat().map((g) => g.total), 1);

  const width = LEFT_PAD + 24 * (CELL + CELL_GAP);
  const height = TOP_PAD + 7 * (CELL + CELL_GAP);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          When you spend — hour of day × day of week
        </h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">deeper colour = bigger spend in that bucket</span>
      </div>
      <div className="mt-3 overflow-x-auto">
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
                fill="var(--svg-label)"
                fontFamily="ui-sans-serif, system-ui"
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
              fill="#71717a"
              fontFamily="ui-sans-serif, system-ui"
            >
              {name}
            </text>
          ))}
          {/* Cells */}
          {grid.map((row, dayIdx) =>
            row.map((cell, hourIdx) => {
              const intensity = cell.total / maxTotal;
              const fill = colourFor(intensity);
              const title = `${DAY_NAMES[dayIdx]} ${hourIdx.toString().padStart(2, "0")}:00 — ${fmtInr(cell.total)} across ${cell.count} txn${cell.count === 1 ? "" : "s"}`;
              return (
                <rect
                  key={`${dayIdx}-${hourIdx}`}
                  x={LEFT_PAD + hourIdx * (CELL + CELL_GAP)}
                  y={TOP_PAD + dayIdx * (CELL + CELL_GAP)}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill={fill}
                  stroke="var(--cell-empty-stroke)"
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

/** Indigo gradient — Tailwind's indigo-50 → indigo-700 area.
 * The two lightest bands ("empty" and "very low") come from CSS variables so
 * they auto-flip when the OS prefers dark mode. The mid-tones (200..800) read
 * fine on both light and dark backgrounds without adjustment. */
function colourFor(intensity: number): string {
  if (intensity === 0) return "var(--cell-empty)";
  if (intensity < 0.05) return "var(--cell-low)";
  if (intensity < 0.2) return "#c7d2fe"; // indigo-200
  if (intensity < 0.4) return "#818cf8"; // indigo-400
  if (intensity < 0.7) return "#4f46e5"; // indigo-600
  return "#3730a3"; // indigo-800
}
