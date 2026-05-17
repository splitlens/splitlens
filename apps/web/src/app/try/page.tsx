import Link from "next/link";

import { Ico } from "@/components/Ico";
import { LocationImportTile } from "@/components/LocationImportTile";
import { listLocationImports } from "./location-actions";

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
export default async function TryPage() {
  const locationImports = await listLocationImports();
  return (
    <main className="mx-auto" style={{ maxWidth: 720, padding: "48px 32px 64px" }}>
      {/* Page header — eyebrow + serif display + deck (mirrors ReviewLayout) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="eyebrow eyebrow-accent">Upload · ingest a statement</span>
          <span className="tag">
            Upload<span className="muted-2">/</span>Daemon
            <span className="muted-2">/</span>watcher
          </span>
        </div>
        <h1 className="display" style={{ fontSize: 40 }}>
          Drop statements in your bank folder.
          <span className="muted">
            {" "}
            The daemon classifies, ingests, archives — your dashboard updates.
          </span>
        </h1>
        <p className="body" style={{ color: "var(--fg-2)", maxWidth: 620 }}>
          The browser upload page has been replaced. SplitLens now runs a small
          background daemon on your machine that watches{" "}
          <span className="kbd">~/Documents/bank/inbox/</span> and ingests any
          new statement PDF you drop in. Your data lives at{" "}
          <span className="kbd">
            ~/Library/Application Support/splitlens/splitlens.sqlite
          </span>
          .
        </p>
      </div>

      <hr className="hr-dashed" style={{ margin: "28px 0 20px" }} />

      {/* Step 1 — install the daemon */}
      <section className="flex flex-col gap-3" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-2">
          <span className="chip chip-sm accent">
            <span className="mono">01</span>
          </span>
          <span className="eyebrow">Set it up once</span>
        </div>
        <h2 className="h2">Install the launchd watcher</h2>
        <div
          className="surface"
          style={{
            padding: 16,
            background: "var(--surface-2)",
            overflowX: "auto",
          }}
        >
          <pre
            className="mono small"
            style={{
              margin: 0,
              color: "var(--fg-2)",
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
{`cd splitlens
pnpm --filter @splitlens/daemon install-launchd
# prompts for the PhonePe / HDFC / HDFC-CC passwords once`}
          </pre>
        </div>
      </section>

      {/* Step 2 — drop files */}
      <section className="flex flex-col gap-3" style={{ marginBottom: 28 }}>
        <div className="flex items-center gap-2">
          <span className="chip chip-sm accent">
            <span className="mono">02</span>
          </span>
          <span className="eyebrow">Then just drop files</span>
        </div>
        <h2 className="h2">Move a PDF into the inbox folder</h2>
        <div
          className="surface"
          style={{
            padding: 16,
            background: "var(--surface-2)",
            overflowX: "auto",
          }}
        >
          <pre
            className="mono small"
            style={{
              margin: 0,
              color: "var(--fg-2)",
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
{`mv ~/Downloads/PhonePe_Transaction_Statement*.pdf ~/Documents/bank/inbox/
# the daemon classifies, ingests, archives — your dashboard updates`}
          </pre>
        </div>
        <p className="small muted">
          <Ico name="paperclip" size={13} /> Statements stay on your machine.
          Nothing is uploaded anywhere.
        </p>
      </section>

      {/* Optional — Google Maps Timeline import. Enriches transactions
          that have a time stamp (PhonePe, HDFC InstaAlert-backfilled) with
          where you were when they happened. Strictly local. */}
      <hr className="hr-dashed" style={{ margin: "28px 0 20px" }} />
      <section className="flex flex-col gap-3" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-2">
          <span className="chip chip-sm ghost">
            <span className="mono">+</span>
          </span>
          <span className="eyebrow">Optional · enrich with location</span>
        </div>
        <h2 className="h2">Add your Google Maps Timeline</h2>
        <p className="body" style={{ color: "var(--fg-2)", maxWidth: 620 }}>
          Google&rsquo;s been quietly building a place-by-place log of where
          you&rsquo;ve been. Drop the Takeout export here and SplitLens will
          line up each transaction&rsquo;s time with the place you were at —
          so an Apple charge becomes &ldquo;iCloud+ 200GB&rdquo;, but a ₹999
          charge becomes{" "}
          <span className="serif" style={{ fontSize: 14 }}>
            Cult.fit Indiranagar
          </span>
          . Export from{" "}
          <a
            href="https://takeout.google.com/settings/takeout/custom/location_history"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            Google Takeout · Location History
          </a>
          .
        </p>
        <LocationImportTile imports={locationImports} />
      </section>

      <hr className="hr-dashed" style={{ margin: "28px 0 20px" }} />

      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="btn primary btn-lg"
          style={{ textDecoration: "none" }}
        >
          Go to dashboard <Ico name="arrow-right" size={14} />
        </Link>
        <Link
          href="/review"
          className="btn outline btn-lg"
          style={{ textDecoration: "none" }}
        >
          <Ico name="inbox" size={14} /> Review queue
        </Link>
      </div>
    </main>
  );
}
