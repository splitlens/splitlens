"use client";

/**
 * Drop-zone tile for Google Maps Timeline imports. Accepts a Takeout .zip
 * or individual JSON files (Records.json / Semantic Location History).
 * Calls the `ingestGoogleTimeline` server action and renders the outcome
 * inline. Imports list + wipe controls below.
 *
 * No external deps; mirrors the visual language of the existing
 * PdfDropzone but with copy + accept set tuned for Takeout exports.
 */

import { useCallback, useRef, useState, useTransition } from "react";

import { Ico } from "@/components/Ico";
import {
  deleteLocationImport,
  ingestGoogleTimeline,
  wipeAllLocationHistory,
  type LocationImportResult,
  type LocationImportRow,
} from "@/app/try/location-actions";

const ACCEPTED_EXTENSIONS = [".zip", ".json"] as const;

function fmtRecords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  if (s === e) return s;
  return `${s} → ${e}`;
}

function fmtImportedAt(iso: string): string {
  // SQLite ISO without TZ → "2026-05-17 18:23:00" → display as date only.
  return (iso || "").slice(0, 10);
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("FileReader result is not a string"));
        return;
      }
      // Data URL: "data:application/zip;base64,XXXXX"
      const comma = r.indexOf(",");
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export interface LocationImportTileProps {
  imports: LocationImportRow[];
}

export function LocationImportTile({
  imports: initialImports,
}: LocationImportTileProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imports, setImports] = useState<LocationImportRow[]>(initialImports);
  const [isDragging, setIsDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LocationImportResult | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const handleFile = useCallback(async (file: File | null | undefined) => {
    setResult(null);
    if (!file) return;
    const lower = file.name.toLowerCase();
    const okExt = ACCEPTED_EXTENSIONS.some((e) => lower.endsWith(e));
    if (!okExt) {
      setResult({
        ok: false,
        error: `Not a Takeout file: ${file.name}. Drop a .zip or .json.`,
      });
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setResult({ ok: false, error: "File too large (>200 MB)." });
      return;
    }
    setFilename(file.name);
    let base64: string;
    try {
      base64 = await readFileAsBase64(file);
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : "could not read file",
      });
      return;
    }
    startTransition(async () => {
      const r = await ingestGoogleTimeline(file.name, base64);
      setResult(r);
      if (r.ok && r.kind === "imported") {
        // Optimistic — server revalidatePath will refresh on next navigation,
        // but we also patch local state so the imports list updates now.
        setImports((prev) => [
          {
            id: r.importId ?? 0,
            periodFrom: r.periodFromUtc ?? null,
            periodTo: r.periodToUtc ?? null,
            recordCount: r.recordCount ?? 0,
            semanticCount: r.semanticCount ?? 0,
            importedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    });
  }, []);

  const handleDeleteImport = useCallback((id: number) => {
    startTransition(async () => {
      const r = await deleteLocationImport(id);
      if (r.ok) {
        setImports((prev) => prev.filter((row) => row.id !== id));
      }
    });
  }, []);

  const handleWipeAll = useCallback(() => {
    startTransition(async () => {
      await wipeAllLocationHistory();
      setImports([]);
      setResult(null);
      setConfirmWipe(false);
    });
  }, []);

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
        disabled={pending}
        className="surface-dashed flex w-full flex-col items-center justify-center"
        style={{
          padding: "44px 24px",
          textAlign: "center",
          transition: "background 120ms ease, border-color 120ms ease",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.6 : 1,
          background: isDragging ? "var(--accent-soft)" : "var(--surface)",
          borderColor: isDragging ? "var(--accent-line)" : "var(--border-dashed)",
          color: "var(--fg)",
          fontFamily: "inherit",
          gap: 10,
        }}
      >
        <Ico name="sparkles" size={20} className="accent" />
        <div className="h2" style={{ margin: 0 }}>
          {pending
            ? `Importing ${filename ?? "your timeline"}…`
            : "Drop your Google Takeout export here"}
        </div>
        <div className="small muted" style={{ maxWidth: 480 }}>
          Accepts the full Takeout <span className="kbd">.zip</span>, a bare{" "}
          <span className="kbd">Records.json</span>, or a Semantic Location
          History monthly <span className="kbd">.json</span>. Stored on this
          device only — never uploaded anywhere.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          style={{ display: "none" }}
        />
      </button>

      {/* Result banner */}
      {result &&
        (result.ok ? (
          <div
            className="surface"
            style={{
              padding: 14,
              borderColor: "var(--accent-line)",
              background: "var(--accent-soft)",
            }}
          >
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              <Ico name="check" size={14} className="accent" />
              <span className="h2">
                {result.kind === "imported"
                  ? "Imported."
                  : "Already imported — nothing new to add."}
              </span>
            </div>
            {result.kind === "imported" && (
              <p className="small muted" style={{ margin: 0 }}>
                {fmtRecords(result.recordCount ?? 0)} raw pings ·{" "}
                {fmtRecords(result.semanticCount ?? 0)} place visits ·{" "}
                {fmtPeriod(result.periodFromUtc ?? null, result.periodToUtc ?? null)}{" "}
                · took {Math.round(result.durationMs / 1000)}s
              </p>
            )}
          </div>
        ) : (
          <div
            className="surface"
            style={{
              padding: 14,
              borderColor: "var(--border-strong)",
              background: "var(--surface-2)",
            }}
          >
            <span className="small" style={{ color: "var(--debit)" }}>
              {result.error}
            </span>
          </div>
        ))}

      {/* Existing imports list */}
      {imports.length > 0 && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Past imports</span>
            <span className="tag mono">{imports.length}</span>
          </div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            {imports.map((row) => (
              <div
                key={row.id}
                className="surface flex items-center justify-between"
                style={{ padding: "10px 12px", gap: 12 }}
              >
                <div className="flex flex-col" style={{ gap: 2 }}>
                  <span className="small">
                    {fmtPeriod(row.periodFrom, row.periodTo)}
                  </span>
                  <span className="tiny muted">
                    {fmtRecords(row.recordCount)} pings ·{" "}
                    {fmtRecords(row.semanticCount)} places · imported{" "}
                    {fmtImportedAt(row.importedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm ghost"
                  onClick={() => handleDeleteImport(row.id)}
                  disabled={pending}
                  title="Delete this import — keeps other imports intact"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          {!confirmWipe ? (
            <button
              type="button"
              className="btn btn-sm ghost"
              style={{ alignSelf: "flex-start", color: "var(--muted)" }}
              onClick={() => setConfirmWipe(true)}
            >
              Wipe all location history
            </button>
          ) : (
            <div
              className="surface flex items-center justify-between"
              style={{
                padding: "10px 12px",
                gap: 12,
                borderColor: "var(--border-strong)",
              }}
            >
              <span className="small">
                Wipe every location import? Your transactions and labels stay.
              </span>
              <div className="flex items-center" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm ghost"
                  onClick={() => setConfirmWipe(false)}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm primary"
                  style={{ background: "var(--debit)", borderColor: "var(--debit)" }}
                  onClick={handleWipeAll}
                  disabled={pending}
                >
                  Wipe everything
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
