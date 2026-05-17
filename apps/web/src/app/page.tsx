/**
 * SplitLens — landing page
 *
 * Reskinned to the canonical design system: serif hero display, mono eyebrows,
 * `.surface` cards, accent-token CTAs, line icons in place of emoji. The
 * marketing intent is unchanged — local-first as the wedge, honest copy about
 * pre-MVP status, two CTAs (try it / star repo).
 */
import Link from "next/link";

import { Ico } from "@/components/Ico";

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "64px 40px 96px",
      }}
    >
      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="flex flex-col" style={{ gap: 28 }}>
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <span className="eyebrow eyebrow-accent">SplitLens · local-first</span>
          <span className="tag">
            <Ico name="eye" size={13} className="accent" />
            100% on your device
            <span className="muted-2">/</span>
            open source
            <span className="muted-2">/</span>
            AGPL-3.0
          </span>
        </div>

        <h1
          className="hero-display"
          style={{ fontSize: 72, margin: 0, maxWidth: 880 }}
        >
          Your bank statements.{" "}
          <span style={{ fontStyle: "italic", color: "var(--accent)" }}>
            Your spending, clearly.
          </span>
        </h1>

        <p className="body" style={{ maxWidth: 680, fontSize: 16 }}>
          Drop your HDFC PDFs. SplitLens parses them, categorises every
          transaction, and shows you where your money actually went — split
          shared expenses with flatmates, settle cleanly.{" "}
          <span className="fg-2" style={{ fontWeight: 500 }}>
            Nothing leaves your browser.
          </span>
        </p>

        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <Link href="/try" className="btn btn-lg primary">
            Try it now <Ico name="arrow-right" size={16} />
          </Link>
          <a
            href="https://github.com/splitlens/splitlens"
            className="btn btn-lg outline"
          >
            <Ico name="book" size={16} /> Star on GitHub
          </a>
        </div>

        <div
          className="flex items-center gap-3 small"
          style={{ flexWrap: "wrap", marginTop: 4 }}
        >
          <span className="chip chip-sm">Built for India</span>
          <span className="chip chip-sm ghost">No signup</span>
          <span className="chip chip-sm ghost">Single device · v1</span>
          <span className="chip chip-sm ghost">Pre-MVP</span>
        </div>
      </section>

      <hr className="hr-dashed" style={{ margin: "72px 0" }} />

      {/* ── Why local-first ─────────────────────────────────────── */}
      <section className="flex flex-col" style={{ gap: 28 }}>
        <div className="flex flex-col" style={{ gap: 8 }}>
          <span className="eyebrow">Why local-first</span>
          <h2 className="display" style={{ fontSize: 36, margin: 0 }}>
            Three reasons we don&rsquo;t have a backend.
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
          }}
        >
          <PrincipleCard
            beat="01"
            icon="eye"
            title="Zero compliance risk"
            body="No backend processing your statements means there's nothing for us to leak, lose, or hand over."
          />
          <PrincipleCard
            beat="02"
            icon="book"
            title="Open source — verify it"
            body="Every line of code that touches your data is on GitHub under AGPL-3.0. Read the source. Audit the network tab."
          />
          <PrincipleCard
            beat="03"
            icon="flag"
            title="Built for Indian banks"
            body="HDFC savings + credit card supported at launch. ICICI / Axis / SBI coming based on your votes."
          />
        </div>
      </section>

      <hr className="hr-dashed" style={{ margin: "72px 0" }} />

      {/* ── What you can do ────────────────────────────────────── */}
      <section className="flex flex-col" style={{ gap: 28 }}>
        <div className="flex flex-col" style={{ gap: 8 }}>
          <span className="eyebrow">What you can do</span>
          <h2 className="display" style={{ fontSize: 36, margin: 0 }}>
            Four jobs the app already does.
          </h2>
        </div>

        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 14,
          }}
        >
          <FeatureRow
            icon="trending-up"
            title="See where your money goes"
            body="Interactive sunburst — click any category to drill in. Monthly reports with anomaly flags."
            tags={["Dashboard", "Sunburst"]}
          />
          <FeatureRow
            icon="users"
            title="Split shared expenses"
            body="Mark a transaction as shared with flatmates. Auto-computed settlements. Net balance per person."
            tags={["Friends", "Settle"]}
          />
          <FeatureRow
            icon="repeat"
            title="Track personal habits"
            body="Define your own categories — cigarettes, takeout, subscriptions. Watch the trend over time."
            tags={["Custom categories"]}
          />
          <FeatureRow
            icon="sparkles"
            title="Smart suggestions"
            body="The more you tag, the smarter it gets. One-click bulk re-tag for similar transactions."
            tags={["Auto-categorise", "Bulk"]}
          />
        </ul>
      </section>

      <hr className="hr-dashed" style={{ margin: "72px 0" }} />

      {/* ── Pre-MVP CTA card ───────────────────────────────────── */}
      <section
        id="try"
        className="surface"
        style={{ padding: 36, display: "flex", flexDirection: "column", gap: 18 }}
      >
        <div className="flex items-center gap-3">
          <span className="eyebrow eyebrow-accent">Status · pre-MVP</span>
          <span className="tag">
            <span className="dot warn" /> building in the open
          </span>
        </div>
        <h2 className="display" style={{ fontSize: 32, margin: 0 }}>
          Public launch targeted for Week 9.
        </h2>
        <p className="body" style={{ margin: 0, maxWidth: 680 }}>
          Star the repo to follow along — you&rsquo;ll be first to know when the
          beta opens. Until then the <code className="kbd">/try</code> route is
          a working preview against your own PDFs, fully local.
        </p>
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <a
            href="https://github.com/splitlens/splitlens"
            className="btn primary"
          >
            <Ico name="book" size={13} /> Star on GitHub
          </a>
          <Link href="/privacy" className="btn outline">
            How we keep you private <Ico name="arrow-right" size={13} />
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer
        className="flex items-center"
        style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: "1px solid var(--border)",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span className="small">
          SplitLens <span className="muted-2">·</span> AGPL-3.0{" "}
          <span className="muted-2">·</span> built by{" "}
          <a
            href="https://github.com/prateekaryyan"
            style={{ color: "var(--fg-2)", textDecoration: "underline" }}
          >
            Prateek Aryan
          </a>{" "}
          <span className="muted-2">·</span> made in Bangalore
        </span>
      </footer>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Local sub-components — each used in exactly one section above. Keeping them
