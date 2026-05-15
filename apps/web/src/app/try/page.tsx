"use client";

import Link from "next/link";
import { useState } from "react";
import { parseHdfcSavings, parseHdfcCc } from "@splitlens/core";
import type { CcRawTransaction, ParseResult, CcParseResult } from "@splitlens/core";
import { extractPagesPositional, extractTextPages } from "@/lib/pdf-extract";
import { PdfDropzone } from "@/components/PdfDropzone";
import { TransactionTable } from "@/components/TransactionTable";
import { fmtInr, fmtInrExact } from "@/lib/format";
import { saveSavingsResult, saveCcResult, type SaveResult } from "@/lib/repo";

type Result =
  | { kind: "savings"; data: ParseResult; fileName: string; save?: SaveResult }
  | { kind: "cc"; data: CcParseResult; fileName: string; save?: SaveResult };

/**
 * Detect a pdfjs PasswordException reliably. pdfjs throws an object with
 * `name === "PasswordException"` and a `code` (1=NEED, 2=INCORRECT). The
 * .message also contains "password", but the name check is more robust.
 */
function isPasswordError(err: unknown): "missing" | "wrong" | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { name?: string; code?: number; message?: string };
  if (e.name === "PasswordException") {
    return e.code === 2 ? "wrong" : "missing";
  }
  const m = String(e.message ?? "");
  if (/incorrect.*password|wrong.*password/i.test(m)) return "wrong";
  if (/no.*password|password.*required|password-protected/i.test(m)) return "missing";
  return null;
}

