"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getDashboardSummary,
  getAccountsWithSummary,
  getRecentTransactions,
  getSpendByCategory,
  getPeopleSummary,
  getMonthlySpend,
  getCategorySpendByMonth,
  type DashboardSummary,
  type AccountSummary,
  type CategorySummary,
  type PeopleSummary,
  type MonthlyBucket,
  type CategoryByMonth,
} from "@/lib/repo";
import { resetDb } from "@/lib/db";
import { TransactionTable, CategoryPill, PersonChip } from "@/components/TransactionTable";
import { SpendSunburst } from "@/components/SpendSunburst";
import { MonthlyReport } from "@/components/MonthlyReport";
import { fmtInr, fmtInrExact } from "@/lib/format";

interface State {
  summary: DashboardSummary | null;
  accounts: AccountSummary[];
  recent: Array<{
    txnDate: string;
    narration: string;
    withdrawal: number | null;
    deposit: number | null;
    closingBalance: number | null;
    category: string | null;
    personId: string | null;
  }>;
  categories: CategorySummary[];
  people: PeopleSummary[];
  monthly: MonthlyBucket[];
  monthlyByGroup: CategoryByMonth[];
  loading: boolean;
  error: string | null;
}

export default function DashboardPage() {
  const [state, setState] = useState<State>({
    summary: null,
    accounts: [],
    recent: [],
    categories: [],
    people: [],
    monthly: [],
    monthlyByGroup: [],
    loading: true,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [resetState, setResetState] = useState<"idle" | "confirming" | "running">("idle");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summary, accounts, recent, categories, people, monthly, monthlyByGroup] =
          await Promise.all([
            getDashboardSummary(),
            getAccountsWithSummary(),
            getRecentTransactions(100),
            getSpendByCategory({ excludeNonSpend: true }),
            getPeopleSummary(),
            getMonthlySpend(),
            getCategorySpendByMonth(),
          ]);
        if (cancelled) return;
        setState({
          summary,
          accounts,
          recent: recent.map((r) => ({
            txnDate: r.txnDate,
            narration: r.narration,
            withdrawal: r.withdrawal,
            deposit: r.deposit,
            closingBalance: r.closingBalance,
            category: r.category,
            personId: r.personId,
          })),
          categories,
          people,
          monthly,
          monthlyByGroup,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function handleReset() {
    if (resetState === "idle") {
      setResetState("confirming");
      // Auto-cancel confirmation after 5s if not clicked again
      setTimeout(() => setResetState((s) => (s === "confirming" ? "idle" : s)), 5000);
      return;
    }
    if (resetState === "confirming") {
      setResetState("running");
      try {
        await resetDb();
        setReloadKey((k) => k + 1);
      } catch (err) {
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      } finally {
        setResetState("idle");
      }
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Your dashboard</h1>
            <p className="mt-2 text-[color:var(--color-muted)]">
              All transactions persisted in your browser&apos;s local DB. Close the tab → reopen
              tomorrow → still here.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-2 text-sm hover:border-[color:var(--color-accent)]"
              title="Re-query the local DB"
            >
              ↻ Refresh
            </button>
            <Link
              href="/try"
              className="rounded-md bg-[color:var(--color-accent)] px-5 py-2 text-sm font-semibold text-[color:var(--color-accent-fg)]"
            >
              + Add another statement
            </Link>
          </div>
        </div>
      </header>

      {state.loading && <p className="text-[color:var(--color-muted)]">Loading from local DB…</p>}

      {state.error && (
        <div
          role="alert"
          className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 mb-6 rounded-md border px-4 py-3 text-sm text-[color:var(--color-danger)]"
        >
          ⚠️ {state.error}
        </div>
      )}

      {state.summary && state.summary.statementCount === 0 && (
        <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-12 text-center">
          <div className="mb-4 text-5xl">📭</div>
          <h2 className="text-xl font-semibold">No statements yet</h2>
          <p className="mt-2 text-[color:var(--color-muted)]">
            Drop your first PDF on the upload page to get started.
          </p>
          <Link
            href="/try"
            className="mt-6 inline-block rounded-md bg-[color:var(--color-accent)] px-6 py-3 font-semibold text-[color:var(--color-accent-fg)]"
          >
            Upload your first statement
          </Link>
        </div>
      )}

      {state.summary && state.summary.statementCount > 0 && (
        <>
          <section className="mb-10 grid gap-4 sm:grid-cols-4">
            <Stat label="Accounts" value={state.summary.accountCount.toString()} />
            <Stat label="Statements" value={state.summary.statementCount.toString()} />
            <Stat label="Transactions" value={state.summary.txnCount.toLocaleString("en-IN")} />
            <Stat
              label="Net change"
              value={fmtInr(state.summary.totalIn - state.summary.totalOut)}
              accent={state.summary.totalIn >= state.summary.totalOut ? "success" : "danger"}
            />
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Accounts</h2>
            <div className="overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
              <table className="w-full text-sm">
                <thead className="bg-black/20 text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                  <tr>
                    <th className="px-4 py-2 text-left">Account</th>
                    <th className="px-4 py-2 text-right"># Txns</th>
                    <th className="px-4 py-2 text-right">Out</th>
                    <th className="px-4 py-2 text-right">In</th>
                    <th className="px-4 py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {state.accounts.map((a) => (
                    <tr key={a.id} className="border-[color:var(--color-border)]/50 border-t">
                      <td className="px-4 py-2">
                        <div className="font-semibold">
                          {a.bank} {a.type === "credit_card" ? "Credit Card" : "Savings"} ···
                          {a.last4}
                        </div>
                        {a.customerName && (
                          <div className="text-xs text-[color:var(--color-muted)]">
                            {a.customerName}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {a.txnCount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[color:var(--color-danger)]">
                        {fmtInrExact(a.totalOut)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[color:var(--color-success)]">
                        {fmtInrExact(a.totalIn)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {fmtInrExact(a.totalIn - a.totalOut)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <MonthlyReport buckets={state.monthly} byGroup={state.monthlyByGroup} />

          <SpendSunburst categories={state.categories} />

          <TopPeople people={state.people} />

          <CategoryBreakdown categories={state.categories} />

          <section>
            <h2 className="mb-4 text-xl font-semibold">Recent transactions (latest 100)</h2>
            <TransactionTable rows={state.recent} max={100} />
          </section>

          <DangerZone resetState={resetState} onReset={handleReset} />
        </>
      )}

      {state.summary?.statementCount === 0 && (
        // Even on empty state, allow reset (in case of corrupt half-init)
        <DangerZone resetState={resetState} onReset={handleReset} />
      )}
    </main>
  );
}

/**
 * Top people section. Shows everyone the user has transacted with (from
 * DEFAULT_PEOPLE registry), sorted by total volume. Net column tells you
 * "are you ahead or behind with this person" — positive = they owe you.
 */
function TopPeople({ people }: { people: PeopleSummary[] }) {
  if (people.length === 0) return null;
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Top people</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          {people.length} {people.length === 1 ? "person" : "people"} identified · sorted by volume
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
        <table className="w-full text-sm">
          <thead className="bg-black/20 text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
            <tr>
              <th className="px-4 py-2 text-left">Person</th>
              <th className="px-4 py-2 text-right"># Txns</th>
              <th className="px-4 py-2 text-right">Sent</th>
              <th className="px-4 py-2 text-right">Received</th>
              <th className="px-4 py-2 text-right">Net</th>
              <th className="px-4 py-2 text-right">Last txn</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.personId} className="border-[color:var(--color-border)]/50 border-t">
                <td className="px-4 py-2">
                  <PersonChip personId={p.personId} />
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {p.txnCount.toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-2 text-right font-mono text-[color:var(--color-danger)]">
                  {p.totalSent > 0 ? fmtInrExact(p.totalSent) : ""}
                </td>
                <td className="px-4 py-2 text-right font-mono text-[color:var(--color-success)]">
                  {p.totalReceived > 0 ? fmtInrExact(p.totalReceived) : ""}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono font-semibold ${
                    p.net > 0
                      ? "text-[color:var(--color-success)]"
                      : p.net < 0
                        ? "text-[color:var(--color-danger)]"
                        : "text-[color:var(--color-muted)]"
                  }`}
                  title={
                    p.net > 0
                      ? "You sent more than you received — they may owe you"
                      : p.net < 0
                        ? "You received more than you sent — you may owe them"
                        : "Settled up"
                  }
                >
                  {p.net !== 0 ? fmtInrExact(Math.abs(p.net)) : "—"}
                  {p.net > 0 && <span className="ml-1 text-xs opacity-60">↑</span>}
                  {p.net < 0 && <span className="ml-1 text-xs opacity-60">↓</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-[color:var(--color-muted)]">
                  {p.lastTxnDate ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryBreakdown({ categories }: { categories: CategorySummary[] }) {
  const spendCats = categories.filter((c) => c.totalOut > 0);
  if (spendCats.length === 0) {
    return null;
  }
  const max = Math.max(...spendCats.map((c) => c.totalOut));
  const total = spendCats.reduce((s, c) => s + c.totalOut, 0);
  const top = spendCats.slice(0, 15);

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Spend by category</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          {fmtInr(total)} across {spendCats.length} categories · transfers + investments excluded
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
        <ul>
          {top.map((c) => {
            const pctOfMax = (c.totalOut / max) * 100;
            const pctOfTotal = (c.totalOut / total) * 100;
            return (
              <li
                key={c.category}
                className="border-[color:var(--color-border)]/40 relative grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t px-4 py-3 first:border-t-0"
              >
                {/* Background bar */}
                <div
                  className="bg-[color:var(--color-accent)]/10 absolute inset-y-0 left-0"
                  style={{ width: `${pctOfMax}%` }}
                  aria-hidden
                />
                <div className="relative flex items-center gap-3">
                  <CategoryPill category={c.category} />
                  <span className="text-xs text-[color:var(--color-muted)]">
                    {c.txnCount} txn{c.txnCount === 1 ? "" : "s"}
                  </span>
                </div>
                <span className="relative whitespace-nowrap font-mono text-sm">
                  {pctOfTotal.toFixed(1)}%
                </span>
                <span className="relative whitespace-nowrap font-mono font-semibold">
                  {fmtInrExact(c.totalOut)}
                </span>
              </li>
            );
          })}
        </ul>
        {spendCats.length > 15 && (
          <div className="border-[color:var(--color-border)]/40 border-t px-4 py-2 text-xs text-[color:var(--color-muted)]">
            … and {spendCats.length - 15} more categories
          </div>
        )}
      </div>
    </section>
  );
}

function DangerZone({
  resetState,
  onReset,
}: {
  resetState: "idle" | "confirming" | "running";
  onReset: () => void;
}) {
  return (
    <section className="border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/5 mt-16 rounded-xl border p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--color-danger)]">
        ⚠️ Danger zone
      </h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-semibold">Reset all data</div>
          <p className="text-sm text-[color:var(--color-muted)]">
            Drops every account, statement, and transaction from your local DB. PDFs themselves are
            not affected (they live on your computer). This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={resetState === "running"}
          className={`rounded-md px-5 py-2 text-sm font-semibold transition-colors ${
            resetState === "confirming"
              ? "bg-[color:var(--color-danger)] text-white hover:opacity-90"
              : "border-[color:var(--color-danger)]/40 hover:bg-[color:var(--color-danger)]/10 border text-[color:var(--color-danger)]"
          } disabled:opacity-50`}
        >
          {resetState === "running"
            ? "Wiping…"
            : resetState === "confirming"
              ? "Click again to confirm"
              : "Reset all data"}
        </button>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success" | "danger";
}) {
  const color =
    accent === "success"
      ? "text-[color:var(--color-success)]"
      : accent === "danger"
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-fg)]";
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5">
      <div className="text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