// inline so the whole landing surface reads top-to-bottom in one file.
// ────────────────────────────────────────────────────────────────────────────

function PrincipleCard({
  beat,
  icon,
  title,
  body,
}: {
  beat: string;
  icon: Parameters<typeof Ico>[0]["name"];
  title: string;
  body: string;
}) {
  return (
    <article
      className="surface flex flex-col"
      style={{ padding: 20, gap: 12 }}
    >
      <div className="flex items-center justify-between">
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--muted-2)",
            letterSpacing: "0.08em",
          }}
        >
          {beat}
        </span>
        <span
          className="flex items-center justify-center"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            border: "1px solid var(--accent-line)",
          }}
        >
          <Ico name={icon} size={16} />
        </span>
      </div>
      <h3 className="h2">{title}</h3>
      <p className="body" style={{ margin: 0 }}>
        {body}
      </p>
    </article>
  );
}

function FeatureRow({
  icon,
  title,
  body,
  tags,
}: {
  icon: Parameters<typeof Ico>[0]["name"];
  title: string;
  body: string;
  tags: string[];
}) {
  return (
    <li className="surface flex" style={{ padding: 18, gap: 14 }}>
      <span
        className="flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: 8,
          background: "var(--surface-2)",
          color: "var(--fg-2)",
          border: "1px solid var(--border)",
        }}
      >
        <Ico name={icon} size={16} />
      </span>
      <div className="flex flex-col" style={{ gap: 6, minWidth: 0 }}>
        <h3 className="h2">{title}</h3>
        <p className="small" style={{ margin: 0, color: "var(--fg-2)" }}>
          {body}
        </p>
        <div
          className="flex items-center gap-1"
          style={{ marginTop: 2, flexWrap: "wrap" }}
        >
          {tags.map((t) => (
            <span key={t} className="chip chip-sm ghost">
              {t}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}
