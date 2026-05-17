#!/usr/bin/env tsx
/**
 * Diagnostic: bulk-fetch all HDFC alert emails on an account, group them by
 * subject, and report which subjects the hdfcAlertExtractor recognizes vs
 * doesn't. Helps us see if there are alert sub-types we haven't covered.
 */
import { fetchEmailsFrom } from "../src/fetcher";
import { hdfcAlertExtractor } from "../src/extractors";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const user = arg("--user") ?? process.env.GMAIL_USER;
  const password = arg("--password") ?? process.env.GMAIL_APP_PASSWORD;
  if (!user || !password) {
    console.error("usage: inspect-alerts --user X --password Y");
    process.exit(2);
  }
  const senders = ["alerts@hdfcbank.bank.in", "alerts@hdfcbank.net"];
  type Bucket = { count: number; matched: number; sample: string };
  const bySubject = new Map<string, Bucket>();
  for (const s of senders) {
    console.log(`fetching ${s}…`);
    const emails = await fetchEmailsFrom(
      { user, password },
      { fromAddress: s, sinceDays: 365 * 2, maxMessages: 5_000 },
    );
    console.log(`  ${emails.length} emails`);
    for (const e of emails) {
      const subj = e.subject.slice(0, 60);
      const matched = hdfcAlertExtractor.extract(e) !== null ? 1 : 0;
      const b = bySubject.get(subj) ?? { count: 0, matched: 0, sample: "" };
      b.count++;
      b.matched += matched;
      if (!matched && b.sample.length === 0) {
        b.sample = e.text.slice(0, 200).replace(/\s+/g, " ");
      }
      bySubject.set(subj, b);
    }
  }
  console.log("\nsubject                                                       n     matched  unmatched_sample");
  console.log("-".repeat(150));
  const ranked = [...bySubject.entries()]
    .map(([s, b]) => ({ s, ...b }))
    .sort((a, b) => b.count - a.count);
  for (const r of ranked.slice(0, 30)) {
    const mismatch = r.count - r.matched;
    console.log(
      `${r.s.padEnd(60)} ${String(r.count).padStart(5)}   ${String(r.matched).padStart(5)}    ` +
        (mismatch > 0 ? r.sample.slice(0, 80) : "—"),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
