import {
  getDashboardSummary,
  getAccountsWithSummary,
  getRecentTransactions,
  getPeopleSummary,
  getTimeOfDayHeatmap,
  getMonthlyTrajectory,
  getDailySpend,
  getTopCounterparties,
  getAutopayPairs,
  getCategoryTree,
} from "@/lib/repo";
import { listKnownPeople } from "@/app/friends/actions";

import { KpiTiles } from "@/components/dashboard/KpiTiles";
import { TimeHeatmap } from "@/components/dashboard/TimeHeatmap";
import { MonthlyTrajectory } from "@/components/dashboard/MonthlyTrajectory";
import { SpendingCalendar } from "@/components/dashboard/SpendingCalendar";
import { TopCounterparties } from "@/components/dashboard/TopCounterparties";
import { AutopayLinks } from "@/components/dashboard/AutopayLinks";
import { CategoryTreemap } from "@/components/dashboard/CategoryTreemap";
import { InsightCallouts } from "@/components/dashboard/InsightCallouts";
import { AccountsCard } from "@/components/dashboard/AccountsCard";
import { TopPeopleCard } from "@/components/dashboard/TopPeopleCard";
import { RecentTxnsCard } from "@/components/dashboard/RecentTxnsCard";

// Always pull fresh data — the SQLite file is updated out-of-band by the
// daemon and this is a localhost-only view, so caching just adds confusion.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  // All queries fire in parallel — they hit the same SQLite handle but better-
  // sqlite3 is synchronous and serializes internally, so this is effectively
  // a sequential read with concise call-site code.
  const [
    summary,
    accounts,
    people,
    heatmap,
    monthly,
    daily,
    topCounterparties,
    autopay,
    categoryTree,
    recent,
    knownPeople,
  ] = await Promise.all([
    getDashboardSummary(),
    getAccountsWithSummary(),
    getPeopleSummary(),
    getTimeOfDayHeatmap(),
    getMonthlyTrajectory(),
    getDailySpend(),
    getTopCounterparties(20),
    getAutopayPairs(),
    getCategoryTree(),
    getRecentTransactions(100),
    listKnownPeople(),
  ]);

  if (summary.txnCount === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">No transactions yet</h1>
        <p className="mt-3 text-zinc-700">
          Drop a statement PDF into{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
            ~/Documents/bank/inbox/
          </code>{" "}
          and the daemon will ingest it. Then refresh this page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {summary.statementCount} statement{summary.statementCount === 1 ? "" : "s"} ·{" "}
            {summary.txnCount.toLocaleString("en-IN")} transactions ·{" "}
            {summary.accountCount} account{summary.accountCount === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      {/* Stat strip */}
      <KpiTiles summary={summary} heatmap={heatmap} daily={daily} />

      {/* Time heatmap + insight callouts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <TimeHeatmap cells={heatmap} />
        </div>
        <div className="lg:col-span-2">
          <InsightCallouts
            summary={summary}
            heatmap={heatmap}
            daily={daily}
            monthly={monthly}
            topCounterparties={topCounterparties}
          />
        </div>
      </div>

      {/* Monthly trajectory */}
      <MonthlyTrajectory points={monthly} />

      {/* Spending calendar */}
      <SpendingCalendar daily={daily} />

      {/* Top counterparties + autopay links */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TopCounterparties rows={topCounterparties} />
        </div>
        <AutopayLinks pairs={autopay} />
      </div>

      {/* Category treemap */}
      <CategoryTreemap leaves={categoryTree} />

      {/* Accounts + people */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <AccountsCard accounts={accounts} />
        <TopPeopleCard people={people} />
      </div>

      {/* Recent transactions */}
      <RecentTxnsCard txns={recent} people={knownPeople} />
    </main>
  );
}
