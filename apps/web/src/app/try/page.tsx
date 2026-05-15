import Link from "next/link";

/**
 * Browser-side PDF upload is deprecated as of P5 — the daemon now handles
 * ingestion, and the canonical store is the on-disk SQLite at
 * ~/Library/Application Support/splitlens/splitlens.sqlite.
 *
 * The previous in-browser parsing flow that lived here lost data on every
 * tab refresh (PGlite is gone too). Drop new statements into
 * ~/Documents/bank/inbox/ instead — the daemon picks them up automatically.
 *
 * This page intentionally stays as a stub so people who bookmarked it can
 * find the new flow.
 */
export default function TryPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Drop statements in your bank folder
      </h1>
      <p className="mt-4 text-zinc-700 leading-relaxed">
        The browser upload page has been replaced. SplitLens now runs a small
        background daemon on your machine that watches{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
          ~/Documents/bank/inbox/
        </code>{" "}
        and ingests any new statement PDF you drop in. Your data lives at{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
          ~/Library/Application Support/splitlens/splitlens.sqlite
        </code>
        .
      </p>
      <h2 className="mt-10 text-lg font-medium text-zinc-900">Set it up once</h2>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-100">
{`cd splitlens
pnpm --filter @splitlens/daemon install-launchd
# prompts for the PhonePe / HDFC / HDFC-CC passwords once`}
      </pre>
      <h2 className="mt-8 text-lg font-medium text-zinc-900">Then just drop files</h2>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-100">
{`mv ~/Downloads/PhonePe_Transaction_Statement*.pdf ~/Documents/bank/inbox/
# the daemon classifies, ingests, archives — your dashboard updates`}
      </pre>
      <Link
        href="/dashboard"
        className="mt-10 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Go to dashboard →
      </Link>
    </main>
  );
}
