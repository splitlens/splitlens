"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import type {
  MerchantPersonDetail,
  MerchantPersonMonth,
  MerchantPersonTxn,
} from "@/lib/repo";
import { fmtDate, fmtInr } from "@/lib/format";
import { TimelineRangeControl } from "./TimelineRangeControl";
import {
  type TimelineRange,
  useTimelineRange,
} from "./useTimelineRange";

/**
 * Person merchant detail — balance + settle register.
 *
 * Visually distinct from the Business view: round avatar, big balance
 * number as the only KPI, two-tone ledger columns (You → them / them → You),
 * pattern-detected note at the bottom of the credit column, and a rail of
 * relationship facts (UPI, bank, shared groups) instead of merchant settings.
 *
 * Like the Business view, the whole page is a client component because the
 * balance, running-balance strip, and ledger filters all react to a single
 * timeline range owned by `useTimelineRange`.
 */
export function MerchantPersonView({ data }: { data: MerchantPersonDetail }) {
  const { state, range, setPreset, setDragRange, reset } = useTimelineRange(
    data.months,
  );
  const isCustom = state.preset === "custom";

  return (
    <div className="md-board">
      <PerBreadcrumb data={data} rangeLabel={range.label} />
      <TimelineRangeControl
        preset={state.preset}
        onPresetChange={setPreset}
        onReset={reset}
        rangeLabel={range.label}
        isCustom={isCustom}
      />
      <PerHero data={data} range={range} />
      <PerStrip range={range} onDrag={setDragRange} />
      <div className="per-grid">
        <PerLedgerColumn side="debit" data={data} range={range} />
        <PerLedgerColumn side="credit" data={data} range={range} />
        <PerRail data={data} range={range} />
      </div>
      <PerFootbar data={data} range={range} />
    </div>
  );
}

/* ── Breadcrumb ────────────────────────────────────────────────────────── */

function PerBreadcrumb({
  data,
  rangeLabel,
}: {
  data: MerchantPersonDetail;
  rangeLabel: string;
}) {
  return (
    <div className="md-crumb">
      <Link href="/review">Review</Link>
      <span style={{ color: "var(--muted-3)" }}>›</span>
      <Link href="/dashboard">By merchant</Link>
      <span style={{ color: "var(--muted-3)" }}>›</span>
      <span className="here">{data.displayName}</span>
      <span style={{ color: "var(--muted-3)" }}>·</span>
      <span className="range-pill">{rangeLabel}</span>
      <span style={{ flex: 1 }} />
      <Link href={`/friends/${data.personId}`} className="btn ghost">
        Open in Friends
      </Link>
      <Link href="/review" className="btn ghost">
        ← Back
      </Link>
    </div>
  );
}

/* ── Hero balance ──────────────────────────────────────────────────────── */

