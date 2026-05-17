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

import { Ico } from "@/components/Ico";
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
      <main
        className="mx-auto flex flex-col items-center justify-center"
        style={{ maxWidth: 640, padding: "80px 24px", textAlign: "center", gap: 16 }}
      >
        <span className="eyebrow eyebrow-accent">Dashboard · empty state</span>
        <h1 className="display" style={{ fontSize: 36, margin: 0 }}>
          No transactions yet.
        </h1>
        <p className="body" style={{ margin: 0 }}>
          Drop a statement PDF into{" "}
          <span className="kbd">~/Documents/bank/inbox/</span> and the daemon
          will ingest it. Then refresh this page.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero header */}
      <div style={{ padding: "28px 40px 22px" }}>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-3" style={{ flex: 1, minWidth: 320 }}>
            <div className="flex items-center gap-3">
              <span className="eyebrow eyebrow-accent">Dashboard · the long view</span>
              <span className="tag">
                SplitLens<span className="muted-2">/</span>Dashboard
                <span className="muted-2">/</span>all time
              </span>
            </div>
            <h1 className="hero-display" style={{ fontSize: 56, margin: 0 }}>
              Your money,{" "}
              <span style={{ fontStyle: "italic", color: "var(--accent)" }}>
                end to end
              </span>
              .
            </h1>
            <div className="body" style={{ maxWidth: 720 }}>
              {summary.statementCount} statement
              {summary.statementCount === 1 ? "" : "s"} ·{" "}
              {summary.txnCount.toLocaleString("en-IN")} transactions ·{" "}
              {summary.accountCount} account
              {summary.accountCount === 1 ? "" : "s"}. Patterns, peers, and the
              boring tail — laid out below.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm ghost" title="Refresh">
              <Ico name="repeat" size={13} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stat strip */}
      <div style={{ padding: "0 40px 16px" }}>
        <KpiTiles summary={summary} heatmap={heatmap} daily={daily} />
      </div>

      {/* Time heatmap + insight callouts */}
      <div
        style={{
          padding: "0 40px 16px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
          gap: 20,
        }}
      >
        <TimeHeatmap cells={heatmap} />
        <InsightCallouts
          summary={summary}
          heatmap={heatmap}
          daily={daily}
          monthly={monthly}
          topCounterparties={topCounterparties}
        />
      </div>

      {/* Monthly trajectory */}
      <div style={{ padding: "0 40px 16px" }}>
        <MonthlyTrajectory points={monthly} />
      </div>

      {/* Spending calendar */}
      <div style={{ padding: "0 40px 16px" }}>
        <SpendingCalendar daily={daily} />
      </div>

      {/* Top counterparties + autopay links */}
      <div
        style={{
          padding: "0 40px 16px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 20,
        }}
      >
        <TopCounterparties rows={topCounterparties} />
        <AutopayLinks pairs={autopay} />
      </div>

      {/* Category treemap */}
      <div style={{ padding: "0 40px 16px" }}>
        <CategoryTreemap leaves={categoryTree} />
      </div>

      {/* Accounts + people */}
      <div
        style={{
          padding: "0 40px 16px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 20,
        }}
      >
        <AccountsCard accounts={accounts} />
        <TopPeopleCard people={people} />
      </div>

      {/* Recent transactions */}
      <div style={{ padding: "0 40px 32px" }}>
        <RecentTxnsCard txns={recent} people={knownPeople} />
      </div>
    </main>
  );
}
