import Link from "next/link";

import type { TopCounterparty } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";

/**
 * Top counterparties by spend volume. Uses the cleaned-up PhonePe-style
 * counterparty name when available (instead of the raw bank narration).
 * Each row carries a kind badge that lets you eyeball what kind of
 * relationship it is at a glance.
 */
export function TopCounterparties({ rows }: { rows: TopCounterparty[] }) {
  if (rows.length === 0) {
    return (
      <EmptyCard
        title="Top counterparties"
        hint="No counterparty data yet."
      />
    );
  }

  const maxSpend = rows.reduce(
    (m, r) => Math.max(m, r.totalOut + r.totalIn),
    1,
  );

  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Top counterparties</span>
          <h3 className="h2">Who you pay the most</h3>
        </div>
        <span className="tiny muted">click a row to see all charges</span>
      </div>
      <div className="flex flex-col" style={{ marginTop: 12 }}>
        {rows.map((r, idx) => {
          const total = r.totalOut + r.totalIn;
          const widthPct = Math.max(2, (total / maxSpend) * 100);
          // Row click navigates to the dedicated merchant detail page,
          // which surfaces history, cadence, locations, items, and per-
          // person breakdowns. Previously this linked into /review with
          // a free-text filter — the merchant page is the more complete
          // drill-down now that it exists.
          const href = `/merchants/${encodeURIComponent(r.counterparty)}`;
          return (
            <Link
              key={r.counterparty}
              href={href}
              className="flex flex-col top-counterparty-row"
              aria-label={`Open ${r.counterparty} detail`}
              style={{
                padding: "10px 8px",
                margin: "0 -8px",
                gap: 6,
                borderTop:
                  idx === 0
                    ? "none"
                    : "1px dashed var(--border-dashed)",
                borderRadius: 6,
                textDecoration: "none",
                color: "inherit",
                transition: "background 0.12s ease",
              }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    title={r.counterparty}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 14,
                      color: "var(--fg)",
                      fontWeight: 500,
                    }}
                  >
                    {r.counterparty}
                  </span>
                  <KindBadge kind={r.counterpartyKind} />
                </div>
                <span
                  className="num-amount"
                  style={{ fontSize: 14, flexShrink: 0 }}
                >
                  {fmtInr(total)}
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  width: "100%",
                  overflow: "hidden",
                  borderRadius: 999,
                  background: "var(--surface-2)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${widthPct}%`,
                    background: "var(--accent)",
                    borderRadius: 999,
                  }}
                />
              </div>
              <div
                className="flex items-center gap-2 tiny"
                style={{ color: "var(--muted)" }}
              >
                <span>{r.txnCount} txns</span>
                <span className="muted-2">·</span>
                <span>
                  {fmtDate(r.firstSeen)} → {fmtDate(r.lastSeen)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const style = KIND_STYLE[kind] ?? KIND_STYLE.unknown!;
  return (
    <span
      className="tag mono"
      style={{
        fontSize: 9.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: style.color,
      }}
      title={style.title}
    >
      {style.label}
    </span>
  );
}

const KIND_STYLE: Record<
  string,
  { label: string; color: string; title: string }
> = {
  named: {
    label: "named",
    color: "var(--credit)",
    title: "Counterparty is a person or branded merchant.",
  },
  vpa: {
    label: "VPA",
    color: "var(--accent)",
    title: "Counterparty was given as a UPI handle (e.g. merchant@axisbank).",
  },
  bill: {
    label: "bill",
    color: "var(--warn)",
    title: "Bill payment (e.g. FASTag, electricity).",
  },
  self_transfer: {
    label: "self",
    color: "var(--muted)",
    title: "Moving money between your own accounts.",
  },
  unknown: {
    label: "?",
    color: "var(--muted-2)",
    title: "Bank-only row — counterparty couldn't be classified.",
  },
};

function EmptyCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="surface" style={{ padding: 20 }}>
      <span className="eyebrow">{title}</span>
      <p className="small" style={{ marginTop: 8 }}>
        {hint}
      </p>
    </div>
  );
}
