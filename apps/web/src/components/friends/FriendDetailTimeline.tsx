"use client";

import { useMemo, useState } from "react";
import type {
  DrillDownTxn,
  FriendOverviewRow,
  ItemEnrichment,
} from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { Ico } from "@/components/Ico";
import { ShareTxnModal, type PersonOption } from "./ShareTxnModal";

type SharedTxn = DrillDownTxn & {
  shareCount: number;
  sharedWith: string[];
  perHead: number;
};

type Row =
  | { kind: "direct"; key: string; date: string; time: string | null; txn: DrillDownTxn }
  | { kind: "shared"; key: string; date: string; time: string | null; txn: SharedTxn };

/**
 * Per-friend activity stream. Merges direct UPI flows with their share of
 * your shared expenses, sorted newest-first. Each row knows which side of
 * the ledger it's on (you sent / they sent / they share / you share) so
 * the user can scan their relationship history at a glance.
 *
 * Click any row to open the share modal — either to mark a fresh row or to
 * adjust an existing split.
 */
export function FriendDetailTimeline({
  person,
  directTxns,
  sharedTxns,
  people,
}: {
  person: FriendOverviewRow;
  directTxns: DrillDownTxn[];
  sharedTxns: SharedTxn[];
  people: PersonOption[];
}) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [filter, setFilter] = useState<"all" | "direct" | "shared">("all");

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...directTxns.map((t) => ({
        kind: "direct" as const,
        key: `d-${t.id}`,
        date: t.txnDate,
        time: t.txnTime,
        txn: t,
      })),
      ...sharedTxns.map((t) => ({
        kind: "shared" as const,
        key: `s-${t.id}`,
        date: t.txnDate,
        time: t.txnTime,
        txn: t,
      })),
    ];
    all.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.time ?? "00:00").localeCompare(a.time ?? "00:00");
    });
    if (filter === "all") return all;
    return all.filter((r) => r.kind === filter);
  }, [directTxns, sharedTxns, filter]);

  function openShareModal(r: Row) {
    setEditing(r);
  }

  const counts = {
    all: directTxns.length + sharedTxns.length,
    direct: directTxns.length,
    shared: sharedTxns.length,
  } as const;

  return (
    <div className="surface flex flex-col" style={{ padding: 18, gap: 12 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Ico name="book" size={13} className="accent" />
          <span className="eyebrow">Activity</span>
        </div>
        <div
          className="flex items-center"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            padding: 2,
            gap: 2,
          }}
        >
          {(["all", "direct", "shared"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="capitalize"
              style={{
                padding: "4px 10px",
                background:
                  filter === f ? "var(--surface)" : "transparent",
                border: "none",
                borderRadius: 5,
                fontFamily: "inherit",
                fontSize: 11.5,
                cursor: "pointer",
                color: filter === f ? "var(--fg)" : "var(--muted)",
              }}
            >
              {f}{" "}
              <span className="mono tabular muted-2" style={{ marginLeft: 2 }}>
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <hr className="hr-dashed" />

      {rows.length === 0 ? (
        <div
          className="surface-dashed flex flex-col items-center justify-center"
          style={{ padding: 32, gap: 8 }}
        >
          <Ico name="inbox" size={20} className="muted" />
          <span className="small muted">No matching activity.</span>
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => openShareModal(r)}
                className="flex items-center justify-between gap-3"
                style={{
                  width: "100%",
                  padding: "10px 8px",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px dashed var(--border-dashed)",
                  cursor: "pointer",
                  color: "inherit",
                  fontFamily: "inherit",
                }}
              >
                <div
                  className="flex items-center gap-3"
                  style={{ minWidth: 0, flex: 1 }}
                >
                  <RowTypePill row={r} personDisplayName={person.displayName} />
                  <div className="flex flex-col" style={{ minWidth: 0, gap: 2 }}>
                    <span
                      className="fg-2"
                      style={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.txn.counterparty || r.txn.narration || "—"}
                    </span>
                    <div className="flex items-center gap-2 tiny muted">
                      <span>{fmtDate(r.date)}</span>
                      {r.time && (
                        <span className="mono tabular">{r.time}</span>
                      )}
                      {r.txn.category && (
                        <span className="chip chip-sm ghost" style={{ fontSize: 10 }}>
                          {r.txn.category}
                        </span>
                      )}
                      {r.kind === "shared" && (
                        <span className="chip chip-sm accent" style={{ fontSize: 10 }}>
                          <Ico name="split" size={13} /> {r.txn.shareCount}-way
                        </span>
                      )}
                    </div>
                    {r.txn.items && r.txn.items.items.length > 0 && (
                      <ItemList items={r.txn.items} />
                    )}
                  </div>
                </div>
                <RowAmount row={r} personDisplayName={person.displayName} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ShareTxnModal
          txn={{
            id: editing.txn.id,
            txnDate: editing.txn.txnDate,
            txnTime: editing.txn.txnTime,
            amount: editing.txn.withdrawal ?? editing.txn.deposit ?? 0,
            counterparty: editing.txn.counterparty,
            narration: editing.txn.narration,
            category: editing.txn.category,
            initialSharedWith:
              editing.kind === "shared" ? editing.txn.sharedWith : undefined,
          }}
          people={people}
          onClose={() => setEditing(null)}
          onSubmitted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowTypePill({ row, personDisplayName }: { row: Row; personDisplayName: string }) {
  const first = personDisplayName.split(" ")[0];
  if (row.kind === "direct") {
    if (row.txn.withdrawal != null) {
      return (
        <span
          className="chip chip-sm"
          style={{
            flexShrink: 0,
            fontSize: 10,
            color: "var(--debit)",
            borderColor: "var(--debit)",
            background: "color-mix(in srgb, var(--debit) 6%, transparent)",
          }}
        >
          <Ico name="arrow-right" size={13} /> You → {first}
        </span>
      );
    }
    return (
      <span
        className="chip chip-sm"
        style={{
          flexShrink: 0,
          fontSize: 10,
          color: "var(--credit)",
          borderColor: "var(--credit)",
          background: "color-mix(in srgb, var(--credit) 6%, transparent)",
        }}
      >
        <Ico name="arrow-left" size={13} /> {first} → You
      </span>
    );
  }
  return (
    <span
      className="chip chip-sm accent"
      style={{ flexShrink: 0, fontSize: 10 }}
    >
      <Ico name="split" size={13} /> Shared
    </span>
  );
}

const ITEM_ICON: Record<string, "split" | "book" | "users" | "sparkles"> = {
  instamart: "users",
  zomato_dining: "users",
  zomato_delivery: "users",
};

/**
 * Inline item-level breakdown for Swiggy / Zomato shared / direct rows.
 * Mirrors the dashboard's DayDetailModal styling so the same visual lives
 * in both surfaces.
 */
function ItemList({ items }: { items: ItemEnrichment }) {
  const MAX = 5;
  const head = items.items.slice(0, MAX);
  const extra = items.items.length - head.length;
  const iconName = ITEM_ICON[items.kind] ?? "sparkles";

  return (
    <div
      className="flex items-baseline tiny muted"
      style={{ flexWrap: "wrap", gap: "0 6px", marginTop: 2 }}
    >
      <Ico name={iconName} size={13} />
      {items.restaurant && (
        <span className="fg-2" style={{ fontWeight: 500 }}>
          {items.restaurant.split(",")[0]}
        </span>
      )}
      {head.map((it, i) => (
        <span key={`${it.name}-${i}`} style={{ whiteSpace: "nowrap" }}>
          {i === 0 && !items.restaurant ? "" : "·"} {it.name}
          {it.qty > 1 ? ` ×${it.qty}` : ""}
        </span>
      ))}
      {extra > 0 && (
        <span className="muted-2" style={{ fontStyle: "italic" }}>
          + {extra} more
        </span>
      )}
    </div>
  );
}

function RowAmount({ row, personDisplayName }: { row: Row; personDisplayName: string }) {
  const first = personDisplayName.split(" ")[0];
  if (row.kind === "direct") {
    if (row.txn.withdrawal != null) {
      return (
        <div
          className="flex flex-col items-end"
          style={{ flexShrink: 0, gap: 2 }}
        >
          <span className="num-amount debit" style={{ fontSize: 14 }}>
            −{fmtInr(row.txn.withdrawal)}
          </span>
        </div>
      );
    }
    return (
      <div
        className="flex flex-col items-end"
        style={{ flexShrink: 0, gap: 2 }}
      >
        <span className="num-amount credit" style={{ fontSize: 14 }}>
          +{fmtInr(row.txn.deposit ?? 0)}
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col items-end"
      style={{ flexShrink: 0, gap: 2 }}
    >
      <span className="mono tabular fg-2" style={{ fontSize: 14 }}>
        {fmtInr(row.txn.withdrawal ?? 0)}
      </span>
      <span className="tiny muted">
        {first}: <span className="mono">{fmtInr(row.txn.perHead)}</span>
      </span>
    </div>
  );
}
