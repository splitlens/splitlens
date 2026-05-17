"use client";

import { useEffect } from "react";
import { fmtInr } from "@/lib/format";
import { Ico } from "@/components/Ico";
import type { EmailMatchLite } from "@/app/friends/email-lookup-actions";

/**
 * Modal that lists the email matches returned by `lookupEmailsForTxn`. Each
 * row shows subject + sender + date + a 0..1 score bar + the reason chips
 * the scorer attached. If a merchant extractor recognized the sender, the
 * extracted summary is displayed prominently, and the structured fields are
 * dumped underneath as a small key/value list. A collapsible <details>
 * exposes the truncated body excerpt for the curious.
 */
export function EmailMatchModal({
  txnLabel,
  txnAmount,
  loading,
  error,
  accountCount,
  matches,
  onClose,
}: {
  /** Short text shown in the header: "ZOMATO" or "Lenskart". */
  txnLabel: string;
  /** Optional rupee amount shown next to the label. */
  txnAmount: number | null;
  loading: boolean;
  error: string | null;
  /** Number of Gmail accounts configured. 0 → friendly hint. */
  accountCount: number;
  matches: EmailMatchLite[];
  onClose: () => void;
}) {
  // Esc to close — mirrors DayDetailModal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const subtitle = loading
    ? "Searching your mailbox…"
    : error
      ? "Lookup failed"
      : accountCount === 0
        ? "No email accounts configured"
        : `${matches.length} match${matches.length === 1 ? "" : "es"}${
            txnAmount != null ? ` · ${fmtInr(txnAmount)}` : ""
          } · ${accountCount} mailbox${accountCount === 1 ? "" : "es"} searched`;

  return (
    <div
      className="flex items-center justify-center modal-backdrop-anim"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        padding: "32px 24px",
      }}
      aria-modal="true"
      role="dialog"
      aria-label="Email matches"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in srgb, var(--bg) 75%, transparent)",
          backdropFilter: "blur(3px)",
          border: "none",
          cursor: "pointer",
        }}
      />
      <div
        className="surface flex flex-col modal-panel-anim"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 680,
          maxHeight: "calc(100vh - 64px)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-start justify-between gap-3"
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex flex-col" style={{ minWidth: 0, gap: 4 }}>
            <span className="eyebrow eyebrow-accent">
              <Ico name="paperclip" size={13} /> Email matches
            </span>
            <h3
              className="h2"
              style={{
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={txnLabel}
            >
              Emails about {txnLabel}
            </h3>
            <p className="tiny muted" style={{ margin: 0 }}>
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm ghost"
            aria-label="Close"
            style={{ padding: 6, flexShrink: 0 }}
          >
            <Ico name="x" size={16} />
          </button>
        </header>

        <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {loading ? (
            <LoadingState />
          ) : error ? (
            <div
              className="flex items-center justify-center small"
              style={{ padding: "32px 20px", color: "var(--debit)" }}
            >
              {error}
            </div>
          ) : accountCount === 0 ? (
            <NoAccountsHint />
          ) : matches.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center"
              style={{ padding: "32px 20px", gap: 8 }}
            >
              <Ico name="search" size={20} className="muted" />
              <span className="small muted">
                No matching emails found in the past two weeks.
              </span>
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {matches.map((m) => (
                <li
                  key={m.email.messageId}
                  style={{
                    padding: "14px 20px",
                    borderBottom: "1px dashed var(--border-dashed)",
                  }}
                >
                  <MatchRow match={m} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ padding: "48px 20px", gap: 10 }}
    >
      <Ico name="search" size={20} className="accent" />
      <span className="small fg-2">Searching your mailbox over IMAP…</span>
      <span className="tiny muted">
        First lookup can take a few seconds while Gmail authenticates.
      </span>
    </div>
  );
}

function NoAccountsHint() {
  return (
    <div
      className="flex flex-col"
      style={{ padding: "20px 24px", gap: 8 }}
    >
      <span className="h2" style={{ margin: 0 }}>
        No Gmail accounts configured.
      </span>
      <p className="small muted" style={{ margin: 0 }}>
        Set <span className="kbd">GMAIL_USER_1</span> and{" "}
        <span className="kbd">GMAIL_APP_PWD_1</span> in your environment before
        starting <span className="kbd">next dev</span> to enable on-demand
        email lookup. Up to four account pairs are supported (suffixes 1–4).
      </p>
    </div>
  );
}

function MatchRow({ match }: { match: EmailMatchLite }) {
  const { email, score, reasons, extracted, extractorId } = match;
  const scorePct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const date = formatEmailDate(email.date);
  const barColor =
    scorePct >= 80
      ? "var(--credit)"
      : scorePct >= 50
        ? "var(--warn)"
        : "var(--muted-2)";

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col" style={{ minWidth: 0, flex: 1, gap: 2 }}>
          <span
            className="fg-2"
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={email.subject}
          >
            {email.subject || "(no subject)"}
          </span>
          <span
            className="tiny muted"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={email.fromRaw}
          >
            {email.fromRaw || email.fromAddress} {date && <span>· {date}</span>}
          </span>
        </div>
        <div
          className="flex flex-col items-end"
          style={{ flexShrink: 0, gap: 4 }}
        >
          <span className="mono tabular fg-2" style={{ fontSize: 12 }} title={`Score ${score.toFixed(2)}`}>
            {scorePct}%
          </span>
          <div
            aria-hidden
            style={{
              height: 4,
              width: 80,
              background: "var(--surface-3)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${scorePct}%`,
                background: barColor,
              }}
            />
          </div>
        </div>
      </div>

      {extracted?.summary && (
        <div
          className="surface flex flex-col"
          style={{
            marginTop: 10,
            padding: 10,
            gap: 4,
            borderColor: "var(--accent-line)",
            background: "var(--accent-soft)",
          }}
        >
          <span className="eyebrow eyebrow-accent">
            <Ico name="sparkles" size={13} /> {extractorId ?? "extracted"}
          </span>
          <span className="small fg-2">{extracted.summary}</span>
          {extracted.fields && Object.keys(extracted.fields).length > 0 && (
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "max-content 1fr",
                columnGap: 12,
                rowGap: 2,
                margin: 0,
                marginTop: 4,
              }}
            >
              {Object.entries(extracted.fields).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="tiny accent">{k}</dt>
                  <dd
                    className="mono tabular tiny fg-2"
                    style={{
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={fieldVal(v)}
                  >
                    {fieldVal(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {reasons.length > 0 && (
        <div
          className="flex items-center"
          style={{ flexWrap: "wrap", gap: 4, marginTop: 8 }}
        >
          {reasons.map((r, i) => (
            <span key={i} className="chip chip-sm" style={{ fontSize: 10 }}>
              {r}
            </span>
          ))}
        </div>
      )}

      {email.textExcerpt && (
        <details style={{ marginTop: 10 }}>
          <summary
            className="accent small"
            style={{ cursor: "pointer" }}
          >
            Show body excerpt
          </summary>
          <pre
            className="mono"
            style={{
              marginTop: 6,
              maxHeight: 192,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 11,
              lineHeight: 1.45,
              color: "var(--fg-2)",
            }}
          >
            {email.textExcerpt}
            {email.textTruncated && "…"}
          </pre>
        </details>
      )}
    </div>
  );
}

function fieldVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Format an ISO-ish date string in a compact local form: "16 May, 18:42".
 * Falls back to the raw string when parsing fails.
 */
function formatEmailDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = d.getDate();
  const mm = months[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${mm}, ${hh}:${mi}`;
}
