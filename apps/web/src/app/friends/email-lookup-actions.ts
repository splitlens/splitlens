"use server";

import "server-only";
import { sql } from "drizzle-orm";
import { openDb } from "@splitlens/db";
import {
  findEmailsForTransaction,
  loadEmailAccountsFromEnv,
  type EmailMatch,
} from "@splitlens/email-receipts";

/**
 * On-demand "find emails about this charge" lookup. Reads the canonical txn
 * row from SQLite to build a TxnSearchInput, then runs
 * `findEmailsForTransaction` against every configured Gmail account in
 * parallel, unions the matches, sorts by score, and caps at 8.
 *
 * Privacy: the IMAP creds live exclusively in the Next.js server process via
 * env vars (GMAIL_USER_N / GMAIL_APP_PWD_N). No cloud calls, nothing
 * persisted — the matches are streamed back to the requesting client and
 * thrown away. The email body is truncated to 400 chars in transit since the
 * modal only renders an excerpt.
 *
 * Returns an empty array when no email accounts are configured — the caller
 * shows a "configure GMAIL_USER_1 to enable" hint.
 */

/** Subset of EmailMatch trimmed for transit — `email.text` capped at 400 chars. */
export type EmailMatchLite = Omit<EmailMatch, "email"> & {
  email: Omit<EmailMatch["email"], "text" | "html"> & {
    /** First 400 chars of the plain-text body. */
    textExcerpt: string;
    /** True when the original body was longer than the excerpt. */
    textTruncated: boolean;
  };
};

const MAX_MATCHES = 8;
const EXCERPT_LEN = 400;

export async function lookupEmailsForTxn(
  txnId: number,
): Promise<{ ok: true; matches: EmailMatchLite[]; accountCount: number } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) {
    return { ok: false, error: "invalid txnId" };
  }

  // Pull the minimal txn fields we need to drive the email search.
  const db = openDb();
  const rows = db.all<{
    txn_date: string;
    withdrawal: number | null;
    deposit: number | null;
    counterparty: string | null;
    narration: string | null;
    ref_no: string | null;
  }>(sql`
    SELECT txn_date, withdrawal, deposit, counterparty, narration, ref_no
    FROM transactions
    WHERE id = ${txnId}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return { ok: false, error: "transaction not found" };

  // The lookup needs a positive amount — use whichever of withdrawal/deposit
  // is non-null. If both are null (shouldn't happen, but defensively), bail.
  const amount = row.withdrawal ?? row.deposit;
  if (amount == null || amount <= 0) {
    return { ok: false, error: "transaction has no amount" };
  }

  const accounts = loadEmailAccountsFromEnv();
  if (accounts.length === 0) {
    // Not an error — the caller renders a friendly hint.
    return { ok: true, matches: [], accountCount: 0 };
  }

  const txnSearch = {
    txnDate: row.txn_date,
    amount,
    counterparty: row.counterparty,
    narration: row.narration,
    refNo: row.ref_no,
  };

  // Query every configured account in parallel. One bad account shouldn't
  // tank the others — wrap each in a try/catch.
  const perAccount = await Promise.all(
    accounts.map(async (auth) => {
      try {
        return await findEmailsForTransaction(auth, txnSearch, { maxMatches: MAX_MATCHES });
      } catch (err) {
        // Log server-side; return empty so the caller still sees other accounts.
        console.error(`[email-lookup] account ${auth.user} failed:`, err);
        return [] as EmailMatch[];
      }
    }),
  );

  // Union, dedupe by messageId, sort by score desc, cap at MAX_MATCHES.
  const seen = new Set<string>();
  const unioned: EmailMatch[] = [];
  for (const list of perAccount) {
    for (const m of list) {
      if (seen.has(m.email.messageId)) continue;
      seen.add(m.email.messageId);
      unioned.push(m);
    }
  }
  unioned.sort((a, b) => b.score - a.score);
  const capped = unioned.slice(0, MAX_MATCHES);

  // Trim the body before returning — keeps the RSC payload small.
  const matches: EmailMatchLite[] = capped.map((m) => {
    const text = m.email.text ?? "";
    const textTruncated = text.length > EXCERPT_LEN;
    return {
      score: m.score,
      reasons: m.reasons,
      extracted: m.extracted,
      extractorId: m.extractorId,
      email: {
        messageId: m.email.messageId,
        date: m.email.date,
        fromRaw: m.email.fromRaw,
        fromAddress: m.email.fromAddress,
        subject: m.email.subject,
        size: m.email.size,
        textExcerpt: textTruncated ? text.slice(0, EXCERPT_LEN) : text,
        textTruncated,
      },
    };
  });

  return { ok: true, matches, accountCount: accounts.length };
}
