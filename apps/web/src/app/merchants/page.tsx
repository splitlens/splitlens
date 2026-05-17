import type { Metadata } from "next";
import Link from "next/link";
import { getTopCounterparties, getPeopleSummary } from "@/lib/repo";
import { fmtInr } from "@/lib/format";
import "@/components/merchant/merchant-detail.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Merchants" };

/**
 * /merchants — index of every counterparty + every known person, each
 * linking to its detail page. Acts as the discovery surface for the
 * dark-themed `/merchants/[id]` route; without it you'd need to know a
 * counterparty name in advance or navigate in from the dashboard.
 *
 * Two sections, intentionally in the same visual register as the detail
 * pages (dark warm theme):
 *   - PEOPLE — friends / flatmates / family, sorted by recency
 *   - BUSINESSES — every other counterparty, sorted by lifetime spend
 */
export default async function MerchantsIndexPage() {
  const [counterparties, people] = await Promise.all([
    getTopCounterparties(200),
    getPeopleSummary(),
  ]);

  return (
    <div className="md-board" style={{ paddingBottom: 60 }}>
      <div className="md-crumb">
        <Link href="/dashboard">Dashboard</Link>
        <span style={{ color: "var(--muted-3)" }}>›</span>
        <span className="here">Merchants</span>
        <span style={{ flex: 1 }} />
        <Link href="/dashboard" className="btn ghost">
          ← Back to dashboard
        </Link>
      </div>

      <div style={{ padding: "8px 32px 24px" }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--fg)",
          }}
        >
          Merchants
        </h1>
        <p
          style={{
            marginTop: 6,
            fontSize: 13,
            color: "var(--muted)",
            maxWidth: 640,
          }}
        >
          Every counterparty and person you’ve transacted with. Click any name
          to open the detail view — businesses get a trend &amp; cleanup register,
          people get a balance &amp; settle register.
        </p>
      </div>

      {people.length > 0 && (
        <Section title="People" count={people.length}>
          {people.map((p) => {
            const total = p.totalSent + p.totalReceived;
            const direction =
              p.net > 50
                ? `you’ve sent ${fmtInr(p.net)} net`
                : p.net < -50
                  ? `they’ve sent ${fmtInr(Math.abs(p.net))} net`
                  : "balanced";
            return (
              <MerchantRow
                key={p.personId}
                href={`/merchants/${encodeURIComponent(p.personId)}`}
                initials={initialsFor(p.displayName)}
                tone="person"
                title={p.displayName}
                subtitle={`${humanize(p.relationship)} · ${p.txnCount} txn${p.txnCount === 1 ? "" : "s"} · ${direction}`}
                amount={fmtInr(total)}
                amountTone={p.net > 50 ? "credit" : p.net < -50 ? "debit" : "muted"}
              />
            );
          })}
        </Section>
      )}

      <Section title="Businesses" count={counterparties.length}>
        {counterparties.length === 0 ? (
          <div className="md-empty">No counterparties yet — ingest some bank statements first.</div>
        ) : (
          counterparties.map((c) => (
            <MerchantRow
              key={c.counterparty}
              href={`/merchants/${encodeURIComponent(c.counterparty)}`}
              initials={(c.counterparty[0] ?? "·").toUpperCase()}
              tone="business"
              title={c.counterparty}
              subtitle={`${c.txnCount} txn${c.txnCount === 1 ? "" : "s"} · ${c.counterpartyKind}`}
              amount={`−${fmtInr(c.totalOut)}`}
              amountTone="debit"
            />
          ))
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ padding: "0 32px 24px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          padding: "12px 0 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--fg)",
            margin: 0,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>{count}</span>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 10,
          marginTop: 12,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function MerchantRow({
  href,
  initials,
  tone,
  title,
  subtitle,
  amount,
  amountTone,
}: {
  href: string;
  initials: string;
  tone: "business" | "person";
  title: string;
  subtitle: string;
  amount: string;
  amountTone: "debit" | "credit" | "muted";
}) {
  const aviStyle =
    tone === "person"
      ? {
          background: "rgba(209, 134, 114, 0.18)",
          color: "#d18672",
          borderRadius: 999,
          border: "1px solid rgba(209, 134, 114, 0.3)",
        }
      : { background: "rgba(173, 154, 216, 0.18)", color: "#ad9ad8", borderRadius: 8 };

  const amountColor =
    amountTone === "credit"
      ? "var(--credit)"
      : amountTone === "debit"
        ? "var(--debit)"
        : "var(--muted-2)";

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        textDecoration: "none",
        color: "var(--fg)",
        transition: "border-color 120ms ease",
      }}
      className="md-index-row"
    >
      <div
        style={{
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 500,
          flexShrink: 0,
          ...aviStyle,
        }}
      >
        {initials}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13.5,
            color: "var(--fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={title}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </div>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: amountColor,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {amount}
      </div>
    </Link>
  );
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function humanize(rel: string): string {
  if (!rel || rel === "other") return "Contact";
  return rel
    .split(/[_-]/)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
