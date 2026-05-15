import type { RecentTxn } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { KindBadge } from "./TopCounterparties";

/**
 * The last N transactions. Prefers the clean `counterparty` over raw bank
 * narration. Shows the kind badge and a multi-source indicator dot when more
 * than one source has observed this row.
 */
export function RecentTxnsCard({ txns }: { txns: RecentTxn[] }) {
  if (txns.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent transactions</h3>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">No transactions yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent transactions</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">last {txns.length}</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
              <th className="pb-2">Date</th>
              <th className="pb-2">Counterparty / narration</th>
              <th className="pb-2">Category</th>
              <th className="pb-2 text-right">Out</th>
              <th className="pb-2 text-right">In</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {txns.map((t) => {
              const label = t.counterparty || t.narration || "—";
              const isShort = label.length <= 60;
              return (
                <tr key={t.id}>
                  <td className="whitespace-nowrap py-2 align-top text-zinc-700 dark:text-zinc-300">
                    <div>{fmtDate(t.txnDate)}</div>
                    {t.txnTime && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 tabular-nums">{t.txnTime}</div>
                    )}
                  </td>
                  <td className="py-2 align-top">
                    <div className="flex items-center gap-2">
                      <span
                        className={`min-w-0 ${isShort ? "" : "max-w-[36rem] truncate"} font-medium text-zinc-900 dark:text-zinc-50`}
                        title={label}
                      >
                        {label}
                      </span>
                      {t.counterpartyKind && <KindBadge kind={t.counterpartyKind} />}
                      {t.sourceCount > 1 && (
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-emerald-500"
                          title={`Enriched by ${t.sourceCount} sources`}
                        />
                      )}
                    </div>
                    {t.counterparty && t.narration && t.counterparty !== t.narration && (
                      <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500" title={t.narration}>
                        {t.narration}
                      </div>
                    )}
                  </td>
                  <td className="py-2 align-top">
                    {t.category ? (
                      <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-700 dark:text-zinc-300">
                        {t.category}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="py-2 align-top text-right tabular-nums text-rose-700">
                    {t.withdrawal != null ? fmtInr(t.withdrawal) : ""}
                  </td>
                  <td className="py-2 align-top text-right tabular-nums text-emerald-700">
                    {t.deposit != null ? fmtInr(t.deposit) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
