import type { PeopleSummary } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";

export function TopPeopleCard({ people }: { people: PeopleSummary[] }) {
  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex flex-col gap-1" style={{ marginBottom: 12 }}>
        <span className="eyebrow">People</span>
        <h3 className="h2">People you transact with</h3>
      </div>
      {people.length === 0 ? (
        <p className="small">
          No identified people yet — add patterns to the registry to start
          tracking flatmates / family.
        </p>
      ) : (
        <table className="w-full" style={{ fontSize: 13.5 }}>
          <thead>
            <tr>
              <th
                className="eyebrow"
                style={{ textAlign: "left", paddingBottom: 8 }}
              >
                Person
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
                Sent
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", paddingBottom: 8 }}
              >
                Received
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", paddingBottom: 8 }}
              >
                Net
              </th>
              <th
                className="eyebrow"
                style={{ textAlign: "right", paddingBottom: 8 }}
              >
                Last
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              // Positive net = you've sent more (debit color);
              // negative = they've sent more (credit color).
              const netCls =
                p.net > 0 ? "debit" : p.net < 0 ? "credit" : "";
              return (
                <tr
                  key={p.personId}
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
                      {p.displayName}
                    </div>
                    <div className="tiny" style={{ marginTop: 2 }}>
                      {p.relationship}
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
                    {p.txnCount}
                  </td>
                  <td
                    className="num-amount debit"
                    style={{ textAlign: "right", padding: "10px 0" }}
                  >
                    {fmtInr(p.totalSent)}
                  </td>
                  <td
                    className="num-amount credit"
                    style={{ textAlign: "right", padding: "10px 0" }}
                  >
                    {fmtInr(p.totalReceived)}
                  </td>
                  <td
                    className={`num-amount ${netCls}`}
                    style={{ textAlign: "right", padding: "10px 0" }}
                    title={
                      p.net > 0
                        ? "You've sent more than you've received."
                        : "They've sent more than you've sent."
                    }
                  >
                    {fmtInr(p.net)}
                  </td>
                  <td
                    className="tiny"
                    style={{ textAlign: "right", padding: "10px 0" }}
                  >
                    {p.lastTxnDate ? fmtDate(p.lastTxnDate) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
