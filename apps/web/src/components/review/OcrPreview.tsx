"use client";

/**
 * OcrPreview — structured renderer for OCR text from a screenshot.
 *
 * The raw monospace dump (which we render when stuck OCR'd images couldn't
 * be parsed) is hard to read: phone status-bar lines mix with item names,
 * prices, and order IDs in one undifferentiated block. This component:
 *
 *   1. Classifies each line — order id, item name, unit/qty, price,
 *      delivery status, or phone-chrome noise (clock, battery, "Get Help")
 *   2. Pulls out a "Detected" strip at the top with the order id + item
 *      count + status when present
 *   3. Groups the remaining lines into "item cards" — name + unit + the
 *      adjacent numeric prices, since real receipts emit those as a
 *      contiguous run
 *   4. Fixes the rupee-glyph misread (Vision reads `₹` as `2`, `7`, `{`, or
 *      `Z` depending on font) when the result looks like a plausible amount
 *
 * Falls back to a raw monospace view (toggle in the toolbar) for the case
 * where the heuristics produce a worse layout than the original.
 *
 * Pure component — takes lines, renders. No I/O, no edits, no
 * back-to-server actions. Future work: a "looks like a Zepto receipt —
 * promote to zepto_ocr" button that would re-classify this manual
 * attachment under the proper source type.
 */
import { useMemo, useState } from "react";

export interface OcrPreviewProps {
  lines: string[];
}

type LineKind =
  | "time" // phone clock — "1:41"
  | "battery" // phone battery — "(24"
  | "chrome" // UI buttons — "Get Help", "items in order"
  | "orderId" // "Order #SLTKJBCNN42993"
  | "itemCount" // "9 items"
  | "status" // "Delivered", "Out for delivery"
  | "unit" // "1 pc (750 ml) · 1 unit"
  | "price" // numeric-only line, rupee-prefixed for display
  | "name" // anything else — assumed to be an item name fragment
  | "blank";

interface ClassifiedLine {
  raw: string;
  kind: LineKind;
  /**
   * Display-ready text. For prices, prefixed with ₹ + glyph-fix. For status,
   * stripped of leading ~. For others, trimmed raw text.
   */
  display: string;
}

interface DetectedMetadata {
  orderId?: string;
  itemCount?: number;
  status?: string;
}

interface GroupedItem {
  name: string;
  unit?: string;
  prices: string[];
}

