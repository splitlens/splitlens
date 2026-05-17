/**
 * findEmailsForTransaction — the reusable lookup primitive.
 *
 * Given a canonical transaction shape (date, amount, optionally refNo /
 * counterparty / narration), search the user's mailbox for emails that look
 * like they relate to that transaction, score each match, and return them
 * with structured fields (when a known-merchant extractor matches the
 * sender).
 *
 * The function does the IMAP work end-to-end: opens a connection, runs
 * 1–3 search queries depending on what signals the txn carries, unions and
 * dedupes the UIDs, fetches each candidate, parses with mailparser, scores,
 * and closes the connection.
 *
 * Designed to be called from:
 *   - the daemon (batch backfill of historical txns)
 *   - the Friends / Reports UI ("what emails relate to this charge?")
 *   - one-off CLI scripts (the spike that lives next to this file)
 *
 * Privacy: no cloud calls. Credentials are in-memory for the duration of the
 * call. The function never persists anything; the caller decides what to
 * store.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { FetchedEmail, ImapAuth } from "./types";
import { DEFAULT_EXTRACTORS, type ExtractedInfo, type MerchantExtractor } from "./extractors";

export interface TxnSearchInput {
  /** ISO 'YYYY-MM-DD'. The center of the search window. */
  txnDate: string;
  /** Positive INR. Used to score body-amount matches. */
  amount: number;
  /** Best counterparty string we have — PhonePe's clean name or HDFC's raw narration. */
  counterparty?: string | null;
  /** UTR / bank ref — strongest match signal when available. */
  refNo?: string | null;
  /** Raw HDFC narration, if any. Used as another counterparty-shaped probe. */
  narration?: string | null;
}

export interface EmailMatch {
  email: FetchedEmail;
  /** 0..1 confidence. >= 0.8 = essentially certain. */
  score: number;
  /** Human-readable explanations of each scoring signal. */
  reasons: string[];
  /** Merchant-specific structured fields, when an extractor recognized the sender. */
  extracted: ExtractedInfo | null;
  /** The matching extractor's id, if any. */
  extractorId: string | null;
}

export interface FindEmailsOptions {
  /** Date window (days, symmetric around txnDate). Default: 7. */
  windowDays?: number;
  /** Hard cap on matches returned. Default: 10. */
  maxMatches?: number;
  /** Drop matches scoring below this. Default 0.2. */
  minScore?: number;
  /** Custom extractor registry. Defaults to DEFAULT_EXTRACTORS. */
  extractors?: MerchantExtractor[];
  /**
   * Pass an existing imapflow client to skip the connect/disconnect dance.
   * Useful when batching many txns in one daemon pass.
   */
  client?: ImapFlow;
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MAX = 10;
const DEFAULT_MIN_SCORE = 0.2;

export async function findEmailsForTransaction(
  auth: ImapAuth,
  txn: TxnSearchInput,
  opts: FindEmailsOptions = {},
): Promise<EmailMatch[]> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const max = opts.maxMatches ?? DEFAULT_MAX;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const extractors = opts.extractors ?? DEFAULT_EXTRACTORS;

  const center = new Date(txn.txnDate + "T00:00:00Z");
  const since = new Date(center.getTime() - windowDays * 86400 * 1000);
  const before = new Date(center.getTime() + windowDays * 86400 * 1000);

  // We support an injected client for batch use; otherwise open + close here.
  const ownClient = !opts.client;
  const client =
    opts.client ??
    new ImapFlow({
      host: auth.host ?? "imap.gmail.com",
      port: auth.port ?? 993,
      secure: auth.secure ?? true,
      auth: { user: auth.user, pass: auth.password },
      logger: false,
    });

  if (ownClient) await client.connect();

