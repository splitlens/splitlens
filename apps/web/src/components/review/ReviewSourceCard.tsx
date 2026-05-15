"use client";

/**
 * ReviewSourceCard — one card per transaction_sources row on the review page.
 *
 * Layout, top to bottom:
 *   [icon] Title                                  [source_type code]
 *   subtitle (optional — merchant / order id / etc.)
 *   chip · chip · chip                           ← always visible
 *   ──────────────────────────────────────────
 *   detail row: key  value                       ← expanded
 *   ...
 *   Items (when applicable):
 *     • name × qty   ₹amount
 *
 * Click anywhere on the card header to toggle expansion. Keyboard:
 * Enter/Space when focused.
 */
import { useState } from "react";

import type { ReviewSource } from "@/lib/review-repo";
import { formatSource } from "./sourceFormat";
import { OcrPreview } from "./OcrPreview";

export function ReviewSourceCard({ source }: { source: ReviewSource }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatSource(source.sourceType, source.rawJson);

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/80 transition-shadow dark:border-zinc-800 dark:bg-zinc-800/40">
      {/* Clickable header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-zinc-100/60 dark:hover:bg-zinc-800/70"
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span aria-hidden className="text-base leading-none">
              {formatted.icon}
            </span>
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {formatted.title}
            </span>
            {formatted.subtitle && (
              <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                · {formatted.subtitle}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <code className="text-zinc-400 dark:text-zinc-500">
              {source.sourceType}
            </code>
            <span
              className="text-zinc-400 transition-transform dark:text-zinc-500"
              style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
              aria-hidden
            >
              ▸
            </span>
          </div>
        </div>

        {formatted.chips.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {formatted.chips.map((chip, i) => (
              <span
                key={i}
                className="inline-flex items-baseline gap-1 rounded bg-white/70 px-1.5 py-0.5 text-[10px] dark:bg-zinc-900/60"
              >
                <span className="text-zinc-500 dark:text-zinc-400">
                  {chip.label}:
                </span>
                <span
                  className={`text-zinc-700 dark:text-zinc-200 ${chip.mono ? "font-mono" : ""}`}
                >
                  {chip.value}
                </span>
              </span>
            ))}
          </div>
        )}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="space-y-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          {/* Key/value rows */}
          {formatted.details.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
              {formatted.details.map((row, i) => (
                <DetailRow key={i} {...row} />
              ))}
            </dl>
          )}

          {/* OCR preview — structured renderer for screenshot OCR text.
              Lifts order id / status / item rows out of the raw monospace
              dump. Has its own "Raw" toggle inside the component. */}
          {formatted.ocrLines && formatted.ocrLines.length > 0 && (
            <OcrPreview lines={formatted.ocrLines} />
          )}

          {/* Itemized list */}
          {formatted.items && formatted.items.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Items ({formatted.items.length})
              </div>
              <ul className="mt-1.5 space-y-1">
                {formatted.items.map((it, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="flex-1 text-zinc-700 dark:text-zinc-200">
                      <span className="text-zinc-400 dark:text-zinc-500">·</span>{" "}
                      {it.name}
                      {it.qty > 1 && (
                        <span className="ml-1 text-zinc-500 dark:text-zinc-400">
                          × {it.qty}
                        </span>
                      )}
                    </span>
                    {it.amount != null && (
                      <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                        ₹{it.amount.toLocaleString("en-IN")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Archive path + ingested timestamp footer */}
          {(source.archivePath || source.ingestedAt) && (
            <div className="border-t border-zinc-100 pt-2 text-[10px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {source.archivePath && (
                <div className="truncate">
                  <span className="font-medium">📎 File:</span> {source.archivePath}
                </div>
              )}
              {source.ingestedAt && (
                <div>
                  <span className="font-medium">Ingested:</span> {source.ingestedAt}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  block,
}: {
  label: string;
  value: string;
  mono?: boolean;
  block?: boolean;
}) {
  if (block) {
    return (
      <>
        <dt className="col-span-2 mt-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {label}
        </dt>
        <dd
          className={`col-span-2 whitespace-pre-wrap break-words rounded bg-white/70 p-2 text-[11px] text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </dd>
      </>
    );
  }
  return (
    <>
      <dt className="font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd
        className={`text-zinc-800 dark:text-zinc-100 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </>
  );
}
