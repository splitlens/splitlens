"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { DrillDownTxn, ItemEnrichment } from "@/lib/repo";
import { fmtDate, fmtInr } from "@/lib/format";
import { KindBadge } from "./TopCounterparties";
import { Ico, type IcoName } from "@/components/Ico";
import { getCategory } from "@/lib/taxonomy";

/**
 * Modal that lists every transaction on a given date. Opened by clicking a
 * calendar cell. Plain HTML modal — fixed position + backdrop, no portal/lib.
 * Click outside or press Esc to close.
 */
export function DayDetailModal({
  date,
  loading,
  txns,
  onClose,
}: {
  date: string;
  loading: boolean;
  txns: DrillDownTxn[];
  onClose: () => void;
}) {
  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const totalOut = txns.reduce((s, t) => s + (t.withdrawal ?? 0), 0);
  const totalIn = txns.reduce((s, t) => s + (t.deposit ?? 0), 0);

  return (
    <div
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "color-mix(in srgb, var(--bg) 70%, transparent)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        className="surface"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "85vh",
          width: "100%",
          maxWidth: 720,
          overflow: "hidden",
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.45)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          className="flex items-baseline justify-between"
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Day detail</span>
            <h3 className="h2">{fmtDate(date)}</h3>
            <p className="tiny" style={{ marginTop: 2 }}>
              {loading
                ? "Loading…"
                : `${txns.length} transaction${txns.length === 1 ? "" : "s"}${totalOut > 0 ? ` · ${fmtInr(totalOut)} out` : ""}${totalIn > 0 ? ` · ${fmtInr(totalIn)} in` : ""}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm ghost"
            aria-label="Close"
            style={{ padding: "6px 8px" }}
          >
            <Ico name="x" size={16} />
          </button>
        </header>

        <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {loading ? (
            <div
              className="flex items-center justify-center small muted"
              style={{ padding: 32 }}
            >
              Loading transactions…
            </div>
          ) : txns.length === 0 ? (
            <div
              className="flex items-center justify-center small muted"
              style={{ padding: 32 }}
            >
              No transactions on this day.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {txns.map((t) => {
                const label = t.counterparty || t.narration || "—";
                const accountLabel = `${t.accountBank} ${t.accountType === "credit_card" ? "CC" : "Savings"} XX${t.accountLast4}`;
                const def = getCategory(t.category);
                return (
                  <li
                    key={t.id}
                    style={{
                      padding: "12px 20px",
                      borderTop: "1px dashed var(--border-dashed)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 4 }}>
                        <div className="flex items-center gap-2">
                          {t.counterparty ? (
                            <Link
                              href={`/merchants/${encodeURIComponent(t.counterparty)}`}
                              title={`Open ${label} detail`}
                              className="truncate hover:underline"
                              onClick={onClose}
                              style={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: "var(--fg)",
                                textDecoration: "none",
                              }}
                            >
                              {label}
                            </Link>
                          ) : (
                            <span
                              title={label}
                              className="truncate"
                              style={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: "var(--fg)",
                              }}
                            >
                              {label}
                            </span>
                          )}
                          {t.counterpartyKind && (
                            <KindBadge kind={t.counterpartyKind} />
                          )}
                        </div>
                        <div
                          className="flex items-center gap-2 tiny"
                          style={{ color: "var(--muted)" }}
                        >
                          {t.txnTime && (
                            <span className="mono tabular">{t.txnTime}</span>
                          )}
                          {t.txnTime && <span className="muted-2">·</span>}
                          <span>{accountLabel}</span>
                          {t.category && (
                            <>
                              <span className="muted-2">·</span>
                              <span className="chip chip-sm">
                                <span aria-hidden>{def.emoji}</span>
                                {t.category}
                              </span>
                            </>
                          )}
                        </div>
                        {t.counterparty &&
                          t.narration &&
                          t.counterparty !== t.narration && (
                            <div
                              className="tiny truncate"
                              title={t.narration}
                            >
                              {t.narration}
                            </div>
                          )}
                        {t.items && t.items.items.length > 0 && (
                          <ItemList items={t.items} />
                        )}
                      </div>
                      <div className="flex flex-col items-end" style={{ flexShrink: 0 }}>
                        {t.withdrawal != null && (
                          <div className="num-amount debit" style={{ fontSize: 14 }}>
                            −{fmtInr(t.withdrawal)}
                          </div>
                        )}
                        {t.deposit != null && (
                          <div className="num-amount credit" style={{ fontSize: 14 }}>
                            +{fmtInr(t.deposit)}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline item-level breakdown for Swiggy / Zomato txns, when the email
 * enrichment pass has attached one. Compact — fits under the existing
 * txn row without dwarfing it. Shows the leading 6 items; the rest are
 * collapsed into a "+ N more" suffix so big Instamart orders don't blow
 * out the modal height.
 */
function ItemList({ items }: { items: ItemEnrichment }) {
  const MAX = 6;
  const head = items.items.slice(0, MAX);
  const extra = items.items.length - head.length;
  const iconFor = (kind: string): IcoName => {
    if (kind === "instamart") return "inbox";
    return "book";
  };
  return (
    <div
      className="flex flex-wrap items-baseline tiny"
      style={{ marginTop: 4, columnGap: 6, rowGap: 2, color: "var(--muted)" }}
    >
      <Ico name={iconFor(items.kind)} size={13} className="muted-2" />
      {items.restaurant && (
        <span className="fg-2" style={{ fontWeight: 500 }}>
          {items.restaurant.split(",")[0]}
        </span>
      )}
      {head.map((it, i) => (
        <span key={`${it.name}-${i}`} style={{ whiteSpace: "nowrap" }}>
          {i === 0 && !items.restaurant ? "" : "·"} {it.name}
          {it.qty > 1 ? ` ×${it.qty}` : ""}
        </span>
      ))}
      {extra > 0 && (
        <span className="muted-2" style={{ fontStyle: "italic" }}>
          + {extra} more
        </span>
      )}
    </div>
  );
}
