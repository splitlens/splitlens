/**
 * Sender-filtered email fetcher over IMAP. Uses imapflow for the protocol +
 * mailparser to normalize each message into a plain `FetchedEmail`.
 *
 * Connection is short-lived per call (open → search → fetch → close). This is
 * fine for the spike + the once-every-N-minutes daemon polling cadence; if we
 * ever want push-style sync, switch to IDLE later.
 *
 * Privacy posture: this module *only* knows how to log into your account and
 * pull specific senders. It never persists credentials and never writes
 * message content to disk on its own — that's the caller's choice.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { FetchedEmail, FetchOptions, ImapAuth } from "./types";

export async function fetchEmailsFrom(
  auth: ImapAuth,
  opts: FetchOptions,
): Promise<FetchedEmail[]> {
  const sinceDays = opts.sinceDays ?? 90;
  const maxMessages = opts.maxMessages ?? 200;
  const since = new Date(Date.now() - sinceDays * 86400 * 1000);

  const client = new ImapFlow({
    host: auth.host ?? "imap.gmail.com",
    port: auth.port ?? 993,
    secure: auth.secure ?? true,
    auth: { user: auth.user, pass: auth.password },
    // We don't want imapflow's chatty info logs polluting our daemon output.
    logger: false,
  });

  const out: FetchedEmail[] = [];
  await client.connect();
  try {
    // Gmail's "[Gmail]/All Mail" is the right place to search — INBOX would
    // miss things you've already archived. Falls through to INBOX if the
    // server doesn't have a Gmail-style All Mail folder.
    const allMail = await pickAllMailMailbox(client);
    const lock = await client.getMailboxLock(allMail);
    try {
      const uids = await client.search({
        from: opts.fromAddress,
        ...(opts.subjectContains ? { subject: opts.subjectContains } : {}),
        since,
      });
      if (!uids || uids.length === 0) return [];

      // Newest first so we hit the cap with the most-relevant messages.
      const slice = uids.sort((a, b) => b - a).slice(0, maxMessages);

      for await (const msg of client.fetch(slice, { source: true, envelope: true, size: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const fromObj = parsed.from?.value?.[0];
        out.push({
          messageId: parsed.messageId ?? `uid:${msg.uid}`,
          date: parsed.date?.toISOString() ?? msg.envelope?.date?.toISOString() ?? "",
          fromRaw: parsed.from?.text ?? "",
          fromAddress: (fromObj?.address ?? "").toLowerCase(),
          subject: parsed.subject ?? "",
          text: parsed.text ?? htmlToText(parsed.html),
          html: typeof parsed.html === "string" ? parsed.html : null,
          size: msg.size ?? 0,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out;
}

/**
 * Pick the right mailbox to search. On Gmail this is "[Gmail]/All Mail" so we
 * include archived messages. Other providers may not have it — fall back to
 * INBOX.
 */
async function pickAllMailMailbox(client: ImapFlow): Promise<string> {
  try {
    const list = await client.list();
    const allMail = list.find((m) =>
      // Gmail flags this mailbox with the \All special-use flag.
      m.specialUse === "\\All" || m.path === "[Gmail]/All Mail",
    );
    return allMail?.path ?? "INBOX";
  } catch {
    return "INBOX";
  }
}

/** Minimal HTML-to-text fallback when mailparser couldn't produce a text body. */
function htmlToText(html: unknown): string {
  if (typeof html !== "string" || html.length === 0) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
