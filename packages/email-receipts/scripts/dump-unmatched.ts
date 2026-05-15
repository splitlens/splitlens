#!/usr/bin/env tsx
/**
 * Dump full text of the first N HDFC alert emails the extractor doesn't
 * match, so we can see exactly what shape they're in.
 */
import { writeFileSync } from "node:fs";
import { fetchEmailsFrom } from "../src/fetcher";
import { hdfcAlertExtractor } from "../src/extractors";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const user = arg("--user") ?? process.env.GMAIL_USER;
  const password = arg("--password") ?? process.env.GMAIL_APP_PASSWORD;
  const n = Number(arg("--n") ?? 3);
  if (!user || !password) {
    console.error("usage: dump-unmatched --user X --password Y [--n N]");
    process.exit(2);
  }
  const emails = await fetchEmailsFrom(
    { user, password },
    {
      fromAddress: "alerts@hdfcbank.net",
      subjectContains: "UPI txn",
      sinceDays: 365,
      maxMessages: 50,
    },
  );
  console.log(`fetched ${emails.length} candidates`);

  const unmatched = emails.filter((e) => hdfcAlertExtractor.extract(e) === null).slice(0, n);
  console.log(`${unmatched.length} unmatched, dumping first ${n}`);

  let txt = "";
  for (let i = 0; i < unmatched.length; i++) {
    const e = unmatched[i]!;
    txt += `=== unmatched [${i + 1}/${n}] ${e.date} — ${e.subject} ===\n`;
    txt += `(from ${e.fromAddress}, size ${e.size} bytes, text length ${e.text.length})\n\n`;
    txt += e.text.slice(0, 2000);
    txt += "\n\n";
  }
  const out = `/tmp/splitlens-hdfc-unmatched-dump.txt`;
  writeFileSync(out, txt, "utf8");
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
