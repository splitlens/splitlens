"use client";

import { fmtDate, fmtInr } from "../lib/format";

export interface RowLike {
  txnDate: string;
  narration: string;
  withdrawal?: number | null;
  deposit?: number | null;
  closingBalance?: number;
}

export function TransactionTable({ rows, max = 50 }: { rows: RowLike[]; max?: number }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center text-[color:var(--color-muted)]">
        No transactions parsed.
      </div>
    );
  }
  const visible = rows.slice(0, max);
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
      <div className="border-b border-[color:var(--color-border)] px-4 py-3 text-sm text-[color:var(--color-muted)]">
        Showing {visible.length} of {rows.length} transactions
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black/20 text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
            <tr>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Narration</th>
              <th className="px-4 py-2 text-right">Out</th>
              <th className="px-4 py-2 text-right">In</th>
              <th className="px-4 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="border-[color:var(--color-border)]/50 border-t">
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                  {fmtDate(row.txnDate)}
                </td>
                <td className="px-4 py-2">
                  <span className="line-clamp-1 font-mono text-xs">{row.narration}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[color:var(--color-danger)]">
                  {row.withdrawal ? fmtInr(row.withdrawal) : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[color:var(--color-success)]">
                  {row.deposit ? fmtInr(row.deposit) : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[color:var(--color-muted)]">
                  {row.closingBalance !== undefined ? fmtInr(row.closingBalance) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
