import Link from "next/link";
import { notFound } from "next/navigation";
import { getFriendDetail } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { FriendBalanceChip } from "@/components/friends/FriendBalanceChip";
import { FriendDetailTimeline } from "@/components/friends/FriendDetailTimeline";
import { listKnownPeople } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ personId: string }>;
}

export default async function FriendDetailPage({ params }: PageProps) {
  const { personId } = await params;
  const [detail, people] = await Promise.all([
    getFriendDetail(personId),
    listKnownPeople(),
  ]);
  if (!detail) notFound();

  const { person, directTxns, sharedTxns } = detail;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <Link
          href="/friends"
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          ← Back to Friends
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {person.displayName}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {person.relationship} ·{" "}
              {person.directTxnCount + person.sharedTxnCount} transaction
              {person.directTxnCount + person.sharedTxnCount === 1 ? "" : "s"} on record
              {person.lastTxnDate ? ` · last on ${fmtDate(person.lastTxnDate)}` : ""}
            </p>
          </div>
          <FriendBalanceChip net={person.net} displayName={person.displayName} size="lg" />
        </div>
      </header>

      {/* Balance breakdown */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BreakdownTile
          label="You paid direct"
          value={fmtInr(person.directOut)}
          hint="UPI / transfers from you"
        />
        <BreakdownTile
          label="They paid you"
          value={fmtInr(person.directIn)}
          hint="UPI / transfers from them"
        />
        <BreakdownTile
          label="Their share of yours"
          value={fmtInr(person.sharedOwed)}
          hint={`${person.sharedTxnCount} shared expense${person.sharedTxnCount === 1 ? "" : "s"}`}
        />
        <BreakdownTile
          label="Net"
          value={fmtInr(Math.abs(person.net))}
          tone={person.net > 10 ? "positive" : person.net < -10 ? "negative" : "neutral"}
          hint={
            Math.abs(person.net) < 10
              ? "Settled"
              : person.net > 0
                ? `${person.displayName.split(" ")[0]} owes you`
                : `You owe ${person.displayName.split(" ")[0]}`
          }
        />
      </div>

      {/* Activity timeline (interactive) */}
      <FriendDetailTimeline
        person={person}
        directTxns={directTxns}
        sharedTxns={sharedTxns}
        people={people}
      />
    </main>
  );
}

function BreakdownTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneCls =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-700 dark:text-rose-400"
        : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">{hint}</div>
      )}
    </div>
  );
}
