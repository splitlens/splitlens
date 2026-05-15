import Link from "next/link";
import { getFriendsOverview, getCandidateShares } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { FriendBalanceChip } from "@/components/friends/FriendBalanceChip";
import { CandidateSuggestions } from "@/components/friends/CandidateSuggestions";
import { listKnownPeople } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FriendsPage() {
  const [friends, candidates, people] = await Promise.all([
    getFriendsOverview(),
    getCandidateShares(20),
    listKnownPeople(),
  ]);

  // Roll up the net into "they owe you" / "you owe them" totals so you can
  // see your overall position at a glance.
  let owedToYou = 0;
  let youOwe = 0;
  for (const f of friends) {
    if (f.net > 10) owedToYou += f.net;
    else if (f.net < -10) youOwe += Math.abs(f.net);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Friends
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {friends.length} {friends.length === 1 ? "person" : "people"} with transaction
            history · pick any to see the full breakdown.
          </p>
        </div>
      </header>

      {/* Position summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile
          label="Owed to you"
          value={fmtInr(owedToYou)}
          tone="positive"
        />
        <SummaryTile label="You owe" value={fmtInr(youOwe)} tone="negative" />
        <SummaryTile
          label="Net position"
          value={fmtInr(owedToYou - youOwe)}
          tone={owedToYou - youOwe >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Smart suggestions */}
      <CandidateSuggestions candidates={candidates} people={people} />

      {/* Friend cards */}
      {friends.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No friends identified yet. The rules engine matches counterparties to
            the registry at ingest time — add new patterns and re-ingest to see
            people appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {friends.map((f) => (
            <Link
              key={f.personId}
              href={`/friends/${f.personId}` as const}
              className="block rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    {f.displayName}
                  </div>
                  <div className="mt-0.5 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {f.relationship}
                  </div>
                </div>
                <FriendBalanceChip net={f.net} displayName={f.displayName} size="sm" />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <Stat label="You paid (direct)" value={fmtInr(f.directOut)} />
                <Stat label="They paid you" value={fmtInr(f.directIn)} />
                <Stat
                  label="Their share of yours"
                  value={fmtInr(f.sharedOwed)}
                  sub={f.sharedTxnCount > 0 ? `${f.sharedTxnCount} shared` : undefined}
                />
                <Stat
                  label="Last txn"
                  value={f.lastTxnDate ? fmtDate(f.lastTxnDate) : "—"}
                />
              </dl>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative";
}) {
  const toneCls =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-rose-700 dark:text-rose-400";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
        {sub && (
          <span className="ml-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-500">
            {sub}
          </span>
        )}
      </dd>
    </div>
  );
}
