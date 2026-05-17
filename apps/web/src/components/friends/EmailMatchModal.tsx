"use client";

import { useEffect } from "react";
import { fmtInr } from "@/lib/format";
import type { EmailMatchLite } from "@/app/friends/email-lookup-actions";

/**
 * Modal that lists the email matches returned by `lookupEmailsForTxn`. Each
 * row shows subject + sender + date + a 0..1 score bar + the reason chips
 * the scorer attached. If a merchant extractor recognized the sender, the
 * extracted summary is displayed prominently, and the structured fields are
 * dumped underneath as a small key/value list. A collapsible <details>
 * exposes the truncated body excerpt for the curious.
 *
 * Style mirrors DayDetailModal: backdrop + ESC + click-outside to close.
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Email matches"
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50" title={txnLabel}>
              Emails about {txnLabel}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {loading
                ? "Searching your mailbox…"
                : error
                  ? "Lookup failed"
                  : accountCount === 0
                    ? "No email accounts configured"
                    : `${matches.length} match${matches.length === 1 ? "" : "es"}${
                        txnAmount != null ? ` · ${fmtInr(txnAmount)}` : ""
                      } · ${accountCount} mailbox${accountCount === 1 ? "" : "es"} searched`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <div className="px-5 py-8 text-center text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          ) : accountCount === 0 ? (
            <NoAccountsHint />
          ) : matches.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No matching emails found in the past two weeks.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {matches.map((m) => (
                <li key={m.email.messageId} className="px-5 py-4">
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
    <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-sm text-zinc-500 dark:text-zinc-400">
      <svg
        className="h-6 w-6 animate-spin text-indigo-600 dark:text-indigo-400"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path
          d="M4 12a8 8 0 0 1 8-8"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className="opacity-75"
        />
      </svg>
      <div>Searching your mailbox over IMAP…</div>
      <div className="text-xs text-zinc-400 dark:text-zinc-500">
        First lookup can take a few seconds while Gmail authenticates.
      </div>
    </div>
  );
}

function NoAccountsHint() {
  return (
    <div className="px-5 py-8 text-sm text-zinc-600 dark:text-zinc-300">
      <p className="font-medium text-zinc-900 dark:text-zinc-50">No Gmail accounts configured.</p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Set <code className="rounded bg-zinc-100 px-1 py-0.5 text-[11px] dark:bg-zinc-800">GMAIL_USER_1</code>{" "}
        and{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 text-[11px] dark:bg-zinc-800">
          GMAIL_APP_PWD_1
        </code>{" "}
        in your environment before starting <code>next dev</code> to enable on-demand email lookup.
        Up to four account pairs are supported (suffixes 1–4).
      </p>
    </div>
  );
}

function MatchRow({ match }: { match: EmailMatchLite }) {
  const { email, score, reasons, extracted, extractorId } = match;
  const scorePct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const date = formatEmailDate(email.date);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50" title={email.subject}>
            {email.subject || "(no subject)"}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400" title={email.fromRaw}>
            {email.fromRaw || email.fromAddress} {date && <span>· {date}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="tabular-nums text-xs font-medium text-zinc-700 dark:text-zinc-300"
            title={`Score ${score.toFixed(2)}`}
          >
            {scorePct}%
          </div>
          <div
            className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            aria-hidden
          >
            <div
              className={`h-full ${
                scorePct >= 80
                  ? "bg-emerald-500"
                  : scorePct >= 50
                    ? "bg-amber-500"
                    : "bg-zinc-400 dark:bg-zinc-600"
              }`}
              style={{ width: `${scorePct}%` }}
            />
          </div>
        </div>
      </div>

      {extracted?.summary && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              {extractorId ?? "extracted"}
            </span>
          </div>
          <div className="mt-0.5">{extracted.summary}</div>
          {extracted.fields && Object.keys(extracted.fields).length > 0 && (
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
              {Object.entries(extracted.fields).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-emerald-700 dark:text-emerald-400">{k}</dt>
                  <dd className="truncate font-mono text-emerald-900 dark:text-emerald-200" title={fieldVal(v)}>
                    {fieldVal(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {reasons.map((r, i) => (
            <span
              key={i}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {email.textExcerpt && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            Show body excerpt
          </summary>
          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-zinc-50 px-3 py-2 text-[11px] leading-snug text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
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
