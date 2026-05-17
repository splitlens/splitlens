import type {
  HeatmapCell,
  DailySpendPoint,
  MonthlySpendPoint,
  TopCounterparty,
  DashboardSummary,
} from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { Ico } from "@/components/Ico";

/**
 * Derive a handful of plain-English insights from the queried data. Each
 * callout is short and concrete — the goal is "tell me one thing I didn't
 * already know about my own spending" per card.
 */
export function InsightCallouts({
  summary,
  heatmap,
  daily,
  monthly,
  topCounterparties,
}: {
  summary: DashboardSummary;
  heatmap: HeatmapCell[];
  daily: DailySpendPoint[];
  monthly: MonthlySpendPoint[];
  topCounterparties: TopCounterparty[];
}) {
  const insights = buildInsights({
    summary,
    heatmap,
    daily,
    monthly,
    topCounterparties,
  });

  return (
    <div
      className="surface flex flex-col"
      style={{
        padding: 20,
        background: "var(--accent-soft)",
        borderColor: "var(--accent-line)",
        gap: 12,
      }}
    >
      <div className="flex items-center gap-2">
        <Ico name="sparkles" size={13} className="accent" />
        <span className="eyebrow eyebrow-accent">Patterns we noticed</span>
      </div>
      <ul
        className="flex flex-col"
        style={{ gap: 10, padding: 0, listStyle: "none", margin: 0 }}
      >
        {insights.map((i, idx) => (
          <li
            key={idx}
            className="flex gap-2"
            style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg-2)" }}
          >
            <span
              className="dot accent"
              style={{ marginTop: 7, flexShrink: 0 }}
              aria-hidden
            />
            <span dangerouslySetInnerHTML={{ __html: i }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

function buildInsights(args: {
  summary: DashboardSummary;
  heatmap: HeatmapCell[];
  daily: DailySpendPoint[];
  monthly: MonthlySpendPoint[];
  topCounterparties: TopCounterparty[];
}): string[] {
  const out: string[] = [];
  const { summary, heatmap, daily, monthly, topCounterparties } = args;

  // 1. Busiest weekday × time-of-day band
  if (heatmap.length > 0) {
    const byDow: Record<number, number> = {};
    for (const c of heatmap)
      byDow[c.dayOfWeek] = (byDow[c.dayOfWeek] ?? 0) + c.totalSpend;
    const [topDow] = Object.entries(byDow).sort((a, b) => b[1] - a[1])[0]!;

    // Late evening band on that day
    const lateBand = heatmap
      .filter(
        (c) =>
          c.dayOfWeek === Number(topDow) && c.hour >= 18 && c.hour <= 22,
      )
      .reduce((s, c) => s + c.totalSpend, 0);
    const earlyBand = heatmap
      .filter((c) => c.dayOfWeek === Number(topDow) && c.hour < 12)
      .reduce((s, c) => s + c.totalSpend, 0);
    const band = lateBand >= earlyBand ? "evening" : "morning";

    out.push(
      `You spend the most on <strong>${DAY_NAMES[Number(topDow)]} ${band}s</strong> — ${fmtInr(byDow[Number(topDow)] ?? 0)} cumulative.`,
    );
  }

  // 2. Late-night / impulse spending
  if (heatmap.length > 0) {
    const lateNight = heatmap
      .filter((c) => c.hour >= 23 || c.hour <= 2)
      .reduce((s, c) => s + c.totalSpend, 0);
    if (lateNight > 0) {
      out.push(
        `Between 11 PM and 3 AM, you've spent <strong>${fmtInr(lateNight)}</strong> across all the time we've tracked.`,
      );
    }
  }

  // 3. Lifestyle trend: compare last 6 months vs preceding 6 months
  if (monthly.length >= 12) {
    const last6 =
      monthly.slice(-6).reduce((s, m) => s + m.totalOut, 0) / 6;
    const prior6 =
      monthly.slice(-12, -6).reduce((s, m) => s + m.totalOut, 0) / 6;
    if (prior6 > 0) {
      const deltaPct = ((last6 - prior6) / prior6) * 100;
      if (Math.abs(deltaPct) >= 8) {
        const dir = deltaPct >= 0 ? "up" : "down";
        out.push(
          `Your average monthly outflow is <strong>${dir} ${Math.abs(deltaPct).toFixed(0)}%</strong> over the last 6 months versus the 6 before (${fmtInr(prior6)}/mo → ${fmtInr(last6)}/mo).`,
        );
      }
    }
  }

  // 4. Big single-day spike
  if (daily.length > 0) {
    const biggest = daily.reduce(
      (m, d) => (d.totalOut > m.totalOut ? d : m),
      daily[0]!,
    );
    out.push(
      `Your biggest single day was <strong>${fmtDate(biggest.txnDate)}</strong> — ${fmtInr(biggest.totalOut)} across ${biggest.txnCount} transactions.`,
    );
  }

  // 5. The counterparty you transact with most often
  const mostFrequent = [...topCounterparties].sort(
    (a, b) => b.txnCount - a.txnCount,
  )[0];
  if (mostFrequent && mostFrequent.txnCount >= 5) {
    out.push(
      `Most frequent counterparty: <strong>${escapeHtml(mostFrequent.counterparty)}</strong> — ${mostFrequent.txnCount} transactions totalling ${fmtInr(mostFrequent.totalOut + mostFrequent.totalIn)}.`,
    );
  }

  // 6. Data quality / time coverage
  if (summary.txnCount > 0) {
    const pct = Math.round((100 * summary.txnsWithTime) / summary.txnCount);
    if (pct < 100) {
      out.push(
        `<strong>${pct}%</strong> of your ${summary.txnCount.toLocaleString("en-IN")} transactions have a wall-clock timestamp — the rest are bank-only rows where the statement didn't record the time of day.`,
      );
    }
  }

  if (out.length === 0) {
    out.push("Ingest some statements to see spending patterns.");
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
