"use client";

/**
 * MonthDigest — the design handoff's "D · The Digest" surface, wired to
 * the existing `MonthlyReport` data shape.
 *
 *   Hero            "January, in N stories." (serif display)
 *   Stats strip     Txns · Outflow · Inflow · Net + day-of-month sparkbars
 *   Story grid      One card per non-empty review bucket
 *   Progress bar    How much of the month is triaged + a primary CTA
 *
 * Where the design's pattern-detected "stories" don't yet exist in our
 * data model, we surface the server-side review buckets (house / chase /
 * usual / other / done) as the story beats — each card title is editorial,
 * each card lists representative txns from that bucket.
 */
import Link from "next/link";
import { useMemo } from "react";

import { Ico } from "@/components/Ico";
import type { MonthlyReport, ReportTxn, ReviewBucket } from "@/lib/repo";
import { fmtInr } from "@/lib/format";

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface StoryBeat {
  beat: string;
  kicker: string;
  title: string;
  dek: React.ReactNode;
  tags: string[];
  confidence: "high" | "low";
  flag?: boolean;
  bucket: ReviewBucket;
  rows: ReportTxn[];
  total: number;
}

function buildStories(report: MonthlyReport): StoryBeat[] {
  const out: StoryBeat[] = [];
  const buckets = report.buckets;

  const sumAmt = (rows: ReportTxn[]) =>
    rows.reduce((s, r) => s + (r.withdrawal ?? 0), 0);

  if (buckets.house.length > 0) {
    const t = sumAmt(buckets.house);
    out.push({
      beat: "01",
      kicker: "House-shape spending",
      title:
        buckets.house.length === 1
          ? "One household debit worth a flatmate split."
          : `${buckets.house.length} household debits worth a flatmate split.`,
      dek: (
        <>
          Utilities, groceries, household — we&rsquo;ve pre-suggested splits
          for each. Total <span className="mono fg-2">−{fmtInr(t)}</span>.
        </>
      ),
      tags: ["Household", `×${buckets.house.length}`, `${fmtInr(t)}`],
      confidence: "high",
      bucket: "house",
      rows: buckets.house,
      total: t,
    });
  }

  if (buckets.chase.length > 0) {
    const t = sumAmt(buckets.chase);
    out.push({
      beat: String(out.length + 1).padStart(2, "0"),
      kicker: "Forgot to chase",
      title: `${buckets.chase.length} payment${buckets.chase.length === 1 ? "" : "s"} you sent — nothing came back.`,
      dek: (
        <>
          A friend hasn&rsquo;t paid you back within 14 days.{" "}
          <span className="warn">We&rsquo;d flag these.</span>
        </>
      ),
      tags: ["Owed to me", `×${buckets.chase.length}`, `${fmtInr(t)}`],
      confidence: "low",
      flag: true,
      bucket: "chase",
      rows: buckets.chase,
      total: t,
    });
  }

  if (buckets.usual.length > 0) {
    const t = sumAmt(buckets.usual);
    out.push({
      beat: String(out.length + 1).padStart(2, "0"),
      kicker: "Quietly recurring",
      title: `Same merchants you&apos;ve split before, ${buckets.usual.length} more this month.`,
      dek: (
        <>
          One-click accept — we&rsquo;ll apply the same split you used last
          time.
        </>
      ),
      tags: ["Splittable", `×${buckets.usual.length}`, `${fmtInr(t)}`],
      confidence: "high",
      bucket: "usual",
      rows: buckets.usual,
      total: t,
    });
  }

  if (buckets.other.length > 0) {
    const t = sumAmt(buckets.other);
    out.push({
      beat: String(out.length + 1).padStart(2, "0"),
      kicker: "The boring tail",
      title: `${buckets.other.length} one-offs — confirm or skip.`,
      dek: <>No pattern, no shared-cost signal. Walk through them and they&rsquo;re done.</>,
      tags: ["Just me?", `×${buckets.other.length}`, `${fmtInr(t)}`],
      confidence: "high",
      bucket: "other",
      rows: buckets.other,
      total: t,
    });
  }

  if (buckets.done.length > 0) {
    const t = sumAmt(buckets.done);
    out.push({
      beat: String(out.length + 1).padStart(2, "0"),
      kicker: "Triaged",
      title: `${buckets.done.length} already reviewed.`,
      dek: <>Confirmed earlier. Open the card to undo if needed.</>,
      tags: ["Done", `×${buckets.done.length}`, `${fmtInr(t)}`],
      confidence: "high",
      bucket: "done",
      rows: buckets.done,
      total: t,
    });
  }

  return out;
}

