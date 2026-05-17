import type { AccountSummary } from "@/lib/repo";
import { fmtInr } from "@/lib/format";

export function AccountsCard({ accounts }: { accounts: AccountSummary[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Accounts</h3>
      {accounts.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">No accounts yet.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
              <th className="pb-2">Account</th>
              <th className="pb-2 text-right">Txns</th>
              <th className="pb-2 text-right">Out</th>
              <th className="pb-2 text-right">In</th>
              <th className="pb-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="py-2">
                  <div className="font-medium text-zinc-900 dark:text-zinc-50">
                    {a.bank} {a.type === "credit_card" ? "CC" : "Savings"}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
                    XX{a.last4}
                    {a.customerName ? ` · ${a.customerName}` : ""}
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">{a.txnCount}</td>
                <td className="py-2 text-right tabular-nums text-rose-700">
                  {fmtInr(a.totalOut)}
                </td>
                <td className="py-2 text-right tabular-nums text-emerald-700">
                  {fmtInr(a.totalIn)}
                </td>
                <td className="py-2 text-right tabular-nums font-medium">
                  {fmtInr(a.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
