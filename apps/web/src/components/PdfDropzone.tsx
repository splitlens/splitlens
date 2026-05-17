"use client";

import { useCallback, useRef, useState } from "react";

import { Ico } from "./Ico";

export interface PdfDropzoneProps {
  onFile: (file: File) => void | Promise<void>;
  isProcessing?: boolean;
  /** Optional copy override */
  label?: string;
  hint?: string;
}

/**
 * Drag-and-drop PDF dropzone. Accessible (keyboard + click), with visual states
 * for hover/dragover/processing. No external deps.
 */
export function PdfDropzone({
  onFile,
  isProcessing = false,
  label = "Drop your bank statement PDF here",
  hint = "HDFC savings or credit card · processed entirely in your browser · nothing uploaded",
}: PdfDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | null | undefined) => {
      setErrorMsg(null);
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        setErrorMsg(`Not a PDF: ${file.name}`);
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setErrorMsg("File too large (>50 MB). HDFC statements should be well under this.");
        return;
      }
      await onFile(file);
    },
    [onFile],
  );

  return (
    <div className="w-full">
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
        disabled={isProcessing}
        className="surface-dashed flex w-full flex-col items-center justify-center"
        style={{
          padding: "56px 24px",
          textAlign: "center",
          transition: "background 120ms ease, border-color 120ms ease",
          cursor: isProcessing ? "wait" : "pointer",
          opacity: isProcessing ? 0.6 : 1,
          background: isDragging ? "var(--accent-soft)" : "var(--surface)",
          borderColor: isDragging ? "var(--accent-line)" : "var(--border-dashed)",
          color: "var(--fg)",
          fontFamily: "inherit",
        }}
        aria-label="Upload PDF"
      >
        <div
          className="flex items-center justify-center"
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            marginBottom: 16,
            background: isDragging ? "var(--accent-soft)" : "var(--surface-2)",
            border: `1px solid ${
              isDragging ? "var(--accent-line)" : "var(--border)"
            }`,
            color: isDragging ? "var(--accent)" : "var(--fg-2)",
          }}
        >
          {isProcessing ? (
            <Ico name="sparkles" size={22} />
          ) : isDragging ? (
            <Ico name="corner-down-right" size={22} />
          ) : (
            <Ico name="paperclip" size={22} />
          )}
        </div>

        <div className="h2" style={{ marginBottom: 6 }}>
          {isProcessing ? "Parsing PDF…" : label}
        </div>
        <div className="small muted" style={{ maxWidth: 460 }}>
          {hint}
        </div>

        {!isProcessing && (
          <span
            className="btn primary btn-sm"
            style={{ marginTop: 22, pointerEvents: "none" }}
            aria-hidden
          >
            <Ico name="paperclip" size={13} /> or click to choose a file
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {errorMsg && (
        <div
          role="alert"
          className="flex items-center gap-2 small"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--debit) 40%, transparent)",
            background: "color-mix(in srgb, var(--debit) 10%, transparent)",
            color: "var(--debit)",
          }}
        >
          <Ico name="flag" size={13} />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