export function MonthDigest({ report }: { report: MonthlyReport }) {
  const stories = useMemo(() => buildStories(report), [report]);
  const [y, m] = report.yearMonth.split("-").map(Number);
  const monthLabel =
    y && m ? `${MONTH_LONG[m - 1]} ${y}` : report.yearMonth;
  const net = report.totalIn - report.totalOut;
  const monthsIdx = report.availableMonths.indexOf(report.yearMonth);
  const prevMonth = monthsIdx > 0 ? report.availableMonths[monthsIdx - 1] : null;
  const nextMonth =
    monthsIdx >= 0 && monthsIdx < report.availableMonths.length - 1
      ? report.availableMonths[monthsIdx + 1]
      : null;

  const reviewedPct =
    report.txnCount === 0
      ? 0
      : Math.round((report.reviewedCount / report.txnCount) * 100);

  // Derive a day-of-month sparkbars data series from the txns we have.
  const dailyDebits = useMemo(() => {
    const lastDay = y && m ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 31;
    const out = new Array<number>(lastDay).fill(0);
    for (const bucket of Object.values(report.buckets)) {
      for (const t of bucket) {
        if (t.withdrawal == null) continue;
        const day = Number(t.txnDate.slice(8, 10));
        if (Number.isFinite(day) && day >= 1 && day <= lastDay) {
          out[day - 1]! += t.withdrawal;
        }
      }
    }
    return out;
  }, [report.buckets, y, m]);
  const maxDaily = Math.max(1, ...dailyDebits);

  return (
    <main className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero */}
      <div style={{ padding: "28px 40px 22px" }}>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-3" style={{ flex: 1, minWidth: 320 }}>
            <div className="flex items-center gap-3">
              <span className="eyebrow eyebrow-accent">Monthly recap · the digest</span>
              <span className="tag">
                SplitLens<span className="muted-2">/</span>Monthly
                <span className="muted-2">/</span>{monthLabel}
              </span>
            </div>
            <h1 className="hero-display" style={{ fontSize: 64, margin: 0 }}>
              {monthLabel.split(" ")[0]}, in{" "}
              <span style={{ fontStyle: "italic", color: "var(--accent)" }}>
                {stories.length || "no"}
              </span>{" "}
              {stories.length === 1 ? "story" : "stories"}.
            </h1>
            <div className="body" style={{ maxWidth: 720 }}>
              We skimmed your {report.txnCount.toLocaleString()} transactions and
              bundled them into the patterns that explain most of your spend.
              Confirm what feels right, flag what doesn&rsquo;t, and we&rsquo;ll
              handle the boring tail.
            </div>
          </div>

          <div className="flex flex-col items-end gap-3" style={{ minWidth: 280 }}>
            <div className="flex items-center gap-1">
              {prevMonth ? (
                <Link href={`/reports/${prevMonth}`} className="btn btn-sm ghost">
                  <Ico name="chevron-left" size={13} /> {fmtPrevNext(prevMonth)}
                </Link>
              ) : (
                <button type="button" className="btn btn-sm ghost" disabled>
                  <Ico name="chevron-left" size={13} />
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: "var(--surface-2)" }}
              >
                <Ico name="calendar" size={13} /> {monthLabel}
              </button>
              {nextMonth ? (
                <Link href={`/reports/${nextMonth}`} className="btn btn-sm ghost">
                  {fmtPrevNext(nextMonth)} <Ico name="chevron-right" size={13} />
                </Link>
              ) : (
                <button type="button" className="btn btn-sm ghost" disabled>
                  <Ico name="chevron-right" size={13} />
                </button>
              )}
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
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr 2.2fr",
          alignItems: "center",
          gap: 24,
        }}
      >
        <StatCol label="Transactions" value={report.txnCount.toLocaleString()} sub={`${report.reviewedCount.toLocaleString()} reviewed`} />
        <StatCol
          label="Outflow"
          value={`${fmtInr(report.totalOut)}`}
          sub="debits"
          cls="debit"
        />
        <StatCol
          label="Inflow"
          value={`${fmtInr(report.totalIn)}`}
          sub="credits"
          cls="credit"
        />
        <StatCol
          label="Net"
          value={`${net >= 0 ? "+" : "−"}₹${fmtInr(Math.abs(net))}`}
          sub={net >= 0 ? "saved" : "spent net"}
          cls={net >= 0 ? "credit" : "debit"}
        />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="eyebrow">By day of month</span>
            <span className="tag">debits</span>
          </div>
          <div className="sparkbar" style={{ height: 30 }}>
            {dailyDebits.map((d, i) => (
              <span
                key={i}
                className={d / maxDaily > 0.6 ? "hl" : ""}
                style={{ height: `${Math.max(2, (d / maxDaily) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Stories grid */}
      <div
        style={{
          padding: "20px 40px 24px",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          flex: 1,
        }}
      >
        {stories.map((s) => (
          <StoryCard key={s.beat} story={s} />
        ))}
        {report.txnCount > 0 && stories.length < 6 && <LeftoversCard report={report} />}
      </div>

      {/* Bottom progress */}
      <div
        className="flex items-center"
        style={{
          margin: "0 40px 24px",
          padding: "12px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          gap: 16,
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <span className="eyebrow">Recap</span>
        <span className="tag mono">
          <span className="fg-2">{report.reviewedCount}</span> reviewed ·{" "}
          <span className="fg-2">{report.txnCount - report.reviewedCount}</span> to go
        </span>
        <div className="progress" style={{ flex: 1, maxWidth: 360, minWidth: 200 }}>
          <i style={{ width: `${reviewedPct}%` }} />
        </div>
        <span className="small">{reviewedPct}% triaged</span>
        <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
          <Link
            href={`/review?from=${report.yearMonth}-01&to=${report.yearMonth}-${String(new Date(y!, m!, 0).getUTCDate()).padStart(2, "0")}`}
            className="btn btn-sm outline"
          >
            Open ledger <Ico name="arrow-right" size={13} />
          </Link>
        </div>
      </div>
    </main>
  );
}

function fmtPrevNext(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${short[m - 1]} '${String(y).slice(-2)}`;
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
        <span className={`num-amount ${cls}`} style={{ fontSize: 30 }}>
          {value}
        </span>
      </div>
      <span className="tiny">{sub}</span>
    </div>
  );
}

function StoryCard({ story }: { story: StoryBeat }) {
  return (
    <article
      className="surface flex flex-col"
      style={{ padding: 18, gap: 12, position: "relative", minHeight: 280 }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="serif muted-2" style={{ fontSize: 28, lineHeight: 1 }}>
            {story.beat}
          </span>
          <span className="eyebrow">{story.kicker}</span>
        </div>
        {story.flag ? (
          <span
            className="chip chip-sm"
            style={{
              color: "var(--warn)",
              borderColor: "var(--accent-line)",
            }}
          >
            <Ico name="flag" size={13} /> needs review
          </span>
        ) : (
          <span className="chip chip-sm muted">
            <Ico name="sparkles" size={13} /> {story.confidence}
          </span>
        )}
      </div>

      <h2
        className="serif"
        style={{
          fontSize: 24,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          margin: 0,
        }}
      >
        {story.title}
      </h2>

      <p className="body" style={{ margin: 0, fontSize: 13.5 }}>
        {story.dek}
      </p>

      {/* Mini representative txn list */}
      <div className="flex flex-col gap-1" style={{ marginTop: "auto" }}>
        {story.rows.slice(0, 3).map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between"
            style={{ fontSize: 12.5 }}
          >
            <span
              className="fg-2"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 180,
              }}
            >
              {t.counterparty ?? t.narration ?? "—"}
            </span>
            <span className="num-amount debit" style={{ fontSize: 13 }}>
              {t.withdrawal != null ? `−${fmtInr(t.withdrawal)}` : ""}
            </span>
          </div>
        ))}
        {story.rows.length > 3 && (
          <span className="tiny muted-2" style={{ marginTop: 2 }}>
            + {story.rows.length - 3} more in this beat
          </span>
        )}
      </div>

      <div
        className="flex items-center gap-2"
        style={{ flexWrap: "wrap", marginTop: 4 }}
      >
        {story.tags.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className={`chip chip-sm ${i === 0 ? "accent" : ""}`}
          >
            {t}
          </span>
        ))}
      </div>

      <hr className="hr-dashed" />

      <div className="flex items-center justify-between">
        <span className="tag">
          <Ico name="eye" size={13} /> {story.rows.length} txn
          {story.rows.length === 1 ? "" : "s"}
        </span>
        {story.flag ? (
          <button type="button" className="btn btn-sm outline">
            Investigate <Ico name="arrow-right" size={13} />
          </button>
        ) : (
          <button type="button" className="btn btn-sm primary">
            <Ico name="check" size={13} /> Confirm
          </button>
        )}
      </div>
    </article>
  );
}

