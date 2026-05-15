"use client";

import Link from "next/link";
import { useState } from "react";
import { parseHdfcSavings, parseHdfcCc } from "@splitlens/core";
import type { CcRawTransaction, ParseResult, CcParseResult } from "@splitlens/core";
import { extractPagesPositional, extractTextPages } from "@/lib/pdf-extract";
import { PdfDropzone } from "@/components/PdfDropzone";
import { TransactionTable } from "@/components/TransactionTable";
import { fmtInr, fmtInrExact } from "@/lib/format";

type Result =
  | { kind: "savings"; data: ParseResult; fileName: string }
  | { kind: "cc"; data: CcParseResult; fileName: string };

export default function TryPage() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  async function handleFile(file: File) {
    setIsProcessing(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());

      // Auto-detect: filename pattern hints at credit-card vs savings statement.
      // HDFC CC statements are named like "Apr2026_Billedstatements_3969_*.pdf".
      // HDFC savings statements are named "Acct_Statement_XXXXXXXX2491_*.pdf".
      const isCc = /Billedstatements|_\d{4}_/.test(file.name);

      if (isCc) {
        const data = await parseHdfcCc(buf, {
          password: password || undefined,
          extractTextPages,
        });
        setResult({ kind: "cc", data, fileName: file.name });
      } else {
        const data = await parseHdfcSavings(buf, {
          password: password || undefined,
          extractPages: extractPagesPositional,
        });
        setResult({ kind: "savings", data, fileName: file.name });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message.includes("password") || err.message.includes("Password")
            ? "PDF is password-protected — enter the password and try again."
            : err.message
          : String(err);
      setErrorMsg(msg);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <Link
          href="/"
          className="mb-3 inline-block text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
        >
          ← Back to home
        </Link>
        <h1 className="text-4xl font-bold tracking-tight">Drop your statement</h1>
        <p className="mt-2 max-w-2xl text-[color:var(--color-muted)]">
          The PDF is parsed in this browser tab. <strong>Nothing is uploaded.</strong> Open DevTools
          → Network and watch — there will be zero outgoing requests with your data.
        </p>
      </header>

      <section className="mb-6">
        <PdfDropzone onFile={handleFile} isProcessing={isProcessing} />
      </section>

      <section className="mb-10 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="pwd" className="mb-1 block text-sm text-[color:var(--color-muted)]">
            PDF password (if any)
          </label>
          <input
            id="pwd"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="HDFC default: first 4 chars of name + DDMM of birth"
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
          />
        </div>
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 mb-6 rounded-md border px-4 py-3 text-sm text-[color:var(--color-danger)]"
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {result && <ResultView result={result} />}
    </main>
  );
}

function ResultView({ result }: { result: Result }) {
  if (result.kind === "savings") {
    const { statement, transactions } = result.data;
    const totalOut = transactions.reduce((s, t) => s + (t.withdrawal ?? 0), 0);
    const totalIn = transactions.reduce((s, t) => s + (t.deposit ?? 0), 0);
    return (
      <section className="space-y-6">
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
