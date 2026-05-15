#!/usr/bin/env tsx
/**
 * Diagnostic: does Gmail's IMAP body-search actually find a known UTR?
 * Run with a UTR you KNOW is in an HDFC alert email in your account.
 *
 *   pnpm tsx scripts/debug-search.ts --user … --password … --utr 613414367509
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const user = arg("--user") ?? process.env.GMAIL_USER;
  const password = arg("--password") ?? process.env.GMAIL_APP_PASSWORD;
  const utr = arg("--utr");
  if (!user || !password || !utr) {
    console.error("usage: debug-search --user X --password Y --utr Z");
    process.exit(2);
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    const list = await client.list();
    const allMail =
      list.find((m) => m.specialUse === "\\All")?.path ?? "[Gmail]/All Mail";
    const lock = await client.getMailboxLock(allMail);
    try {
      console.log(`[debug] mailbox: ${allMail}`);

      // 1. Body search
      const bodyUids = (await client.search({ body: utr })) || [];
      console.log(`[debug] body:${utr} → ${bodyUids.length} UIDs`);

      // 2. Quoted body search (some IMAP servers want the literal "...")
      const quotedUids = (await client.search({ body: `"${utr}"` })) || [];
      console.log(`[debug] body:"${utr}" → ${quotedUids.length} UIDs`);

      // 3. Gmail's X-GM-RAW custom search (full Gmail query syntax)
      // imapflow supports this via `gmailRaw`
      try {
        const gmailUids =
          (await client.search({ gmailRaw: `"${utr}"` } as never)) || [];
        console.log(`[debug] X-GM-RAW "${utr}" → ${gmailUids.length} UIDs`);
        if (gmailUids.length > 0) {
          for await (const msg of client.fetch(gmailUids.slice(0, 2), { source: true, envelope: true })) {
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source);
            const fromAddr = parsed.from?.value?.[0]?.address ?? "";
            console.log(`    sample: ${parsed.subject} (from ${fromAddr})`);
            const idx = (parsed.text ?? "").indexOf(utr);
            console.log(`    UTR found in parsed.text at index: ${idx}`);
            if (idx >= 0) {
              console.log(
                `    context: ...${(parsed.text ?? "").slice(Math.max(0, idx - 30), idx + utr.length + 30)}...`,
              );
            } else {
              const inHtml = typeof parsed.html === "string" && parsed.html.includes(utr);
              console.log(`    UTR found in parsed.html? ${inHtml}`);
            }
          }
        }
      } catch (e) {
        console.log(`[debug] X-GM-RAW unsupported: ${e instanceof Error ? e.message : e}`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