function LeftoversCard({ report }: { report: MonthlyReport }) {
  // Pull a few of the most recent txns from "other" + "done" so the card
  // shows real names. Up to 4.
  const samples = [
    ...report.buckets.other,
    ...report.buckets.done,
  ]
    .slice(0, 4)
    .map((t) => ({
      label: t.counterparty ?? t.narration ?? "—",
      amount: t.withdrawal ? `−${fmtInr(t.withdrawal)}` : "",
      meta: `${t.txnDate} · ${t.txnTime ?? ""}`,
    }));

  return (
    <article
      className="surface-dashed flex flex-col"
      style={{ padding: 18, gap: 10 }}
    >
      <div className="flex items-baseline gap-3">
        <span className="serif muted-2" style={{ fontSize: 28, lineHeight: 1 }}>
          ··
        </span>
        <span className="eyebrow">Leftovers</span>
      </div>
      <h2
        className="serif"
        style={{
          fontSize: 22,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          margin: 0,
        }}
      >
        Loose ends from this month.
      </h2>
      <p className="body" style={{ fontSize: 13.5, margin: 0 }}>
        Mostly one-offs and already-reviewed rows. Walk through them on the
        ledger.
      </p>
      <div className="flex flex-col gap-1.5" style={{ marginTop: "auto" }}>
        {samples.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-between"
            style={{ fontSize: 13 }}
          >
            <span className="fg-2">{s.label}</span>
            <span className="flex items-center gap-3">
              <span className="tag">{s.meta}</span>
              <span className="num-amount debit" style={{ fontSize: 14 }}>
                {s.amount}
              </span>
            </span>
          </div>
        ))}
      </div>
      <hr className="hr-dashed" />
      <Link
        href={`/review?from=${report.yearMonth}-01`}
        className="btn btn-sm outline"
        style={{ justifyContent: "center" }}
      >
        Walk through on /review <Ico name="arrow-right" size={13} />
      </Link>
    </article>
  );
}
