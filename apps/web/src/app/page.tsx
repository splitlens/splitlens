/**
 * SplitLens — landing page
 * Local-first hero. Privacy as the wedge. Honest CTAs.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      {/* Hero */}
      <section className="space-y-8">
        <div className="flex items-center gap-2 text-sm text-[color:var(--color-muted)]">
          <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-1">
            🔒 100% on your device · open source · AGPL-3.0
          </span>
        </div>

        <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
          Your bank statements. <br />
          <span className="text-[color:var(--color-accent)]">Your spending, clearly.</span>
        </h1>

        <p className="max-w-2xl text-xl text-[color:var(--color-muted)]">
          Drop your HDFC PDFs. SplitLens parses them, categorizes every transaction, and shows
          you where your money actually went — split shared expenses with flatmates, settle
          cleanly. <strong className="text-[color:var(--color-fg)]">Nothing leaves your browser.</strong>
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href="#try"
            className="inline-flex items-center justify-center rounded-md bg-[color:var(--color-accent)] px-6 py-3 font-semibold text-[color:var(--color-accent-fg)] transition-opacity hover:opacity-90"
          >
            Try it now (free)
          </a>
          <a
            href="https://github.com/splitlens/splitlens"
            className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-6 py-3 font-semibold transition-colors hover:border-[color:var(--color-accent)]"
          >
            Star on GitHub →
          </a>
        </div>

        <p className="text-sm text-[color:var(--color-muted)]">
          Built for India 🇮🇳 · No signup · Single device for v1 · Currently in pre-MVP
        </p>
      </section>

      <hr className="my-20 border-[color:var(--color-border)]" />

      {/* Why local-first */}
      <section className="space-y-12">
        <h2 className="text-3xl font-bold">Why local-first?</h2>
        <div className="grid gap-8 md:grid-cols-3">
          <Card
            icon="🛡️"
            title="Zero compliance risk"
            body="No backend processing your statements means there's nothing for us to leak, lose, or hand over."
          />
          <Card
            icon="🔍"
            title="Open source — verify it"
            body="Every line of code that touches your data is on GitHub under AGPL-3.0. Read the source. Audit the network tab."
          />
          <Card
            icon="🇮🇳"
            title="Built for Indian banks"
            body="HDFC savings + credit card supported at launch. ICICI / Axis / SBI coming based on your votes."
          />
        </div>
      </section>

      <hr className="my-20 border-[color:var(--color-border)]" />

      {/* What you can do */}
      <section className="space-y-12">
        <h2 className="text-3xl font-bold">What you can do</h2>
        <ul className="grid gap-6 md:grid-cols-2">
          <Feature
            title="📊 See where your money goes"
            body="Interactive sunburst — click any category to drill in. Monthly reports with anomaly flags."
          />
          <Feature
            title="🤝 Split shared expenses"
            body="Mark a transaction as shared with flatmates. Auto-computed settlements. Net balance per person."
          />
          <Feature
            title="🚬 Track personal habits"
            body="Define your own categories — cigarettes, takeout, subscriptions. Watch the trend over time."
          />
          <Feature
            title="💡 Smart suggestions"
            body="The more you tag, the smarter it gets. One-click bulk re-tag for similar transactions."
          />
        </ul>
      </section>

      <hr className="my-20 border-[color:var(--color-border)]" />

      <section id="try" className="space-y-6 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-10">
        <h2 className="text-3xl font-bold">Pre-MVP — coming soon</h2>
        <p className="text-[color:var(--color-muted)]">
          We&apos;re building in the open. Public launch on ProductHunt is targeted for Week 9.
          Star the repo to follow along, and you&apos;ll be first to know when the beta opens.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/splitlens/splitlens"
            className="inline-flex items-center justify-center rounded-md bg-[color:var(--color-accent)] px-6 py-3 font-semibold text-[color:var(--color-accent-fg)] hover:opacity-90"
          >
            ⭐ Star on GitHub
          </a>
          <a
            href="/privacy"
            className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] px-6 py-3 font-semibold hover:border-[color:var(--color-accent)]"
          >
            How we keep you private →
          </a>
        </div>
      </section>

      <footer className="mt-20 border-t border-[color:var(--color-border)] pt-8 text-sm text-[color:var(--color-muted)]">
        <p>
          SplitLens · AGPL-3.0 · Built by{" "}
          <a href="https://github.com/prateekaryyan" className="underline hover:text-[color:var(--color-fg)]">
            Prateek Aryan
          </a>{" "}
          · Made in Bangalore
        </p>
      </footer>
    </main>
  );
}

function Card({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-6">
      <div className="mb-3 text-3xl">{icon}</div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-[color:var(--color-muted)]">{body}</p>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm text-[color:var(--color-muted)]">{body}</p>
    </li>
  );
}
