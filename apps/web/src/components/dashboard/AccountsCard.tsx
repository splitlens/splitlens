import type { AccountSummary } from "@/lib/repo";
import { fmtInr } from "@/lib/format";

export function AccountsCard({ accounts }: { accounts: AccountSummary[] }) {
  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex flex-col gap-1" style={{ marginBottom: 12 }}>
        <span className="eyebrow">Accounts</span>
        <h3 className="h2">Across {accounts.length} ledger{accounts.length === 1 ? "" : "s"}</h3>
      </div>
      {accounts.length === 0 ? (
        <p className="small">No accounts yet.</p>
      ) : (
        <table className="w-full" style={{ fontSize: 13.5 }}>
          <thead>
            <tr>
              <th
                className="eyebrow"
                style={{ textAlign: "left", paddingBottom: 8 }}
              >
                Account
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", paddingBottom: 8 }}
              >
                Txns
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
              >
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr
                key={a.id}
                style={{ borderTop: "1px dashed var(--border-dashed)" }}
              >
                <td style={{ padding: "10px 0", verticalAlign: "top" }}>
                  <div
                    style={{
                      fontSize: 14,
                      color: "var(--fg)",
                      fontWeight: 500,
                    }}
                  >
                    {a.bank} {a.type === "credit_card" ? "CC" : "Savings"}
                  </div>
                  <div className="tiny" style={{ marginTop: 2 }}>
                    XX{a.last4}
                    {a.customerName ? ` · ${a.customerName}` : ""}
                  </div>
                </td>
                <td
                  className="num-amount"
                  style={{
                    textAlign: "right",
                    padding: "10px 0",
                    fontSize: 13,
                  }}
                >
                  {a.txnCount}
                </td>
                <td
                  className="num-amount debit"
                  style={{ textAlign: "right", padding: "10px 0" }}
                >
                  {fmtInr(a.totalOut)}
                </td>
                <td
                  className="num-amount credit"
                  style={{ textAlign: "right", padding: "10px 0" }}
                >
                  {fmtInr(a.totalIn)}
                </td>
                <td
                  className="num-amount"
                  style={{ textAlign: "right", padding: "10px 0" }}
                >
                  {fmtInr(a.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