function PerHero({
  data,
  range,
}: {
  data: MerchantPersonDetail;
  range: TimelineRange<MerchantPersonMonth>;
}) {
  const balance = useMemo(() => {
    const inRange = range.months.filter((m) => m.inRange);
    const sumD = inRange.reduce((s, m) => s + m.d, 0); // negative
    const sumC = inRange.reduce((s, m) => s + m.c, 0); // positive
    return sumD + sumC;
  }, [range]);

  const dir: "deb" | "cre" | "zero" =
    balance < -50 ? "deb" : balance > 50 ? "cre" : "zero";
  const first = data.displayName.split(" ")[0] ?? data.displayName;
  const label =
    dir === "deb"
      ? `You owe ${first}`
      : dir === "cre"
        ? `${first} owes you`
        : "You’re even";
  const activeMonths = data.months.filter((m) => m.c + m.d !== 0).length;
  const lifetimeTxnCount = data.debits.length + data.credits.length;
  const whoSuffix = (() => {
    if (lifetimeTxnCount === 0) return "no activity yet";
    if (activeMonths === 0) return `${lifetimeTxnCount} transactions`;
    return `${lifetimeTxnCount} transactions over ${activeMonths} months`;
  })();
  const settleHint = settleByText(dir);

  return (
    <div className="per-hero">
      <div className="per-id">
        <div className="per-avi">{data.initials}</div>
        <div>
          <h1>{data.displayName}</h1>
          <div className="who">
            {data.upi && <span className="at">{data.upi}</span>}
            {data.upi && (
              <span style={{ color: "var(--muted-3)" }}>·</span>
            )}
            <span>
              {humanRelation(data.relationship)} · {whoSuffix}
            </span>
          </div>
          <div className="tags">
            <span className="chip accent">
              <span className="dot accent" />
              Person
            </span>
            <span className="chip">{humanRelation(data.relationship)}</span>
            <span className="chip ghost">+ tag</span>
          </div>
        </div>
      </div>
      <div className="per-balance">
        <span className="lab">Net · {range.label}</span>
        <span className={`v ${dir}`}>
          {balance === 0
            ? "₹0"
            : `${balance < 0 ? "−" : "+"}${fmtInr(Math.abs(balance), { showZero: true })}`}
        </span>
        <span className={`dir ${dir}`}>
          {dir === "zero" ? (
            <>Balanced for this window</>
          ) : (
            <>
              <b>{label}</b>
              {settleHint && (
                <>
                  <span style={{ color: "var(--muted-3)", margin: "0 6px" }}>
                    ·
                  </span>
                  {settleHint}
                </>
              )}
            </>
          )}
        </span>
        <div className="acts">
          <button type="button" className="btn outline">
            Statement
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={dir === "zero"}
          >
            {dir === "cre" ? "Request" : "Settle"}
            {balance !== 0 ? ` ${fmtInr(Math.abs(balance), { showZero: true })}` : ""}
            <span className="kbd kbd-on-accent">S</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Returns a "settle by …" hint for the balance line. We don't know real
 * settlement deadlines (no due-date data plumbed yet), so we anchor to the
 * 5th of next month as a reasonable default for rent-style monthly cadence.
 * Matches the design's "settle by Oct 5" copy.
 */
function settleByText(dir: "deb" | "cre" | "zero"): string | null {
  if (dir === "zero") return null;
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  const month = next.toLocaleString("en-IN", { month: "short" });
  return `settle by ${month} ${next.getDate()}`;
}

function humanRelation(rel: string): string {
  if (!rel || rel === "other") return "Contact";
  return rel
    .split(/[_-]/)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/* ── Running balance strip with drag scrub ──────────────────────────────── */

function PerStrip({
  range,
  onDrag,
}: {
  range: TimelineRange<MerchantPersonMonth>;
  onDrag: (a: number, b: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<number | null>(null);

  const idxFromX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const pct = (clientX - r.left) / r.width;
    return Math.max(0, Math.min(11, Math.floor(pct * 12)));
  };
  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const i0 = idxFromX(e.clientX);
    dragStart.current = i0;
    onDrag(i0, i0);
    const move = (ev: PointerEvent) => {
      if (dragStart.current == null) return;
      const i = idxFromX(ev.clientX);
      onDrag(
        Math.min(dragStart.current, i),
        Math.max(dragStart.current, i),
      );
    };
    const up = () => {
      dragStart.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const data = range.months.map((m) => ({ ...m, bal: m.d + m.c }));
  const max = Math.max(1, ...data.map((m) => Math.abs(m.bal)));

  const inRange = data.filter((m) => m.inRange);
  const netInRange = inRange.reduce((s, m) => s + m.bal, 0);
  const noteText = (() => {
    if (inRange.length === 0) return "Drag across the strip to pick a window.";
    if (netInRange < -500) {
      const heavy = inRange.find((m) => Math.abs(m.bal) > 3000);
      return `Window net: you’re behind by ${fmtInr(Math.abs(netInRange))}${heavy ? ` — driven by ${heavy.m} ’${heavy.y}` : ""}.`;
    }
    if (netInRange > 500)
      return `Window net: they’re behind by ${fmtInr(Math.abs(netInRange))}.`;
    return "Balance hovers near zero for this window — flows roughly cancel.";
  })();

  return (
    <div className="per-strip">
      <div className="lab">
        <span>Running balance · drag to pick window</span>
        <span style={{ display: "flex", gap: 16, fontSize: 11 }}>
          <span
            style={{
              display: "inline-flex",
              gap: 4,
              alignItems: "center",
            }}
          >
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "rgba(136, 181, 154, 0.5)",
              }}
            />
            they owe you
          </span>
          <span
            style={{
              display: "inline-flex",
              gap: 4,
              alignItems: "center",
            }}
          >
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "rgba(209, 134, 114, 0.5)",
              }}
            />
            you owe them
          </span>
        </span>
      </div>
      <div className="per-strip-shell">
        <div
          ref={trackRef}
          className="per-strip-grid"
          onPointerDown={onPointerDown}
        >
          <div className="per-zero" />
          {data.map((mo) => {
            const h = Math.abs(mo.bal) / max;
            const pct = h * 40;
            const isNeg = mo.bal < 0;
            return (
              <div
                key={mo.idx}
                className={`per-col ${mo.inRange ? "in" : ""}`}
              >
                <div
                  className={`b ${isNeg ? "neg" : "pos"}`}
                  style={{
                    top: isNeg ? "50%" : `${50 - pct}%`,
                    height: `${pct}%`,
                  }}
                />
                <span
                  className="v"
                  style={{
                    top: isNeg ? `${52 + pct}%` : `${48 - pct - 2}%`,
                  }}
                >
                  {mo.bal === 0
                    ? "0"
                    : `${mo.bal > 0 ? "+" : "−"}${fmtInr(Math.abs(mo.bal))}`}
                </span>
                <span className="m">
                  {mo.m} ’{mo.y}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="per-strip-note">{noteText}</div>
    </div>
  );
}

/* ── Two-column ledger ─────────────────────────────────────────────────── */

function PerLedgerColumn({
  side,
  data,
  range,
}: {
  side: "debit" | "credit";
  data: MerchantPersonDetail;
  range: TimelineRange<MerchantPersonMonth>;
}) {
  const inRangeIdx = useMemo(() => {
    const s = new Set<number>();
    for (const m of range.months) if (m.inRange) s.add(m.idx);
    return s;
  }, [range]);

  const rows = (side === "debit" ? data.debits : data.credits).filter((r) =>
    inRangeIdx.has(r.monthIdx),
  );
  const sum = rows.reduce((s, r) => s + r.amount, 0);

  const first = data.displayName.split(" ")[0] ?? data.displayName;
  const isDebit = side === "debit";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="per-col-head">
        <span
          className="ic"
          style={{
            background: isDebit
              ? "rgba(209, 134, 114, 0.18)"
              : "rgba(136, 181, 154, 0.18)",
            color: isDebit ? "var(--debit)" : "var(--credit)",
          }}
        >
          {isDebit ? "→" : "←"}
        </span>
        <h2>{isDebit ? `You → ${first}` : `${first} → you`}</h2>
        <span className="meta">
          {rows.length} in {range.label} ·{" "}
          {isDebit
            ? `−${fmtInr(Math.abs(sum), { showZero: true })}`
            : `+${fmtInr(Math.abs(sum), { showZero: true })}`}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="md-empty">
          {isDebit
            ? "No outgoing transfers in this window."
            : "No incoming transfers in this window."}
          <div className="hint">Try a wider window above.</div>
        </div>
      ) : (
        rows.map((r) => <LgRow key={r.id} row={r} side={side} />)
      )}

      {side === "credit" && rows.length > 0 && (
        <div
          style={{
            marginTop: 18,
            padding: 12,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--surface)",
            fontSize: 12.5,
            color: "var(--muted)",
          }}
        >
          <div style={{ color: "var(--fg-2)", marginBottom: 4 }}>
            Pattern · {range.label}
          </div>
          {patternForRange(range)}
        </div>
      )}
    </div>
  );
}

function patternForRange(
  range: TimelineRange<MerchantPersonMonth>,
): string {
  const inRange = range.months.filter((m) => m.inRange);
  const net = inRange.reduce((s, m) => s + m.d + m.c, 0);
  if (Math.abs(net) < 500)
    return "Flows cancel out — balance lands within ₹500 of zero for this window.";
  if (net < 0)
    return `You paid ${fmtInr(Math.abs(net))} more than they did this window. Likely needs settling.`;
  return `They paid ${fmtInr(Math.abs(net))} more than you did this window. Likely a trip or shared expense pending split.`;
}

function LgRow({
  row,
  side,
}: {
  row: MerchantPersonTxn;
  side: "debit" | "credit";
}) {
  return (
    <div className={`lg-row ${side === "debit" ? "deb" : "cre"}`}>
      <span className="when">{fmtDayMon(row.txnDate)}</span>
      <span className="note">
        {row.note}
        {row.tag && (
          <span
            className={`tag-inline ${row.tag === "Rent" ? "r" : ""}`}
          >
            {row.tag}
          </span>
        )}
        {row.hot && <span className="tag-inline hot">unusual</span>}
        {row.sub && <span className="sub">{row.sub}</span>}
      </span>
      <span className="amt">
        {row.amount < 0
          ? `−${fmtInr(Math.abs(row.amount), { showZero: true })}`
          : `+${fmtInr(row.amount, { showZero: true })}`}
      </span>
    </div>
  );
}

function fmtDayMon(iso: string): string {
  // "2025-09-22" → "22 Sep"
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const mm = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate().toString().padStart(2, "0")} ${mm[d.getUTCMonth()]}`;
}

/* ── Right rail — relationship facts ───────────────────────────────────── */

function PerRail({
  data,
  range,
}: {
  data: MerchantPersonDetail;
  range: TimelineRange<MerchantPersonMonth>;
}) {
  const tripCandidate = range.months
    .filter((m) => m.inRange && m.c > 5000)
    .at(-1);
  return (
    <div style={{ paddingTop: 16 }}>
      {tripCandidate && (
        <div
          className="rail-card"
          style={{
            borderColor: "var(--accent-line)",
            background:
              "linear-gradient(180deg, var(--accent-soft), transparent 70%)",
          }}
        >
          <div className="h" style={{ color: "var(--accent)" }}>
            <span>Suggested · {range.label}</span>
          </div>
          <div
            style={{
              fontSize: 13.5,
              color: "var(--fg)",
              marginBottom: 6,
              lineHeight: 1.4,
            }}
          >
            Split{" "}
            <b style={{ fontWeight: 500 }}>
              {tripCandidate.m} ’{tripCandidate.y}
            </b>{" "}
            transfer?
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.45,
              marginBottom: 10,
            }}
          >
            They sent {fmtInr(tripCandidate.c)} — likely a shared expense
            waiting for your split.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn primary">
              Open splitter
            </button>
            <button type="button" className="btn ghost">
              Not a split
            </button>
          </div>
        </div>
      )}
      <div className="rail-card">
        <div className="h">
          <span>About {data.displayName.split(" ")[0]}</span>
        </div>
        <div className="field">
          <span className="l">Display</span>
          <span className="v">{data.displayName}</span>
        </div>
        <div className="field">
          <span className="l">Relation</span>
          <span className="v">{humanRelation(data.relationship)}</span>
        </div>
        {data.upi && (
          <div className="field">
            <span className="l">UPI ID</span>
            <span className="v mono" style={{ fontSize: 11.5 }}>
              {data.upi}
            </span>
          </div>
        )}
        <div className="field">
          <span className="l">First txn</span>
          <span className="v">{fmtDate(data.firstSeen)}</span>
        </div>
        <div className="field">
          <span className="l">Last txn</span>
          <span className="v">{fmtDate(data.lastSeen)}</span>
        </div>
        <Link
          href={`/friends/${data.personId}`}
          className="btn ghost"
          style={{ marginTop: 6, justifyContent: "flex-start" }}
        >
          Open Friends ledger
        </Link>
      </div>

      {data.groups.length > 0 && (
        <div className="rail-card">
          <div className="h">
            <span>Shared groups</span>
            <span style={{ color: "var(--muted-2)" }}>{data.groups.length}</span>
          </div>
          {data.groups.map((g) => (
            <div key={g.id} className="group-row">
              <div
                className="group-avi"
                style={{
                  background: "rgba(217, 168, 106, 0.18)",
                  color: "#d9a86a",
                }}
              >
                ◇
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--fg)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.title}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {g.members.join(" · ")}
                </div>
              </div>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {g.splits} splits
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Footer ────────────────────────────────────────────────────────────── */

function PerFootbar({
  data,
  range,
}: {
  data: MerchantPersonDetail;
  range: TimelineRange<MerchantPersonMonth>;
}) {
  const inRange = range.months.filter((m) => m.inRange);
  const bal = inRange.reduce((s, m) => s + m.d + m.c, 0);
  const first = data.displayName.split(" ")[0] ?? data.displayName;
  return (
    <div className="per-foot">
      <span style={{ fontSize: 12, color: "var(--muted)" }}>
        {range.label} ·{" "}
        {bal === 0
          ? "even"
          : bal < 0
            ? `you owe ${fmtInr(Math.abs(bal))}`
            : `${first} owes ${fmtInr(Math.abs(bal))}`}
      </span>
      <span style={{ flex: 1 }} />
      <div className="per-foot-keys">
        <span>
          <span className="kbd">S</span> settle
        </span>
        <span>
          <span className="kbd">R</span> request
        </span>
        <span>
          <span className="kbd">⌘E</span> edit relation
        </span>
      </div>
      <span style={{ color: "var(--muted-3)" }}>|</span>
      <button type="button" className="btn outline">
        Send statement
      </button>
      <button type="button" className="btn primary" disabled={bal === 0}>
        {bal > 0 ? "Request" : "Settle"}{" "}
        {bal !== 0 ? fmtInr(Math.abs(bal), { showZero: true }) : ""}
      </button>
    </div>
  );
}
