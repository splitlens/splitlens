import type { TopCounterparty } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";

/**
 * Top counterparties by spend volume. Uses the cleaned-up PhonePe-style
 * counterparty name when available (instead of the raw bank narration).
 * Each row carries a kind badge that lets you eyeball what kind of
 * relationship it is at a glance.
 */
export function TopCounterparties({ rows }: { rows: TopCounterparty[] }) {
  if (rows.length === 0) {
    return <EmptyCard title="Top counterparties" hint="No counterparty data yet." />;
  }

  const maxSpend = rows.reduce(
    (m, r) => Math.max(m, r.totalOut + r.totalIn),
    1,
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Top counterparties</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">cleaned names from PhonePe / GPay</span>
      </div>
      <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((r) => {
          const total = r.totalOut + r.totalIn;
          const widthPct = Math.max(2, (total / maxSpend) * 100);
          return (
            <div key={r.counterparty} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50"
                    title={r.counterparty}
                  >
                    {r.counterparty}
                  </span>
                  <KindBadge kind={r.counterpartyKind} />
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                  {fmtInr(total)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
                <span>{r.txnCount} txns</span>
                <span>·</span>
                <span>
                  {fmtDate(r.firstSeen)} → {fmtDate(r.lastSeen)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const style = KIND_STYLE[kind] ?? KIND_STYLE.unknown!;
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${style.cls}`}
      title={style.title}
    >
      {style.label}
    </span>
  );
}

const KIND_STYLE: Record<string, { label: string; cls: string; title: string }> = {
  named: {
    label: "named",
    cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    title: "Counterparty is a person or branded merchant.",
  },
  vpa: {
    label: "VPA",
    cls: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
    title: "Counterparty was given as a UPI handle (e.g. merchant@axisbank).",
  },
  bill: {
    label: "bill",
    cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    title: "Bill payment (e.g. FASTag, electricity).",
  },
  self_transfer: {
    label: "self",
    cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
    title: "Moving money between your own accounts.",
  },
  unknown: {
    label: "?",
    cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 ring-1 ring-zinc-200",
    title: "Bank-only row — counterparty couldn't be classified.",
  },
};

function EmptyCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{hint}</p>
    </div>
  );
}
