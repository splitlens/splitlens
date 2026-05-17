"use client";

/**
 * CreateCategoryForm — inline mini-form for adding a custom category.
 *
 * Used by the InboxModal's category chip grid: when the user clicks the
 * dashed "+ New category" pseudo-chip, the form expands in place. Three
 * required fields:
 *   - Label   — display name (also drives the canonical id, PascalCased)
 *   - Emoji   — single glyph
 *   - Color   — pick one of the 17-swatch palette keys
 *
 * On success, calls onCreated(id) so the parent can immediately select the
 * new category. The action revalidates `/review` so the chip appears in
 * the picker on the next render.
 */
import { useState, useTransition } from "react";

import { createCustomCategory } from "@/app/review/actions";
import { COLOR_PALETTE_KEYS, type ColorKey } from "@/lib/taxonomy";

export interface CreateCategoryFormProps {
  onCancel: () => void;
  onCreated: (newId: string) => void;
}

/** Convert a label like "Office canteen" → "OfficeCanteen". */
function deriveId(label: string): string {
  const slug = label
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
  return slug || `Custom${Date.now().toString(36)}`;
}

const SWATCH_HEX: Record<ColorKey, string> = {
  rose: "#fb7185",
  orange: "#fb923c",
  amber: "#fbbf24",
  yellow: "#facc15",
  lime: "#a3e635",
  green: "#4ade80",
  emerald: "#34d399",
  teal: "#2dd4bf",
  cyan: "#22d3ee",
  sky: "#38bdf8",
  blue: "#60a5fa",
  indigo: "#818cf8",
  violet: "#a78bfa",
  purple: "#c084fc",
  fuchsia: "#e879f9",
  pink: "#f472b6",
  red: "#f87171",
};

export function CreateCategoryForm({
  onCancel,
  onCreated,
}: CreateCategoryFormProps) {
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("✨");
  const [colorKey, setColorKey] = useState<ColorKey>("indigo");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    label.trim().length >= 2 && emoji.trim().length > 0 && !pending;

  const submit = () => {
    setErr(null);
    const id = deriveId(label);
    startTransition(async () => {
      const r = await createCustomCategory({
        id,
        label: label.trim(),
        emoji: emoji.trim(),
        colorKey,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onCreated(id);
    });
  };

  return (
    <div
      className="surface flex flex-col"
      style={{ padding: 14, gap: 10, marginTop: 6 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 64px",
          gap: 8,
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Maid"
            maxLength={32}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
            style={{
              padding: "6px 10px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--fg)",
              fontFamily: "inherit",
              fontSize: 13,
              outline: "none",
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Emoji</span>
          <input
            type="text"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🧹"
            maxLength={4}
            style={{
              padding: "6px 10px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--fg)",
              fontFamily: "inherit",
              fontSize: 16,
              textAlign: "center",
              outline: "none",
            }}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">Color</span>
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {COLOR_PALETTE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setColorKey(k)}
              title={k}
              aria-pressed={k === colorKey}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: SWATCH_HEX[k],
                border:
                  k === colorKey
                    ? `2px solid var(--fg)`
                    : "1px solid rgba(255,255,255,0.15)",
                outline:
                  k === colorKey
                    ? `2px solid var(--bg)`
                    : "none",
                outlineOffset: -2,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      {err && (
        <div className="small debit">⚠ {err}</div>
      )}

      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span className="tiny muted-2">
          id <code className="mono">{deriveId(label || "Custom")}</code>
        </span>
        <div className="flex items-center" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-sm outline"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="btn btn-sm primary"
          >
            {pending ? "Adding…" : "Add category"}
          </button>
        </div>
      </div>
    </div>
  );
}
