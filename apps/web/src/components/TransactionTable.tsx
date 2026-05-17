"use client";

import { DEFAULT_PEOPLE } from "@splitlens/core";
import { fmtDate, fmtInr } from "../lib/format";
import { Ico, type IcoName } from "./Ico";
import { getCategory } from "../lib/taxonomy";

/**
 * Lightweight transaction table for the upload/try flow. Mirrors the look of
 * the dashboard's RecentTxnsCard — dashed-divider rows, category chip from
 * the canonical taxonomy, amounts in `.num-amount`, header cells in
 * `.eyebrow`. The component is currently unwired in the main app, but kept
 * here for the try-page (one-off statement preview) and for any future
 * surfaces that want a plain table.
 */

export function CategoryPill({ category }: { category?: string | null }) {
  const cat = category ?? "Uncategorized";
  const def = getCategory(cat);
  const group = (cat.split(":")[0] ?? cat) as string;
  const sub = cat.includes(":") ? cat.slice(cat.indexOf(":") + 1) : null;
  return (
    <span
      title={cat}
      className="chip chip-sm"
      style={{ maxWidth: 200, overflow: "hidden", fontSize: 11 }}
    >
      <span aria-hidden>{def.emoji}</span>
      <span style={{ fontWeight: 500 }}>{group}</span>
      {sub && <span className="muted-2">· {sub}</span>}
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

const RELATIONSHIP_ICON: Record<string, IcoName> = {
  family: "users",
  friend: "users",
  flatmate: "users",
  partner: "user",
  colleague: "user",
  domestic_help: "user",
  other: "user",
};

export function PersonChip({ personId }: { personId?: string | null }) {
  if (!personId) return null;
  const person = DEFAULT_PEOPLE.find((p) => p.id === personId);
  if (!person) return null;
  const icon = RELATIONSHIP_ICON[person.relationship] ?? "user";
  return (
    <span
      title={`${person.displayName} · ${person.relationship}`}
      className="chip chip-sm"
      style={{ fontSize: 10 }}
    >
      <Ico name={icon} size={13} />
      <span style={{ fontWeight: 500 }}>{person.displayName}</span>
    </span>
  );
}

export function TransactionTable({
  rows,
  max = 50,
}: {
  rows: RowLike[];
  max?: number;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="surface-dashed flex items-center justify-center muted small"
        style={{ padding: 32, textAlign: "center" }}
      >
        No transactions parsed.
      </div>
    );
  }
  const visible = rows.slice(0, max);
  return (
    <div className="surface" style={{ overflow: "hidden" }}>
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span className="eyebrow">Parsed rows</span>
        <span className="tag mono">
          {visible.length} of {rows.length}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="w-full" style={{ fontSize: 13.5 }}>
          <thead>
            <tr>
              <th
                className="eyebrow"
                style={{ textAlign: "left", padding: "10px 16px" }}
              >
                Date
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "left", padding: "10px 16px" }}
              >
                Narration
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "left", padding: "10px 16px" }}
              >
                Category
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", padding: "10px 16px" }}
              >
                Out
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", padding: "10px 16px" }}
              >
                In
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", padding: "10px 16px" }}
              >
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={i}
                style={{ borderTop: "1px dashed var(--border-dashed)" }}
              >
                <td
                  className="mono tabular"
                  style={{
                    whiteSpace: "nowrap",
                    padding: "10px 16px",
                    fontSize: 12,
                    color: "var(--fg-2)",
                  }}
                >
                  {fmtDate(row.txnDate)}
                </td>
                <td style={{ padding: "10px 16px" }}>
                  <div className="flex flex-col" style={{ gap: 4 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 12,
                        color: "var(--fg)",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {row.narration}
                    </span>
                    {row.personId && <PersonChip personId={row.personId} />}
                  </div>
                </td>
                <td style={{ padding: "10px 16px" }}>
                  <CategoryPill category={row.category} />
                </td>
                <td
                  className="num-amount debit"
                  style={{
                    whiteSpace: "nowrap",
                    padding: "10px 16px",
                    textAlign: "right",
                  }}
                >
                  {row.withdrawal ? fmtInr(row.withdrawal) : ""}
                </td>
                <td
                  className="num-amount credit"
                  style={{
                    whiteSpace: "nowrap",
                    padding: "10px 16px",
                    textAlign: "right",
                  }}
                >
                  {row.deposit ? fmtInr(row.deposit) : ""}
                </td>
                <td
                  className="num-amount muted"
                  style={{
                    whiteSpace: "nowrap",
                    padding: "10px 16px",
                    textAlign: "right",
                  }}
                >
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