  try {
    const allMail = await pickAllMailMailbox(client);
    const lock = await client.getMailboxLock(allMail);
    try {
      // Run 1–3 independent searches; merge UIDs.
      const candidateUids = new Set<number>();

      if (txn.refNo) {
        const uids = await client.search({ body: txn.refNo, since, before });
        if (uids) uids.forEach((u) => candidateUids.add(u));
      }

      // Counterparty search — strip junk from the search term so HDFC's
      // dash-mangled narrations don't blow up IMAP server-side parsing.
      const counterpartyTerm = cleanForSearch(
        txn.counterparty ?? txn.narration ?? "",
      );
      if (counterpartyTerm.length >= 4) {
        const uids = await client.search({ body: counterpartyTerm, since, before });
        if (uids) uids.forEach((u) => candidateUids.add(u));
      }

      // Known-merchant senders — only worth a separate query when the txn's
      // counterparty hints at that merchant. Keeps us from fetching every
      // single Swiggy email on every txn lookup.
      const merchantSenders = pickRelevantMerchantSenders(txn, extractors);
      for (const sender of merchantSenders) {
        const uids = await client.search({ from: sender, since, before });
        if (uids) uids.forEach((u) => candidateUids.add(u));
      }

      if (candidateUids.size === 0) return [];

      // Fetch + parse + score.
      const matches: EmailMatch[] = [];
      const slice = [...candidateUids].sort((a, b) => b - a).slice(0, 200);
      for await (const msg of client.fetch(slice, { source: true, envelope: true, size: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const fromObj = parsed.from?.value?.[0];
        const fromAddress = (fromObj?.address ?? "").toLowerCase();
        // mailparser's HTML-to-text sometimes drops content from styled
        // tables (HDFC alerts: the UTR sits in a cell that gets lost in
        // the auto-generated text). When we detect a thin text + a rich
        // html, run our own regex strip so extractors + scoring see the
        // full body. We concat them so both are searchable downstream.
        const htmlStr = typeof parsed.html === "string" ? parsed.html : null;
        const baseText = parsed.text ?? "";
        const htmlFallback = htmlStr ? htmlToPlain(htmlStr) : "";
        const text =
          baseText.length >= htmlFallback.length / 2
            ? `${baseText}\n${htmlFallback}`
            : htmlFallback;
        const email: FetchedEmail = {
          messageId: parsed.messageId ?? `uid:${msg.uid}`,
          date: parsed.date?.toISOString() ?? msg.envelope?.date?.toISOString() ?? "",
          fromRaw: parsed.from?.text ?? "",
          fromAddress,
          subject: parsed.subject ?? "",
          text,
          html: htmlStr,
          size: msg.size ?? 0,
        };

        const { score, reasons } = scoreMatch(email, txn);
        if (score < minScore) continue;

        // Try every extractor; first one whose sender list contains this
        // email's `from` and whose `extract()` returns non-null wins.
        let extracted: ExtractedInfo | null = null;
        let extractorId: string | null = null;
        for (const ext of extractors) {
          if (!ext.senders.includes(fromAddress)) continue;
          if (
            ext.subjectIncludes &&
            !email.subject.toLowerCase().includes(ext.subjectIncludes.toLowerCase())
          ) {
            continue;
          }
          const got = ext.extract(email);
          if (got) {
            extracted = got;
            extractorId = ext.id;
            break;
          }
        }

        matches.push({ email, score, reasons, extracted, extractorId });
      }

      matches.sort((a, b) => b.score - a.score);
      return matches.slice(0, max);
    } finally {
      lock.release();
    }
  } finally {
    if (ownClient) await client.logout();
  }
}

/**
 * Pick the right mailbox to search. Gmail's "[Gmail]/All Mail" includes
 * archived messages. Other providers may not have it — fall back to INBOX.
 */
async function pickAllMailMailbox(client: ImapFlow): Promise<string> {
  try {
    const list = await client.list();
    return (
      list.find((m) => m.specialUse === "\\All" || m.path === "[Gmail]/All Mail")?.path ??
      "INBOX"
    );
  } catch {
    return "INBOX";
  }
}

/**
 * Heuristic: which merchant senders are worth a separate sender-only search?
 * Use the counterparty/narration text to decide.
 *   "Blinkit" in narration → no extractor today (no Blinkit emails exist),
 *      but if one did we'd return its senders.
 *   "Zomato" / "Swiggy" / "Instamart" → those extractor's senders.
 *   Otherwise → just the HDFC alert sender (it covers every UPI debit).
 */
function pickRelevantMerchantSenders(
  txn: TxnSearchInput,
  extractors: MerchantExtractor[],
): string[] {
  const probe = `${txn.counterparty ?? ""} ${txn.narration ?? ""}`.toLowerCase();
  const out: string[] = [];
  for (const ext of extractors) {
    const hint = ext.id.toLowerCase();
    // Match by extractor id keyword OR by counterparty mentioning the merchant.
    if (probe.includes(hint) || probe.includes(ext.id.split("_")[0]!)) {
      out.push(...ext.senders);
    }
  }
  // Always include the HDFC alert sender if it's in the registry — HDFC
  // alerts fire for every single UPI txn and carry the UTR.
  const hdfc = extractors.find((e) => e.id === "hdfc_alert");
  if (hdfc) out.push(...hdfc.senders);
  return [...new Set(out)];
}

/**
 * Sanitize a string for an IMAP BODY search. Drop characters that confuse
 * the server's tokenizer; keep at most a few tokens since IMAP wants a
 * single string per BODY clause.
 */
/** Minimal HTML-to-text fallback when mailparser's text extraction loses content. */
function htmlToPlain(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanForSearch(s: string): string {
  return s
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((tok) => tok.length >= 3)
    .slice(0, 4)
    .join(" ");
}

function scoreMatch(
  email: FetchedEmail,
  txn: TxnSearchInput,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const body = email.text || "";

  if (txn.refNo && body.includes(txn.refNo)) {
    score += 0.8;
    reasons.push(`UTR ${txn.refNo} present in body`);
  }

  // Amount match — look for "Rs.X.XX" or "₹X.XX" or "X.XX" tokens.
  const amtFixed = txn.amount.toFixed(2);
  const amtNoZero = String(txn.amount); // "672" vs "672.00"
  const amtPatterns = [
    `Rs.${amtFixed}`,
    `Rs ${amtFixed}`,
    `₹${amtFixed}`,
    `₹ ${amtFixed}`,
    `₹${amtNoZero}`,
  ];
  for (const p of amtPatterns) {
    if (body.includes(p)) {
      score += 0.3;
      reasons.push(`amount ${p} present in body`);
      break;
    }
  }

  // Known merchant sender (the extractor list is the source of truth, but
  // we don't have access to it here — pass it through email.fromAddress
  // matching the extractor in the caller. For scoring purposes we just give
  // a small bump for any noreply@<merchant>.<tld>).
  if (/(noreply|no-reply|alerts|orders)@/.test(email.fromAddress)) {
    score += 0.2;
    reasons.push(`merchant-shaped sender ${email.fromAddress}`);
  }

  // Date proximity — within 1 day either side.
  if (email.date && txn.txnDate) {
    const emailMs = new Date(email.date).getTime();
    const txnMs = new Date(txn.txnDate + "T00:00:00Z").getTime();
    const dayDiff = Math.abs(emailMs - txnMs) / 86400 / 1000;
    if (dayDiff <= 1) {
      score += 0.2;
      reasons.push(`within 1 day of txn date`);
    } else if (dayDiff <= 3) {
      score += 0.1;
      reasons.push(`within 3 days of txn date`);
    }
  }

  return { score: Math.min(score, 1), reasons };
}
