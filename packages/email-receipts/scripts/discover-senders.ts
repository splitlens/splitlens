#!/usr/bin/env tsx
/**
 * Companion to spike-fetch. Instead of filtering by sender, this searches
 * by KEYWORD in subject/body and reports the distinct senders + match
 * counts. Use it to discover what address a merchant actually sends from
 * before you commit to a sender allowlist.
 *
 * Usage:
 *   GMAIL_USER=… GMAIL_APP_PASSWORD=… pnpm tsx scripts/discover-senders.ts blinkit
 *   GMAIL_USER=… GMAIL_APP_PASSWORD=… pnpm tsx scripts/discover-senders.ts "hdfc alert"
 *
 * Output: a ranked table — { sender, count, sample_subject } — printed to
 * stdout. No email content written to disk.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  // First non-flag argument is the keyword.
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const skipFlagValues = ["--user", "--password", "--since"];
  const keyword = positional.filter(
    (a, i) => !skipFlagValues.includes(positional[i - 1] ?? ""),
  )[0];
  if (!keyword) {
    console.error(
      "usage: discover-senders <keyword> [--user <addr>] [--password <appPwd>] [--since N]",
    );
    process.exit(2);
  }
  const user = arg("--user") ?? process.env.GMAIL_USER;
  const password = arg("--password") ?? process.env.GMAIL_APP_PASSWORD;
  if (!user || !password) {
    console.error("Pass --user --password, or set GMAIL_USER and GMAIL_APP_PASSWORD.");
    process.exit(2);
  }
  const sinceDays = Number(arg("--since") ?? process.env.SINCE_DAYS ?? 365);
  const since = new Date(Date.now() - sinceDays * 86400 * 1000);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
  });

  console.log(`[discover] connecting as ${user} …`);
  await client.connect();
  try {
    const list = await client.list();
    const allMail =
      list.find((m) => m.specialUse === "\\All")?.path ?? "[Gmail]/All Mail";
    const lock = await client.getMailboxLock(allMail);
    try {
      // Search BODY for the keyword — Gmail's full-text search.
      const uids = await client.search({ body: keyword, since });
      console.log(`[discover] '${keyword}' since ${since.toISOString().slice(0, 10)}: ${(uids ?? []).length} matches`);

      if (!uids || uids.length === 0) return;

      const sliceCap = Math.min(uids.length, 200);
      const slice = uids.sort((a, b) => b - a).slice(0, sliceCap);
      const senderCounts = new Map<string, { count: number; sample: string; lastDate: string }>();

      for await (const msg of client.fetch(slice, { envelope: true, source: true, size: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const fromObj = parsed.from?.value?.[0];
        const address = (fromObj?.address ?? "").toLowerCase();
        if (!address) continue;
        const existing = senderCounts.get(address);
        const dateIso = parsed.date?.toISOString() ?? "";
        if (existing) {
          existing.count++;
          if (dateIso > existing.lastDate) existing.lastDate = dateIso;
        } else {
          senderCounts.set(address, {
            count: 1,
            sample: parsed.subject ?? "",
            lastDate: dateIso,
          });
        }
      }

      const ranked = [...senderCounts.entries()]
        .map(([addr, v]) => ({ addr, ...v }))
        .sort((a, b) => b.count - a.count);

      console.log("\nsender                                          count  last seen     subject sample");
      console.log("-".repeat(120));
      for (const r of ranked.slice(0, 30)) {
        const ds = (r.lastDate || "").slice(0, 10);
        console.log(
          `${r.addr.padEnd(48)} ${String(r.count).padStart(5)}  ${ds}   ${r.sample.slice(0, 60)}`,
        );
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

main().catch((e) => {
  console.error("[discover] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
