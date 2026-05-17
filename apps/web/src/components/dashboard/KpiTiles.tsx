import type { DashboardSummary, HeatmapCell, DailySpendPoint } from "@/lib/repo";
import { fmtDate, fmtInr } from "@/lib/format";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Tile {
  label: string;
  value: string;
  sub?: string;
}

export function KpiTiles({
  summary,
  heatmap,
  daily,
}: {
  summary: DashboardSummary;
  heatmap: HeatmapCell[];
  daily: DailySpendPoint[];
}) {
  // Range in months (for avg/month derivation).
  const months = monthsBetween(summary.earliestTxnDate, summary.latestTxnDate);
  const avgMonthly = months > 0 ? summary.totalOut / months : 0;

  // Biggest day overall.
  const biggestDay = daily.reduce<DailySpendPoint | null>(
    (acc, d) => (acc == null || d.totalOut > acc.totalOut ? d : acc),
    null,
  );

  // Busiest (hour × day) bucket in the heatmap.
  const busiest = heatmap.reduce<HeatmapCell | null>(
    (acc, c) => (acc == null || c.totalSpend > acc.totalSpend ? c : acc),
    null,
  );

  // Coverage = fraction of canonical txns we got wall-clock time for.
  const timeCoverage =
    summary.txnCount > 0 ? Math.round((100 * summary.txnsWithTime) / summary.txnCount) : 0;

  const tiles: Tile[] = [
    {
      label: "Total outflow",
      value: fmtInr(summary.totalOut),
      sub: months > 0 ? `${months} months tracked` : undefined,
    },
    {
      label: "Avg / month",
      value: fmtInr(avgMonthly),
      sub:
        summary.earliestTxnDate && summary.latestTxnDate
          ? `${shortDate(summary.earliestTxnDate)} → ${shortDate(summary.latestTxnDate)}`
          : undefined,
    },
    {
      label: "Transactions",
      value: summary.txnCount.toLocaleString("en-IN"),
      sub: `${timeCoverage}% with wall-clock time`,
    },
    {
      label: "Busiest hour",
      value: busiest ? `${DAY_NAMES[busiest.dayOfWeek]} ${pad(busiest.hour)}:00` : "—",
      sub: busiest ? `${fmtInr(busiest.totalSpend)} cumulative` : undefined,
    },
    {
      label: "Biggest single day",
      value: biggestDay ? fmtInr(biggestDay.totalOut) : "—",
      sub: biggestDay ? fmtDate(biggestDay.txnDate) : undefined,
    },
    {
      label: "Autopay links found",
      value: summary.autopayPairs.toString(),
      sub: "savings ↔ credit card",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t.label}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {t.value}
          </div>
          {t.sub && <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`;
}

function monthsBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  if (ya == null || ma == null || yb == null || mb == null) return 0;
  return Math.max(1, (yb - ya) * 12 + (mb - ma) + 1);
}
