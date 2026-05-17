import type { AutopayPair } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";

/**
 * The cross-account links the autopay matcher found: a savings AUTOPAY debit
 * paired with the CC AUTOPAY THANK YOU credit it funded. Two ledger entries,
 * one real money movement — the user's "single transactions at the core"
 * principle made visible.
 */
export function AutopayLinks({ pairs }: { pairs: AutopayPair[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Autopay links</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">savings ↔ credit-card pairs</span>
      </div>
      {pairs.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
          No autopay links yet. They appear once both the savings and CC
          statements for the same billing month are ingested.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {pairs.map((p) => (
            <li
              key={p.pairId}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-100 dark:border-zinc-800 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-700 ring-1 ring-violet-200">
                  {p.fromAccount}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-zinc-400 dark:text-zinc-500"
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700 ring-1 ring-rose-200">
                  {p.toAccount}
                </span>
                <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{fmtDate(p.txnDate)}</span>
              </div>
              <span className="text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                {fmtInr(p.amount)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
