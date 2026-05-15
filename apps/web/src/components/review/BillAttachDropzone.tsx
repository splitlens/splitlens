"use client";

/**
 * BillAttachDropzone — small drag-and-drop area inside the review form.
 *
 * Different from the existing top-level PdfDropzone (used by /try for bank
 * statements) in two ways:
 *   - Smaller and visually quieter (it lives inside a busy form)
 *   - Force-attaches to the txn id passed in, instead of going through
 *     filename classification
 *
 * Accepts PDF + common image formats. Bytes travel base64-encoded through a
 * server action — fine for the <25 MB receipts we see in practice.
 */
import { useCallback, useRef, useState } from "react";

import {
  attachBillToTransaction,
  type AttachBillResult,
} from "@/app/review/actions";

const ACCEPTED = new Set([".pdf", ".png", ".jpg", ".jpeg", ".heic"]);
const ACCEPT_ATTR = "application/pdf,.pdf,image/png,.png,image/jpeg,.jpg,.jpeg,image/heic,.heic";

export interface BillAttachDropzoneProps {
  txnId: number;
  onAttached: (result: AttachBillResult) => void;
}

export function BillAttachDropzone({ txnId, onAttached }: BillAttachDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setLocalErr(null);
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ACCEPTED.has(ext)) {
        setLocalErr(`Unsupported file type: ${ext}. Accepted: PDF, PNG, JPG, HEIC.`);
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        setLocalErr("File too large (>25 MB).");
        return;
      }
      setBusy(true);
      try {
        const bytes = await file.arrayBuffer();
        const base64 = bufferToBase64(new Uint8Array(bytes));
        const result = await attachBillToTransaction(txnId, file.name, base64);
        onAttached(result);
      } catch (e) {
        setLocalErr(e instanceof Error ? e.message : "upload failed");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onAttached, txnId],
  );

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        disabled={busy}
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-xs transition-all ${
          dragging
            ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/30"
            : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800/30 dark:hover:border-zinc-600"
        } ${busy ? "cursor-wait opacity-60" : "cursor-pointer"}`}
        aria-label={`Attach a bill to transaction ${txnId}`}
      >
        <div className="text-2xl" aria-hidden>
          {busy ? "⏳" : dragging ? "📥" : "📎"}
        </div>
        <div className="text-zinc-700 dark:text-zinc-200">
          {busy
            ? "Processing…"
            : dragging
              ? "Drop to attach"
              : "Drag a PDF or screenshot here"}
        </div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
          or click to choose · zepto_invoice_*.pdf parsed inline, others queued for the daemon
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {localErr && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
        >
          {localErr}
        </div>
      )}
    </div>
  );
}

/** Encode a Uint8Array to base64. Browser-only — runs inside the dropzone. */
function bufferToBase64(bytes: Uint8Array): string {
  // 16 KB chunks to keep the call stack happy on big files.
  const CHUNK = 0x4000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(bin);
}