/** Classifies one OCR line by shape. Pure. */
function classifyLine(line: string): ClassifiedLine {
  const t = line.trim();
  if (t === "") return { raw: line, kind: "blank", display: "" };

  if (/^\d{1,2}:\d{2}$/.test(t)) return { raw: line, kind: "time", display: t };
  if (/^\(?\d{1,3}%?\)?$/.test(t) && Number(t.replace(/\D/g, "")) <= 100) {
    return { raw: line, kind: "battery", display: t };
  }
  if (/get\s*help/i.test(t)) return { raw: line, kind: "chrome", display: t };
  if (/^\d+\s+items?\s+in\s+order$/i.test(t)) {
    return { raw: line, kind: "chrome", display: t };
  }

  // Order id — Zepto's is "Order #SLTKJBC…", PhonePe / others may differ
  const orderMatch = /^Order\s*#?\s*([A-Z0-9-]{6,})\s*$/i.exec(t);
  if (orderMatch) {
    return { raw: line, kind: "orderId", display: orderMatch[1]! };
  }

  // Bare "N items" (without "in order")
  const itemCountMatch = /^(\d+)\s+items?$/i.exec(t);
  if (itemCountMatch) {
    return { raw: line, kind: "itemCount", display: t };
  }

  // Delivery status
  if (/^~?\s*(Delivered|In\s+transit|Out\s+for\s+delivery|Paid|Picked\s+up)\b/i.test(t)) {
    const stripped = t.replace(/^~?\s*/, "").replace(/\s+/g, " ");
    return { raw: line, kind: "status", display: stripped };
  }

  // Unit / quantity row — contains pc / piece / g / kg / ml / liter / unit
  if (
    /\b(\d+\s*)(pc|piece|gm?|kg|ml|liter|unit)s?\b/i.test(t) ||
    /\b\d+\s*units?\b/i.test(t)
  ) {
    return { raw: line, kind: "unit", display: t };
  }

  // Price detection. A pure-numeric line of 2–5 digits is almost always a
  // price the OCR mis-typed (the rupee glyph reads as `2`, `7`, `{`, or
  // `Z`). Strip any single non-digit prefix, validate the result is a
  // reasonable amount (₹1–₹99,999) and prefix with ₹.
  const priceMatch = /^[27{Z]?(\d{2,5}(?:\.\d{1,2})?)$/.exec(t);
  if (priceMatch) {
    const num = Number(priceMatch[1]);
    if (Number.isFinite(num) && num >= 1 && num <= 99_999) {
      return { raw: line, kind: "price", display: `₹${priceMatch[1]}` };
    }
  }

  // Anything else: assume name fragment.
  return { raw: line, kind: "name", display: t };
}

function extractMetadata(classified: ClassifiedLine[]): DetectedMetadata {
  const m: DetectedMetadata = {};
  for (const c of classified) {
    if (c.kind === "orderId" && !m.orderId) m.orderId = c.display;
    if (c.kind === "itemCount" && m.itemCount == null) {
      const n = /^(\d+)/.exec(c.display);
      if (n) m.itemCount = Number(n[1]);
    }
    if (c.kind === "status" && !m.status) m.status = c.display;
  }
  return m;
}

/**
 * Walk the classified lines and pair adjacent (name, unit, price) blocks
 * into item rows. Items are the only group that benefits from layout —
 * everything else is rendered inline above.
 */
function groupItems(classified: ClassifiedLine[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  let current: GroupedItem | null = null;

  const flush = () => {
    if (current && (current.name || current.prices.length > 0)) items.push(current);
    current = null;
  };

  for (const c of classified) {
    switch (c.kind) {
      case "name":
        // If the current item already has a price, this name starts a new item.
        // Otherwise extend the current item's name (multi-line names are common).
        if (current && current.prices.length > 0) {
          flush();
        }
        if (!current) current = { name: c.display, prices: [] };
        else current.name = current.name ? `${current.name} ${c.display}` : c.display;
        break;
      case "unit":
        if (!current) current = { name: "", prices: [] };
        current.unit = current.unit ? `${current.unit} · ${c.display}` : c.display;
        break;
      case "price":
        if (!current) current = { name: "", prices: [] };
        current.prices.push(c.display);
        break;
      // metadata + chrome lines never end an item; they're handled separately
      default:
        break;
    }
  }
  flush();
  return items.filter((i) => i.name.length > 0 || i.prices.length > 0);
}

export function OcrPreview({ lines }: OcrPreviewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const classified = useMemo(() => lines.map(classifyLine), [lines]);
  const metadata = useMemo(() => extractMetadata(classified), [classified]);
  const items = useMemo(() => groupItems(classified), [classified]);

  const hasMetadata =
    metadata.orderId || metadata.itemCount != null || metadata.status;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          OCR text ({lines.length} {lines.length === 1 ? "line" : "lines"})
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            title="Toggle structured / raw view"
          >
            {showRaw ? "Structured" : "Raw"}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            title="Copy raw OCR text"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      {showRaw ? (
        <pre className="max-h-96 overflow-auto rounded bg-white/70 p-2 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200">
          {lines.join("\n")}
        </pre>
      ) : (
        <>
          {hasMetadata && (
            <div className="rounded border border-indigo-200 bg-indigo-50/70 px-2.5 py-1.5 text-[11px] dark:border-indigo-900/40 dark:bg-indigo-950/30">
              <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-700/70 dark:text-indigo-300/80">
                Detected
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {metadata.orderId && (
                  <span>
                    <span className="text-indigo-500/80 dark:text-indigo-400/70">
                      Order:
                    </span>{" "}
                    <code className="font-mono text-indigo-900 dark:text-indigo-100">
                      {metadata.orderId}
                    </code>
                  </span>
                )}
                {metadata.itemCount != null && (
                  <span>
                    <span className="text-indigo-500/80 dark:text-indigo-400/70">
                      Items:
                    </span>{" "}
                    <span className="font-medium text-indigo-900 dark:text-indigo-100">
                      {metadata.itemCount}
                    </span>
                  </span>
                )}
                {metadata.status && (
                  <span className="inline-flex items-center gap-1">
                    <span className="text-indigo-500/80 dark:text-indigo-400/70">
                      Status:
                    </span>
                    <span className="rounded bg-emerald-100 px-1 py-px text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      {metadata.status}
                    </span>
                  </span>
                )}
              </div>
            </div>
          )}

          {items.length > 0 ? (
            <ul className="space-y-1.5">
              {items.map((it, i) => (
                <li
                  key={i}
                  className="rounded border border-zinc-200 bg-white/50 px-2.5 py-1.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-zinc-800 dark:text-zinc-100">
                      {it.name || (
                        <em className="text-zinc-400 dark:text-zinc-500">
                          (unnamed)
                        </em>
                      )}
                    </span>
                    {it.prices.length > 0 && (
                      <span className="shrink-0 flex items-baseline gap-1.5 tabular-nums">
                        {it.prices.map((p, j) => (
                          <span
                            key={j}
                            className={
                              j < it.prices.length - 1
                                ? "text-zinc-400 line-through dark:text-zinc-500"
                                : "font-medium text-rose-700 dark:text-rose-400"
                            }
                          >
                            {p}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  {it.unit && (
                    <div className="text-zinc-500 dark:text-zinc-400">
                      {it.unit}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            // No items pattern detected — fall back to a tidy line-by-line view
            <ul className="space-y-0.5 text-[11px]">
              {classified
                .filter((c) => c.kind !== "blank")
                .filter((c) => c.kind !== "orderId" && c.kind !== "itemCount" && c.kind !== "status")
                .map((c, i) => (
                  <ClassifiedLineRow key={i} line={c} />
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ClassifiedLineRow({ line }: { line: ClassifiedLine }) {
  switch (line.kind) {
    case "time":
    case "battery":
    case "chrome":
      return (
        <li className="text-zinc-400 line-through dark:text-zinc-600">
          {line.display}
        </li>
      );
    case "price":
      return (
        <li className="font-medium tabular-nums text-rose-700 dark:text-rose-400">
          {line.display}
        </li>
      );
    case "unit":
      return (
        <li className="text-zinc-500 dark:text-zinc-400">{line.display}</li>
      );
    case "name":
      return (
        <li className="font-medium text-zinc-800 dark:text-zinc-100">
          {line.display}
        </li>
      );
    default:
      return <li className="text-zinc-600 dark:text-zinc-300">{line.display}</li>;
  }
}
