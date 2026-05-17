import Link from "next/link";
import type { RecentTxn } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { KindBadge } from "./TopCounterparties";
import { ShareTxnButton } from "@/components/friends/ShareTxnButton";
import { FindEmailsButton } from "@/components/friends/FindEmailsButton";
import type { PersonOption } from "@/components/friends/ShareTxnModal";
import { getCategory } from "@/lib/taxonomy";

/**
 * Build the /merchants/[id] target for a recent row. Prefer the personId
 * (the page resolver tries that first) so person rows route to the Person
 * view; fall back to counterparty name for businesses.
 */
function merchantHrefFor(t: RecentTxn): string | null {
  if (t.personId) return `/merchants/${encodeURIComponent(t.personId)}`;
  if (t.counterparty) return `/merchants/${encodeURIComponent(t.counterparty)}`;
  return null;
}

/**
 * The last N transactions. Prefers the clean `counterparty` over raw bank
 * narration. Shows the kind badge, a multi-source indicator dot when more
 * than one source has observed this row, and a per-row "Split…" button for
 * outgoing transactions so any txn can be flagged as a shared expense.
 */
export function RecentTxnsCard({
  txns,
  people,
}: {
  txns: RecentTxn[];
  people: PersonOption[];
}) {
  if (txns.length === 0) {
    return (
      <div className="surface" style={{ padding: 20 }}>
        <span className="eyebrow">Recent transactions</span>
        <p className="small" style={{ marginTop: 8 }}>
          No transactions yet.
        </p>
      </div>
    );
  }

  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Recent transactions</span>
          <h3 className="h2">The last {txns.length}, freshest first</h3>
        </div>
        <span className="tag mono">last {txns.length}</span>
      </div>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table className="w-full" style={{ fontSize: 13.5 }}>
          <thead>
            <tr>
              <th
                className="eyebrow"
                style={{ textAlign: "left", paddingBottom: 8 }}
              >
                Date
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "left", paddingBottom: 8 }}
              >
                Counterparty / narration
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "left", paddingBottom: 8 }}
              >
                Category
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", paddingBottom: 8 }}
              >
                Out
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", paddingBottom: 8 }}
              >
                In
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", paddingBottom: 8 }}
              />
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => {
              const label = t.counterparty || t.narration || "—";
              const isShort = label.length <= 60;
              const href = merchantHrefFor(t);
              const def = getCategory(t.category);
              return (
                <tr
                  key={t.id}
                  style={{
                    borderTop: "1px dashed var(--border-dashed)",
                  }}
                >
                  <td
                    style={{
                      whiteSpace: "nowrap",
                      padding: "10px 0",
                      verticalAlign: "top",
                      color: "var(--fg-2)",
                    }}
                  >
                    <div>{fmtDate(t.txnDate)}</div>
                    {t.txnTime && (
                      <div
                        className="tiny mono tabular"
                        style={{ marginTop: 2 }}
                      >
                        {t.txnTime}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 8px 10px 0", verticalAlign: "top" }}>
                    <div className="flex items-center gap-2">
                      {href ? (
                        <Link
                          href={href}
                          title={`Open ${label} detail`}
                          className={`${isShort ? "" : "truncate"} hover:underline`}
                          style={{
                            minWidth: 0,
                            maxWidth: isShort ? undefined : "36rem",
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--fg)",
                            textDecoration: "none",
                          }}
                        >
                          {label}
                        </Link>
                      ) : (
                        <span
                          title={label}
                          className={isShort ? undefined : "truncate"}
                          style={{
                            minWidth: 0,
                            maxWidth: isShort ? undefined : "36rem",
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--fg)",
                          }}
                        >
                          {label}
                        </span>
                      )}
                      {t.counterpartyKind && (
                        <KindBadge kind={t.counterpartyKind} />
                      )}
                      {t.sourceCount > 1 && (
                        <span
                          className="dot credit"
                          title={`Enriched by ${t.sourceCount} sources`}
                          style={{ width: 8, height: 8 }}
                          aria-hidden
                        />
                      )}
                    </div>
                    {t.counterparty &&
                      t.narration &&
                      t.counterparty !== t.narration && (
                        <div
                          className="tiny truncate"
                          style={{ marginTop: 2 }}
                          title={t.narration}
                        >
                          {t.narration}
                        </div>
                      )}
                  </td>
                  <td style={{ padding: "10px 0", verticalAlign: "top" }}>
                    {t.category ? (
                      <span className="chip chip-sm">
                        <span aria-hidden>{def.emoji}</span>
                        {t.category}
                      </span>
                    ) : (
                      <span className="tiny muted-2">—</span>
                    )}
                  </td>
                  <td
                    className="num-amount debit"
                    style={{
                      textAlign: "right",
                      padding: "10px 0",
                      verticalAlign: "top",
                    }}
                  >
                    {t.withdrawal != null ? fmtInr(t.withdrawal) : ""}
                  </td>
                  <td
                    className="num-amount credit"
                    style={{
                      textAlign: "right",
                      padding: "10px 0",
                      verticalAlign: "top",
                    }}
                  >
                    {t.deposit != null ? fmtInr(t.deposit) : ""}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      padding: "10px 0",
                      verticalAlign: "top",
                    }}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <FindEmailsButton
                        txnId={t.id}
                        label={label}
                        amount={t.withdrawal ?? t.deposit}
                      />
                      <ShareTxnButton
                        txn={{
                          id: t.id,
                          txnDate: t.txnDate,
                          txnTime: t.txnTime,
                          withdrawal: t.withdrawal,
                          counterparty: t.counterparty,
                          narration: t.narration,
                          category: t.category,
                          initialSharedWith: t.sharedWith,
                        }}
                        people={people}
                        isShared={t.sharedWith.length > 0}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
