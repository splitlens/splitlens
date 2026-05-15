"use client";

import { useMemo, useState, useTransition } from "react";
import type { DailySpendPoint, DrillDownTxn } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { loadTxnsForDate } from "@/app/dashboard/actions";
import { DayDetailModal } from "./DayDetailModal";

/**
 * GitHub-contributions-style daily calendar: 52 (ish) weeks × 7 days. One
 * grid per year, dropdown picks the year. Cell intensity = log-scaled daily
 * spend. Hover reveals exact amount + txn count.
 */
export function SpendingCalendar({ daily }: { daily: DailySpendPoint[] }) {
  const years = useMemo(() => {
    const ys = new Set<number>();
    for (const d of daily) ys.add(parseInt(d.txnDate.slice(0, 4), 10));
    return [...ys].sort((a, b) => b - a);
  }, [daily]);

  const [year, setYear] = useState<number>(() => years[0] ?? new Date().getFullYear());

  if (years.length === 0) return null;

  const byDate = useMemo(() => {
    const m = new Map<string, DailySpendPoint>();
    for (const d of daily) m.set(d.txnDate, d);
    return m;
  }, [daily]);

  const cells = useMemo(() => buildYearGrid(year, byDate), [year, byDate]);

  const maxSpend = useMemo(
    () => cells.reduce((m, c) => (c.point && c.point.totalOut > m ? c.point.totalOut : m), 1),
    [cells],
  );

  const yearTotal = cells.reduce((s, c) => s + (c.point?.totalOut ?? 0), 0);
  const daysSpent = cells.filter((c) => c.point && c.point.totalOut > 0).length;

  // Modal drill-down state. `selectedDate` is the ISO date the user clicked;
  // `txns` is filled by the server action when the click handler resolves.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [drillTxns, setDrillTxns] = useState<DrillDownTxn[]>([]);
  const [isPending, startTransition] = useTransition();

  function handleDayClick(date: string) {
    setSelectedDate(date);
    setDrillTxns([]);
    startTransition(async () => {
      const rows = await loadTxnsForDate(date);
      setDrillTxns(rows);
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Spending calendar — {fmtInr(yearTotal)} across {daysSpent} days in {year}
        </h3>
        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto">
        <CalendarSvg cells={cells} maxSpend={maxSpend} year={year} onCellClick={handleDayClick} />
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
        <span>less</span>
        {INTENSITY_BUCKETS.map((b, i) => (
          <span
            key={i}
            className="inline-block h-3 w-3 rounded-sm border border-zinc-100 dark:border-zinc-800"
            style={{ backgroundColor: b.colour }}
          />
        ))}
        <span>more</span>
        <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
          click any day for details
        </span>
      </div>

      {selectedDate && (
        <DayDetailModal
          date={selectedDate}
          loading={isPending}
          txns={drillTxns}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}

interface Cell {
  date: string; // 'YYYY-MM-DD' or '' for blank
  dayOfWeek: number; // 0..6 (Sun..Sat)
  weekIdx: number; // column
  point?: DailySpendPoint;
}

function buildYearGrid(year: number, byDate: Map<string, DailySpendPoint>): Cell[] {
  const cells: Cell[] = [];
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  let weekIdx = 0;
  // Pad the first week with blanks so day-of-week aligns to a row.
  const firstDow = start.getUTCDay();
  for (let i = 0; i < firstDow; i++) {
    cells.push({ date: "", dayOfWeek: i, weekIdx });
  }
  for (
    let cur = new Date(start);
    cur.getTime() <= end.getTime();
    cur.setUTCDate(cur.getUTCDate() + 1)
  ) {
    const iso = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    cells.push({ date: iso, dayOfWeek: dow, weekIdx, point: byDate.get(iso) });
    if (dow === 6) weekIdx++;
  }
  return cells;
}

const CELL = 12;
const CELL_GAP = 3;
const TOP_PAD = 18;
const LEFT_PAD = 28;

function CalendarSvg({
  cells,
  maxSpend,
  year,
  onCellClick,
}: {
  cells: Cell[];
  maxSpend: number;
  year: number;
  onCellClick: (date: string) => void;
}) {
  const cols = (cells[cells.length - 1]?.weekIdx ?? 0) + 1;
  const width = LEFT_PAD + cols * (CELL + CELL_GAP);
  const height = TOP_PAD + 7 * (CELL + CELL_GAP);

  // Month labels — place at the first week index where that month starts.
  const monthMarkers: { month: string; weekIdx: number }[] = [];
  const seen = new Set<number>();
  for (const c of cells) {
    if (!c.date) continue;
    const m = parseInt(c.date.slice(5, 7), 10);
    if (!seen.has(m)) {
      seen.add(m);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      monthMarkers.push({ month: months[m - 1]!, weekIdx: c.weekIdx });
    }
  }
  void year; // referenced only via callers

  return (
    <svg width={width} height={height} role="img">
      {/* Month labels */}
      {monthMarkers.map((mm) => (
        <text
          key={`m-${mm.month}-${mm.weekIdx}`}
          x={LEFT_PAD + mm.weekIdx * (CELL + CELL_GAP)}
          y={TOP_PAD - 6}
          fontSize="10"
          fill="var(--svg-label)"
          fontFamily="ui-sans-serif, system-ui"
        >
          {mm.month}
        </text>
      ))}
      {/* Day-of-week labels (every other row to save space) */}
      {["Mon", "Wed", "Fri"].map((d, i) => (
        <text
          key={d}
          x={LEFT_PAD - 6}
          y={TOP_PAD + (i * 2 + 1) * (CELL + CELL_GAP) + 9}
          textAnchor="end"
          fontSize="9"
          fill="var(--svg-label)"
          fontFamily="ui-sans-serif, system-ui"
        >
          {d}
        </text>
      ))}
      {/* Day cells */}
      {cells
        .filter((c) => c.date !== "")
        .map((c) => {
          const intensity = c.point ? c.point.totalOut / maxSpend : 0;
          const fill = colourForIntensity(intensity);
          const titleText = c.point
            ? `${fmtDate(c.date)} — ${fmtInr(c.point.totalOut)} across ${c.point.txnCount} txn${c.point.txnCount === 1 ? "" : "s"}`
            : `${fmtDate(c.date)} — no activity`;
          return (
            <rect
              key={c.date}
              x={LEFT_PAD + c.weekIdx * (CELL + CELL_GAP)}
              y={TOP_PAD + c.dayOfWeek * (CELL + CELL_GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              fill={fill}
              stroke="var(--cell-empty-stroke)"
              style={{ cursor: c.point && c.point.totalOut > 0 ? "pointer" : "default" }}
              onClick={() => {
                if (c.point && c.point.totalOut > 0) onCellClick(c.date);
              }}
            >
              <title>{titleText}</title>
            </rect>
          );
        })}
    </svg>
  );
}

const INTENSITY_BUCKETS = [
  // The two lightest bands use CSS variables so they flip with the OS theme.
  { threshold: 0, colour: "var(--cell-empty)" },
  { threshold: 0.05, colour: "var(--cell-low)" },
  { threshold: 0.2, colour: "#93c5fd" }, // blue-300
  { threshold: 0.4, colour: "#3b82f6" }, // blue-500
  { threshold: 0.7, colour: "#1d4ed8" }, // blue-700
];

function colourForIntensity(intensity: number): string {
  if (intensity === 0) return INTENSITY_BUCKETS[0]!.colour;
  for (let i = INTENSITY_BUCKETS.length - 1; i >= 0; i--) {
    if (intensity >= INTENSITY_BUCKETS[i]!.threshold) return INTENSITY_BUCKETS[i]!.colour;
  }
  return INTENSITY_BUCKETS[0]!.colour;
}
