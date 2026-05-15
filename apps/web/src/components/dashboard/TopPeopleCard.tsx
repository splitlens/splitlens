import type { PeopleSummary } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";

export function TopPeopleCard({ people }: { people: PeopleSummary[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">People you transact with</h3>
      {people.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
          No identified people yet — add patterns to the registry to start tracking flatmates / family.
        </p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
              <th className="pb-2">Person</th>
              <th className="pb-2 text-right">Txns</th>
              <th className="pb-2 text-right">Sent</th>
              <th className="pb-2 text-right">Received</th>
              <th className="pb-2 text-right">Net</th>
              <th className="pb-2 text-right">Last</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {people.map((p) => (
              <tr key={p.personId}>
                <td className="py-2">
                  <div className="font-medium text-zinc-900 dark:text-zinc-50">{p.displayName}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{p.relationship}</div>
                </td>
                <td className="py-2 text-right tabular-nums">{p.txnCount}</td>
                <td className="py-2 text-right tabular-nums text-rose-700">
                  {fmtInr(p.totalSent)}
                </td>
                <td className="py-2 text-right tabular-nums text-emerald-700">
                  {fmtInr(p.totalReceived)}
                </td>
                <td
                  className={`py-2 text-right tabular-nums font-medium ${p.net > 0 ? "text-rose-700" : p.net < 0 ? "text-emerald-700" : "text-zinc-700 dark:text-zinc-300"}`}
                  title={p.net > 0 ? "You've sent more than you've received." : "They've sent more than you've sent."}
                >
                  {fmtInr(p.net)}
                </td>
                <td className="py-2 text-right text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
                  {p.lastTxnDate ? fmtDate(p.lastTxnDate) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
