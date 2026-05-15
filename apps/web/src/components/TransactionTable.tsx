"use client";

import { DEFAULT_PEOPLE } from "@splitlens/core";
import { fmtDate, fmtInr } from "../lib/format";

/** Group → Tailwind color class. Stable hashing across all surfaces. */
const GROUP_COLORS: Record<string, string> = {
  Income: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Investment: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Bills: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Household: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  Subscription: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Food: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Personal: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  Transport: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  Shopping: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  Health: "bg-red-500/15 text-red-300 border-red-500/30",
  Travel: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Cash: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  Charges: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  Transfer: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Uncategorized: "bg-neutral-700/40 text-neutral-400 border-neutral-700/60",
};

export function CategoryPill({ category }: { category?: string | null }) {
  const cat = category ?? "Uncategorized";
  const group = (cat.split(":")[0] ?? cat) as string;
  const sub = cat.includes(":") ? cat.slice(cat.indexOf(":") + 1) : null;
  const cls = GROUP_COLORS[group] ?? GROUP_COLORS.Uncategorized;
  return (
    <span
      title={cat}
      className={`inline-flex max-w-[180px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] ${cls}`}
    >
      <span className="font-semibold">{group}</span>
      {sub && <span className="opacity-80">· {sub}</span>}
    </span>
  );
}

export interface RowLike {
  txnDate: string;
  narration: string;
  withdrawal?: number | null;
  deposit?: number | null;
  closingBalance?: number | null;
  category?: string | null;
  personId?: string | null;
}

const RELATIONSHIP_EMOJI: Record<string, string> = {
  family: "👨‍👩‍👧",
  friend: "🧑‍🤝‍🧑",
  flatmate: "🏠",
  partner: "❤️",
  colleague: "🧑‍💼",
  domestic_help: "🧹",
  other: "👤",
};

export function PersonChip({ personId }: { personId?: string | null }) {
  if (!personId) return null;
  const person = DEFAULT_PEOPLE.find((p) => p.id === personId);
  if (!person) return null;
  const emoji = RELATIONSHIP_EMOJI[person.relationship] ?? "👤";
  return (
    <span
      title={`${person.displayName} · ${person.relationship}`}
      className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300"
    >
      <span>{emoji}</span>
      <span className="font-medium">{person.displayName}</span>
    </span>
  );
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
              <th className="px-4 py-2 text-left">Category</th>
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
                  <div className="flex flex-col gap-1">
                    <span className="line-clamp-1 font-mono text-xs">{row.narration}</span>
                    {row.personId && <PersonChip personId={row.personId} />}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <CategoryPill category={row.category} />
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[color:var(--color-danger)]">
                  {row.withdrawal ? fmtInr(row.withdrawal) : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[color:var(--color-success)]">
                  {row.deposit ? fmtInr(row.deposit) : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[color:var(--color-muted)]">
                  {row.closingBalance != null ? fmtInr(row.closingBalance) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
