"use client";

import { useState } from "react";
import type { CandidateShare } from "@/lib/repo";
import { fmtInr, fmtDate } from "@/lib/format";
import { Ico } from "@/components/Ico";
import { ShareTxnModal, type PersonOption } from "./ShareTxnModal";

const HINT_LABEL: Record<string, string> = {
  "trip-cost": "Trip cost",
  transport: "Transport",
  groceries: "Groceries",
  "group-meal": "Group meal?",
  food: "Food",
  outing: "Outing",
  splittable: "Splittable",
};

/**
 * A queue of "did you share this with anyone?" suggestions, picked by
 * amount + category. Each click opens the share modal. The list is
 * server-fetched and passed in as a snapshot — after the user marks one,
 * revalidatePath refreshes the page so the row drops out.
 */
export function CandidateSuggestions({
  candidates,
  people,
}: {
  candidates: CandidateShare[];
  people: PersonOption[];
}) {
  const [open, setOpen] = useState<CandidateShare | null>(null);

  if (candidates.length === 0) {
    return (
      <div className="surface flex flex-col" style={{ padding: 18, gap: 8 }}>
        <div className="flex items-center gap-2">
          <Ico name="check" size={13} className="accent" />
          <span className="eyebrow">Nothing to review</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          We didn&apos;t find any high-value food / travel / outing transactions
          that you haven&apos;t already classified.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="surface flex flex-col"
        style={{
          padding: 18,
          gap: 10,
          borderColor: "var(--accent-line)",
          background: "var(--accent-soft)",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ico name="sparkles" size={13} className="accent" />
            <span className="eyebrow eyebrow-accent">Did you share these?</span>
          </div>
          <span className="tag">
            <span className="mono fg-2">{candidates.length}</span>{" "}
            suggestion{candidates.length === 1 ? "" : "s"}
          </span>
        </div>
        <h2 className="h2" style={{ margin: 0 }}>
          High-value food, travel, and outing expenses you haven&apos;t split yet.
        </h2>

        <div className="flex flex-col" style={{ gap: 2, marginTop: 4 }}>
          {candidates.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3"
              style={{
                padding: "8px 4px",
                borderBottom: "1px dashed var(--border-dashed)",
              }}
            >
              <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                  <span
                    className="fg-2"
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={c.counterparty ?? c.narration ?? ""}
                  >
                    {c.counterparty || c.narration || "—"}
                  </span>
                  <span className="chip chip-sm accent" style={{ fontSize: 10 }}>
                    {HINT_LABEL[c.hint] ?? c.hint}
                  </span>
                </div>
                <div className="flex items-center gap-2 tiny muted">
                  <span>{fmtDate(c.txnDate)}</span>
                  {c.txnTime && <span className="mono tabular">{c.txnTime}</span>}
                  {c.category && (
                    <span className="chip chip-sm ghost" style={{ fontSize: 10 }}>
                      {c.category}
                    </span>
                  )}
                </div>
              </div>
              <span
                className="num-amount debit"
                style={{ fontSize: 14, width: 100, textAlign: "right", flexShrink: 0 }}
              >
                −{fmtInr(c.amount)}
              </span>
              <button
                type="button"
                onClick={() => setOpen(c)}
                className="btn btn-sm primary"
              >
                <Ico name="split" size={13} /> Split
              </button>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <ShareTxnModal
          txn={{
            id: open.id,
            txnDate: open.txnDate,
            txnTime: open.txnTime,
            amount: open.amount,
            counterparty: open.counterparty,
            narration: open.narration,
            category: open.category,
          }}
          people={people}
          onClose={() => setOpen(null)}
          onSubmitted={() => setOpen(null)}
        />
      )}
    </>
  );
}
