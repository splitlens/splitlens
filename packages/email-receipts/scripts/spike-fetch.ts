#!/usr/bin/env tsx
/**
 * One-off spike: connect to Gmail, pull recent emails from a single sender,
 * dump them to /tmp so we can eyeball the structure before writing a parser.
 *
 * Usage:
 *   GMAIL_USER=you@gmail.com GMAIL_APP_PASSWORD=xxxx \
 *     pnpm spike-fetch <sender> [--since N] [--max N]
 *
 * Examples:
 *   pnpm spike-fetch noreply@blinkit.com
 *   pnpm spike-fetch orders@zomato.com --since 60 --max 10
 *
 * Output: /tmp/splitlens-email-spike-<sender>.json (full structured rows)
 *         /tmp/splitlens-email-spike-<sender>.txt  (subject + first 500 chars of text)
 *
 * Nothing leaves your machine. We log only the OUTPUT FILE paths to the
 * terminal, not the email contents themselves.
 */
import { writeFileSync } from "node:fs";
import { fetchEmailsFrom } from "../src/fetcher";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  // Strip any flag-values from the positional list.
  const sender = positional.filter(
    (a, i) => positional[i - 1] !== "--since" && positional[i - 1] !== "--max",
  )[0];
  if (!sender) {
    console.error("usage: pnpm spike-fetch <sender@host> [--since N] [--max N]");
    process.exit(2);
  }
  const sinceDays = Number(arg("--since") ?? 90);
  const maxMessages = Number(arg("--max") ?? 20);
  const subjectContains = arg("--subject");

  // Account: --user / --password flags take precedence over env vars so we
  // can run against multiple accounts without rotating shell env. Falls back
  // to GMAIL_USER / GMAIL_APP_PASSWORD when the flags aren't passed.
  const user = arg("--user") ?? process.env.GMAIL_USER;
  const password = arg("--password") ?? process.env.GMAIL_APP_PASSWORD;
  if (!user || !password) {
    console.error(
      "Pass --user <addr> --password <appPwd>, or set GMAIL_USER and GMAIL_APP_PASSWORD.\n" +
        "  password must be a 16-char App Password from\n" +
        "  https://myaccount.google.com/apppasswords — your regular\n" +
        "  Google password will be rejected.",
    );
    process.exit(2);
  }

  console.log(`[email-spike] connecting as ${user} …`);
  console.log(`[email-spike] sender filter: ${sender}, since ${sinceDays} days, max ${maxMessages}`);
  const t0 = Date.now();
  const emails = await fetchEmailsFrom(
    { user, password },
    { fromAddress: sender, subjectContains, sinceDays, maxMessages },
  );
  const dt = Date.now() - t0;
  console.log(`[email-spike] fetched ${emails.length} emails in ${dt}ms`);

  // Output paths — include both sender + account so multi-account runs don't
  // overwrite each other. Sender@host has '@' which is filesystem-OK on
  // macOS but gets escaped for safety.
  const safeSender = sender.replace(/[^a-z0-9._-]/gi, "_");
  const safeAccount = user.split("@")[0]!.replace(/[^a-z0-9._-]/gi, "_");
  const jsonPath = `/tmp/splitlens-email-spike-${safeAccount}-${safeSender}.json`;
  const txtPath = `/tmp/splitlens-email-spike-${safeAccount}-${safeSender}.txt`;

  writeFileSync(jsonPath, JSON.stringify(emails, null, 2), "utf8");

  const summary = emails
    .map(
      (e, i) =>
        `--- [${i + 1}/${emails.length}] ${e.date} — ${e.subject} ---\n` +
        `from: ${e.fromRaw} (${e.fromAddress})\n` +
        `size: ${e.size} bytes · html: ${e.html ? "yes" : "no"}\n\n` +
        e.text.slice(0, 800).replace(/[ \t]+\n/g, "\n").trim() +
        "\n",
    )
    .join("\n");
  writeFileSync(txtPath, summary, "utf8");

  console.log(`[email-spike] wrote ${jsonPath}`);
  console.log(`[email-spike] wrote ${txtPath}`);
  console.log(`\nNext: open the .txt file to eyeball the structure before we design a parser.`);
}

main().catch((e) => {
  console.error("[email-spike] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
