import Link from "next/link";
import { notFound } from "next/navigation";
import { getFriendDetail } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { Ico } from "@/components/Ico";
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
  const totalTxns = person.directTxnCount + person.sharedTxnCount;
  const first = person.displayName.split(" ")[0] ?? person.displayName;
  const isSettled = Math.abs(person.net) < 10;

  return (
    <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero */}
      <div style={{ padding: "24px 40px 18px" }}>
        <Link
          href="/friends"
          className="btn btn-sm ghost"
          style={{ marginBottom: 14 }}
        >
          <Ico name="arrow-left" size={13} /> Back to Friends
        </Link>

        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-3" style={{ flex: 1, minWidth: 320 }}>
            <div className="flex items-center gap-3">
              <span className="eyebrow eyebrow-accent">Friend · the ledger</span>
              <span className="tag">
                Friends<span className="muted-2">/</span>
                {person.displayName}
                <span className="muted-2">/</span>
                {totalTxns} txn{totalTxns === 1 ? "" : "s"}
              </span>
            </div>
            <h1 className="hero-display" style={{ fontSize: 56, margin: 0 }}>
              {person.displayName}
              {isSettled ? (
                <span className="muted">. Settled up.</span>
              ) : person.net > 0 ? (
                <>
                  <span className="muted"> owes you </span>
                  <span style={{ fontStyle: "italic", color: "var(--credit)" }}>
                    {fmtInr(Math.abs(person.net))}
                  </span>
                  .
                </>
              ) : (
                <>
                  <span className="muted">: you owe </span>
                  <span style={{ fontStyle: "italic", color: "var(--debit)" }}>
                    {fmtInr(Math.abs(person.net))}
                  </span>
                  .
                </>
              )}
            </h1>
            <div className="body" style={{ maxWidth: 720 }}>
              <span className="fg-2">{person.relationship}</span> ·{" "}
              {totalTxns} transaction{totalTxns === 1 ? "" : "s"} on record
              {person.lastTxnDate ? (
                <>
                  {" · last on "}
                  <span className="fg-2">{fmtDate(person.lastTxnDate)}</span>
                </>
              ) : null}
              .
            </div>
          </div>

          <div className="flex flex-col items-end gap-2" style={{ minWidth: 240 }}>
            <FriendBalanceChip
              net={person.net}
              displayName={person.displayName}
              size="lg"
            />
            <span className="tiny muted">
              <Ico name="users" size={13} /> {person.directTxnCount} direct ·{" "}
              {person.sharedTxnCount} shared
            </span>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div
        style={{
          margin: "0 40px",
          padding: "14px 22px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          alignItems: "center",
          gap: 24,
        }}
      >
        <StatCol
          label="You paid direct"
          value={fmtInr(person.directOut)}
          sub="UPI / transfers from you"
          cls="debit"
        />
        <StatCol
          label="They paid you"
          value={fmtInr(person.directIn)}
          sub="UPI / transfers from them"
          cls="credit"
        />
        <StatCol
          label="Their share of yours"
          value={fmtInr(person.sharedOwed)}
          sub={`${person.sharedTxnCount} shared expense${person.sharedTxnCount === 1 ? "" : "s"}`}
        />
        <StatCol
          label="Net"
          value={fmtInr(Math.abs(person.net))}
          sub={
            isSettled
              ? "Settled"
              : person.net > 0
              ? `${first} owes you`
              : `You owe ${first}`
          }
          cls={isSettled ? "" : person.net > 0 ? "credit" : "debit"}
        />
      </div>

      {/* Activity timeline (interactive) */}
      <div style={{ padding: "20px 40px 40px" }}>
        <FriendDetailTimeline
          person={person}
          directTxns={directTxns}
          sharedTxns={sharedTxns}
          people={people}
        />
      </div>
    </main>
  );
}

function StatCol({
  label,
  value,
  sub,
  cls = "",
}: {
  label: string;
  value: string;
  sub: string;
  cls?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={`num-amount ${cls}`} style={{ fontSize: 26 }}>
          {value}
        </span>
      </div>
      <span className="tiny">{sub}</span>
    </div>
  );
}
