"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getDashboardSummary,
  getAccountsWithSummary,
  getRecentTransactions,
  type DashboardSummary,
  type AccountSummary,
} from "@/lib/repo";
import { resetDb } from "@/lib/db";
import { TransactionTable } from "@/components/TransactionTable";
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
  }>;
  loading: boolean;
  error: string | null;
}

export default function DashboardPage() {
  const [state, setState] = useState<State>({
    summary: null,
    accounts: [],
    recent: [],
    loading: true,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [resetState, setResetState] = useState<"idle" | "confirming" | "running">("idle");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summary, accounts, recent] = await Promise.all([
          getDashboardSummary(),
          getAccountsWithSummary(),
          getRecentTransactions(100),
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
          })),
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
      <div className={`mt-1 text-3xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
