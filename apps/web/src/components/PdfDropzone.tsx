"use client";

import { useCallback, useRef, useState } from "react";

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
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-all ${
          isDragging
            ? "bg-[color:var(--color-accent)]/10 border-[color:var(--color-accent)]"
            : "border-[color:var(--color-border)] bg-[color:var(--color-card)]"
        } ${isProcessing ? "cursor-wait opacity-60" : "hover:border-[color:var(--color-accent)]/60 cursor-pointer"} `}
        aria-label="Upload PDF"
      >
        <div className="mb-4 text-5xl">{isProcessing ? "⏳" : isDragging ? "📥" : "📄"}</div>
        <div className="text-lg font-semibold">{isProcessing ? "Parsing PDF…" : label}</div>
        <div className="mt-2 max-w-md text-sm text-[color:var(--color-muted)]">{hint}</div>
        {!isProcessing && (
          <div className="mt-6 inline-flex rounded-md bg-[color:var(--color-accent)] px-5 py-2 text-sm font-semibold text-[color:var(--color-accent-fg)]">
            or click to choose a file
          </div>
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
          className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 mt-3 rounded-md border px-4 py-3 text-sm text-[color:var(--color-danger)]"
        >
          ⚠️ {errorMsg}
        </div>
      )}
    </div>
  );
}
