import Link from "next/link";
import { getFriendsOverview, getCandidateShares } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { Ico } from "@/components/Ico";
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
  const netPosition = owedToYou - youOwe;

  // Sort friends so the largest live balances surface first; settled rows
  // sink to the bottom but remain visible for quick lookup.
  const sortedFriends = [...friends].sort((a, b) => {
    const aOpen = Math.abs(a.net) >= 10 ? 1 : 0;
    const bOpen = Math.abs(b.net) >= 10 ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return Math.abs(b.net) - Math.abs(a.net);
  });

  return (
    <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero */}
      <div style={{ padding: "28px 40px 22px" }}>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-3" style={{ flex: 1, minWidth: 320 }}>
            <div className="flex items-center gap-3">
              <span className="eyebrow eyebrow-accent">Friends · the ledger</span>
              <span className="tag">
                SplitLens<span className="muted-2">/</span>People
                <span className="muted-2">/</span>
                {friends.length} on record
              </span>
            </div>
            <h1 className="hero-display" style={{ fontSize: 60, margin: 0 }}>
              {friends.length === 0 ? (
                <>No friends on the ledger yet.</>
              ) : netPosition >= 10 ? (
                <>
                  You&rsquo;re up{" "}
                  <span style={{ fontStyle: "italic", color: "var(--credit)" }}>
                    {fmtInr(netPosition)}
                  </span>{" "}
                  across {friends.length} {friends.length === 1 ? "person" : "people"}.
                </>
              ) : netPosition <= -10 ? (
                <>
                  You owe{" "}
                  <span style={{ fontStyle: "italic", color: "var(--debit)" }}>
                    {fmtInr(Math.abs(netPosition))}
                  </span>{" "}
                  across {friends.length} {friends.length === 1 ? "person" : "people"}.
                </>
              ) : (
                <>
                  Settled across{" "}
                  <span style={{ fontStyle: "italic", color: "var(--accent)" }}>
                    {friends.length}
                  </span>{" "}
                  {friends.length === 1 ? "person" : "people"}.
                </>
              )}
            </h1>
            <div className="body" style={{ maxWidth: 720 }}>
              Everyone the rules engine matched against your transactions, with
              direct UPI flows and your share of shared spend rolled into one
              net per person. Pick any to see the full timeline.
            </div>
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
          label="Owed to you"
          value={fmtInr(owedToYou)}
          sub={`${friends.filter((f) => f.net > 10).length} people`}
          cls="credit"
        />
        <StatCol
          label="You owe"
          value={fmtInr(youOwe)}
          sub={`${friends.filter((f) => f.net < -10).length} people`}
          cls="debit"
        />
        <StatCol
          label="Net position"
          value={`${netPosition >= 0 ? "+" : "−"}${fmtInr(Math.abs(netPosition))}`}
          sub={netPosition >= 0 ? "in your favor" : "owed out"}
          cls={netPosition >= 0 ? "credit" : "debit"}
        />
        <StatCol
          label="People on file"
          value={String(friends.length)}
          sub={`${friends.filter((f) => Math.abs(f.net) < 10).length} settled`}
        />
      </div>

      {/* Smart suggestions */}
      <div style={{ padding: "20px 40px 0" }}>
        <CandidateSuggestions candidates={candidates} people={people} />
      </div>

      {/* Friend cards */}
      <div style={{ padding: "20px 40px 40px" }}>
        {friends.length === 0 ? (
          <div
            className="surface-dashed flex flex-col items-center justify-center"
            style={{ padding: 48, gap: 10 }}
          >
            <Ico name="users" size={20} className="muted" />
            <h2 className="h2" style={{ margin: 0 }}>
              No friends identified yet.
            </h2>
            <p className="small muted" style={{ margin: 0, maxWidth: 520, textAlign: "center" }}>
              The rules engine matches counterparties to the registry at ingest
              time — add new patterns and re-ingest to see people appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
              <span className="eyebrow">People · sorted by open balance</span>
              <span className="tag">
                <span className="mono fg-2">{sortedFriends.length}</span> total
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 16,
              }}
            >
              {sortedFriends.map((f) => (
                <FriendCard
                  key={f.personId}
                  personId={f.personId}
                  displayName={f.displayName}
                  relationship={f.relationship}
                  net={f.net}
                  directOut={f.directOut}
                  directIn={f.directIn}
                  sharedOwed={f.sharedOwed}
                  sharedTxnCount={f.sharedTxnCount}
                  lastTxnDate={f.lastTxnDate}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function FriendCard({
  personId,
  displayName,
  relationship,
  net,
  directOut,
  directIn,
  sharedOwed,
  sharedTxnCount,
  lastTxnDate,
}: {
  personId: string;
  displayName: string;
  relationship: string;
  net: number;
  directOut: number;
  directIn: number;
  sharedOwed: number;
  sharedTxnCount: number;
  lastTxnDate: string | null;
}) {
  const isOpen = Math.abs(net) >= 10;
  const sideAccent = isOpen && net > 0
    ? "var(--credit)"
    : isOpen && net < 0
    ? "var(--debit)"
    : "var(--border)";

  return (
    <Link
      href={`/friends/${personId}` as const}
      className="surface flex flex-col"
      style={{
        padding: 18,
        gap: 12,
        position: "relative",
        textDecoration: "none",
        color: "inherit",
        borderLeft: `2px solid ${sideAccent}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
          <span className="eyebrow">{relationship}</span>
          <span
            className="h2"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={displayName}
          >
            {displayName}
          </span>
        </div>
        <FriendBalanceChip net={net} displayName={displayName} size="sm" />
      </div>

      <hr className="hr-dashed" />

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 12px",
          margin: 0,
        }}
      >
        <StatLine label="You paid" value={fmtInr(directOut)} cls="debit" />
        <StatLine label="They paid" value={fmtInr(directIn)} cls="credit" />
        <StatLine
          label="Their share"
          value={fmtInr(sharedOwed)}
          sub={sharedTxnCount > 0 ? `${sharedTxnCount} shared` : undefined}
        />
        <StatLine
          label="Last seen"
          value={lastTxnDate ? fmtDate(lastTxnDate) : "—"}
        />
      </dl>

      <div className="flex items-center justify-between" style={{ marginTop: "auto" }}>
        <span className="tag">
          <Ico name="book" size={13} /> Open ledger
        </span>
        <Ico name="arrow-right" size={13} className="muted" />
      </div>
    </Link>
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
        <span className={`num-amount ${cls}`} style={{ fontSize: 28 }}>
          {value}
        </span>
      </div>
      <span className="tiny">{sub}</span>
    </div>
  );
}

function StatLine({
  label,
  value,
  sub,
  cls = "",
}: {
  label: string;
  value: string;
  sub?: string;
  cls?: string;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 1 }}>
      <dt className="tiny muted">{label}</dt>
      <dd
        className={`mono tabular ${cls || "fg-2"}`}
        style={{ fontSize: 13, margin: 0 }}
      >
        {value}
        {sub && (
          <span className="tiny muted-2" style={{ marginLeft: 4 }}>
            {sub}
          </span>
        )}
      </dd>
    </div>
  );
}
