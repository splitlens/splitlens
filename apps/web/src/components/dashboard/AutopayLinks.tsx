import type { AutopayPair } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { Ico } from "@/components/Ico";

/**
 * The cross-account links the autopay matcher found: a savings AUTOPAY debit
 * paired with the CC AUTOPAY THANK YOU credit it funded. Two ledger entries,
 * one real money movement — the user's "single transactions at the core"
 * principle made visible.
 */
export function AutopayLinks({ pairs }: { pairs: AutopayPair[] }) {
  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Autopay links</span>
          <h3 className="h2">Savings <span className="muted-2">↔</span> credit card</h3>
        </div>
      </div>
      {pairs.length === 0 ? (
        <p className="small" style={{ marginTop: 12 }}>
          No autopay links yet. They appear once both the savings and CC
          statements for the same billing month are ingested.
        </p>
      ) : (
        <ol
          className="flex flex-col"
          style={{ marginTop: 12, gap: 8, padding: 0, listStyle: "none" }}
        >
          {pairs.map((p) => (
            <li
              key={p.pairId}
              className="flex items-center justify-between gap-3"
              style={{
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <div className="flex items-center gap-2 fg-2">
                <span className="tag mono">{p.fromAccount}</span>
                <Ico name="arrow-right" size={13} className="muted-2" />
                <span className="tag mono">{p.toAccount}</span>
                <span className="muted small" style={{ marginLeft: 6 }}>
                  {fmtDate(p.txnDate)}
                </span>
              </div>
              <span className="num-amount" style={{ fontSize: 14 }}>
                {fmtInr(p.amount)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