export default function TryPage() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  /** Last dropped file — kept so the user can retry after entering a password. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  async function parseFile(file: File, pwd: string) {
    setIsProcessing(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const isCc = /Billedstatements|_\d{4}_/.test(file.name);

      // Always-on console log so the user can paste back the parser path
      console.log(
        `[SplitLens] Parsing ${file.name} as ${isCc ? "CC" : "Savings"} (size=${buf.length} bytes, password=${pwd ? "yes" : "no"})`,
      );

      if (isCc) {
        const data = await parseHdfcCc(buf, {
          password: pwd || undefined,
          extractTextPages,
        });
        let save: SaveResult | undefined;
        if (data.statement) {
          save = await saveCcResult(file.name, data.statement, data.transactions);
        }
        setResult({ kind: "cc", data, fileName: file.name, save });
      } else {
        const data = await parseHdfcSavings(buf, {
          password: pwd || undefined,
          extractPages: extractPagesPositional,
        });
        let save: SaveResult | undefined;
        if (data.statement) {
          save = await saveSavingsResult(file.name, data.statement, data.transactions);
        }
        setResult({ kind: "savings", data, fileName: file.name, save });
      }
      // Success — clear the pending file
      setPendingFile(null);
    } catch (err: unknown) {
      const pwState = isPasswordError(err);
      if (pwState === "missing") {
        setErrorMsg("This PDF needs a password. Enter it below and click 'Parse'.");
      } else if (pwState === "wrong") {
        setErrorMsg("Wrong password. Try again.");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
      }
      // Keep pendingFile so the retry button works
    } finally {
      setIsProcessing(false);
    }
  }

  function handleFile(file: File) {
    setPendingFile(file);
    // Enable verbose pdfjs diagnostics so we can debug coordinate mismatches
    if (typeof window !== "undefined") {
      (window as unknown as { SPLITLENS_DEBUG_PDF?: boolean }).SPLITLENS_DEBUG_PDF = true;
    }
    return parseFile(file, password);
  }

  function retry() {
    if (pendingFile) void parseFile(pendingFile, password);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">Drop your statement</h1>
        <p className="mt-2 max-w-2xl text-[color:var(--color-muted)]">
          The PDF is parsed in this browser tab. <strong>Nothing is uploaded.</strong> Open DevTools
          → Network and watch — there will be zero outgoing requests with your data.
        </p>
      </header>

      <section className="mb-6">
        <PdfDropzone onFile={handleFile} isProcessing={isProcessing} />
      </section>

      <section className="mb-6">
        <label htmlFor="pwd" className="mb-1 block text-sm text-[color:var(--color-muted)]">
          PDF password (if any)
        </label>
        <div className="flex gap-3">
          <input
            id="pwd"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pendingFile && !isProcessing) {
                e.preventDefault();
                retry();
              }
            }}
            placeholder="HDFC default: first 4 chars of name + DDMM of birth"
            className="flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
            disabled={isProcessing}
          />
          {pendingFile && (
            <button
              type="button"
              onClick={retry}
              disabled={isProcessing}
              className="rounded-md bg-[color:var(--color-accent)] px-5 py-2 text-sm font-semibold text-[color:var(--color-accent-fg)] disabled:opacity-50"
            >
              {isProcessing ? "Parsing…" : "Parse"}
            </button>
          )}
        </div>
        {pendingFile && !errorMsg && !result && (
          <p className="mt-2 text-xs text-[color:var(--color-muted)]">
            File ready: <strong>{pendingFile.name}</strong> — enter the password and press Enter (or
            click Parse).
          </p>
        )}
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 mb-6 rounded-md border px-4 py-3 text-sm text-[color:var(--color-danger)]"
        >
          ⚠️ {errorMsg}
          {pendingFile && (
            <span className="ml-2 text-[color:var(--color-muted)]">({pendingFile.name})</span>
          )}
        </div>
      )}

      {result && <ResultView result={result} />}
    </main>
  );
}

function SavedBanner({ save }: { save: SaveResult | undefined }) {
  if (!save) return null;
  const { inserted, skippedSameStatement, skippedDuplicate } = save;

  const parts: string[] = [];
  if (inserted > 0) parts.push(`✅ ${inserted} new`);
  if (skippedDuplicate > 0)
    parts.push(`🔁 ${skippedDuplicate} already imported from another statement`);
  if (skippedSameStatement > 0) parts.push(`♻️ ${skippedSameStatement} re-import`);

  const summary = parts.length > 0 ? parts.join(" · ") : "Nothing to save.";

  return (
    <div className="border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10 rounded-md border px-4 py-3 text-sm text-[color:var(--color-success)]">
      💾 <strong>Saved to local DB.</strong> {summary}{" "}
      <Link href="/dashboard" className="underline hover:opacity-80">
        Open dashboard →
      </Link>
      {skippedDuplicate > 0 && (
        <div className="mt-1 text-xs opacity-80">
          Cross-statement deduplication: SplitLens recognized these transactions from a different
          PDF you&apos;ve already uploaded (matched by bank reference number). They aren&apos;t
          double-counted.
        </div>
      )}
    </div>
  );
}

function ResultView({ result }: { result: Result }) {
  if (result.kind === "savings") {
    const { statement, transactions } = result.data;
    const totalOut = transactions.reduce((s, t) => s + (t.withdrawal ?? 0), 0);
    const totalIn = transactions.reduce((s, t) => s + (t.deposit ?? 0), 0);
    return (
      <section className="space-y-6">
        <SavedBanner save={result.save} />
        <header className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-6">
          <div className="text-sm text-[color:var(--color-muted)]">{result.fileName}</div>
          <h2 className="mt-1 text-2xl font-bold">
            {statement?.bank} Savings ···{statement?.accountLast4}
          </h2>
          {statement?.periodFrom && statement?.periodTo && (
            <div className="mt-1 text-sm text-[color:var(--color-muted)]">
              Period: {statement.periodFrom} → {statement.periodTo}
            </div>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Transactions" value={transactions.length.toString()} />
            <Stat label="Total OUT" value={fmtInrExact(totalOut)} accent="danger" />
            <Stat label="Total IN" value={fmtInrExact(totalIn)} accent="success" />
          </div>
        </header>

        <TransactionTable rows={transactions} max={100} />
      </section>
    );
  }

  // Credit card
  const { statement, transactions } = result.data;
  const purchases = transactions.filter((t) => !t.isPayment);
  const payments = transactions.filter((t) => t.isPayment);
  const totalSpent = purchases.reduce((s, t) => s + t.amount, 0);
  const totalPaid = payments.reduce((s, t) => s + t.amount, 0);

  // Map CC txns to the savings-shaped row schema for the same TransactionTable
  const tableRows = transactions.map((t: CcRawTransaction) => ({
    txnDate: t.txnDate,
    narration: t.foreignAmount ? `${t.description} (${t.foreignAmount})` : t.description,
    withdrawal: t.isPayment ? null : t.amount,
    deposit: t.isPayment ? t.amount : null,
  }));

  return (
    <section className="space-y-6">
      <SavedBanner save={result.save} />
      <header className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-6">
        <div className="text-sm text-[color:var(--color-muted)]">{result.fileName}</div>
        <h2 className="mt-1 text-2xl font-bold">
          {statement?.bank} {statement?.cardType} CC ···{statement?.cardLast4}
        </h2>
        {statement?.periodFrom && statement?.periodTo && (
          <div className="mt-1 text-sm text-[color:var(--color-muted)]">
            Billing period: {statement.periodFrom} → {statement.periodTo}
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Purchases" value={purchases.length.toString()} />
          <Stat label="Total spent" value={fmtInrExact(totalSpent)} accent="danger" />
          <Stat label="Total paid" value={fmtInrExact(totalPaid)} accent="success" />
        </div>
      </header>

      <TransactionTable rows={tableRows} max={100} />
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "danger" | "success";
}) {
  const color =
    accent === "danger"
      ? "text-[color:var(--color-danger)]"
      : accent === "success"
        ? "text-[color:var(--color-success)]"
        : "text-[color:var(--color-fg)]";
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{fmtInr === undefined ? "" : value}</div>
    </div>
  );
}
