/**
 * Email-driven enrichment passes over the canonical ledger.
 *
 * Today: backfill `txn_time` on rows where it's null but a UTR is present,
 * using HDFC InstaAlerts emails as the time source. The pattern generalises
 * to future enrichments (Swiggy/Zomato item lists, etc.) — same shape, just
 * a different extractor.
 *
 * Strategy: one bulk IMAP fetch of all HDFC alerts in the relevant date
 * range per account, parse them once, build a UTR → IST-time index in
 * memory, then update each canonical row in a single sweep. Much cheaper
 * than calling findEmailsForTransaction per txn (which would do 3 IMAP
 * round-trips × N transactions).
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { fetchEmailsFrom, hdfcAlertExtractor, type ImapAuth } from "@splitlens/email-receipts";
import { transactions, type SplitLensDb } from "@splitlens/db";

export interface TimeBackfillResult {
  /** Total transactions that were candidates (txn_time null, ref_no set). */
  candidates: number;
  /** Of those, how many got their time filled by this pass. */
  filled: number;
  /** Per-account stats so we can see which mailbox carried the load. */
  perAccount: Array<{ user: string; alertsFetched: number; matched: number }>;
}

export async function backfillTimesFromHdfcAlerts(
  db: SplitLensDb,
  accounts: ImapAuth[],
  opts: { lookbackDays?: number; verbose?: boolean } = {},
): Promise<TimeBackfillResult> {
  const lookbackDays = opts.lookbackDays ?? 365 * 2; // 2 years by default
  const log = opts.verbose
    ? (m: string) => console.log(`[email-backfill] ${m}`)
    : () => {};

  // Identify candidates up-front so we know if there's even work to do —
  // and so we don't fetch emails for nothing.
  const candidates = db.all<{
    id: number;
    ref_no: string;
    txn_date: string;
  }>(sql`
    SELECT id, ref_no, txn_date
    FROM transactions
    WHERE txn_time IS NULL AND ref_no IS NOT NULL
  `);
  // Suppress TS unused-warnings on imported helpers we keep for the type chain.
  void and;
  void eq;
  void isNotNull;
  void isNull;

  if (candidates.length === 0) {
    log("no candidates; everything already has a time");
    return { candidates: 0, filled: 0, perAccount: [] };
  }

  log(`${candidates.length} candidates (txn_time null + ref_no set)`);
  if (accounts.length === 0) {
    log("no email accounts configured — set GMAIL_USER_1 / GMAIL_APP_PWD_1");
    return { candidates: candidates.length, filled: 0, perAccount: [] };
  }

  // UTR → ISO-time map. The first email to claim a UTR wins; HDFC sends
  // exactly one alert per debit, so duplicates here are basically impossible
  // but if it happens (multi-account forwarding?), the first is fine.
  const utrToIstTime = new Map<string, string>();
  const perAccount: TimeBackfillResult["perAccount"] = [];

  // Both HDFC alert senders — same shape across accounts and time periods.
  const senders = ["alerts@hdfcbank.bank.in", "alerts@hdfcbank.net"];

  for (const account of accounts) {
    let fetchedThisAccount = 0;
    let matchedThisAccount = 0;
    for (const sender of senders) {
      log(`fetching ${sender} on ${account.user}…`);
      const emails = await fetchEmailsFrom(account, {
        fromAddress: sender,
        sinceDays: lookbackDays,
        maxMessages: 10_000,
      });
      fetchedThisAccount += emails.length;
      log(`  ${emails.length} emails`);

      for (const e of emails) {
        const extracted = hdfcAlertExtractor.extract(e);
        if (!extracted) continue;
        const utr = String(extracted.fields.utr);
        const istTime = String(extracted.fields.istTime);
        if (!utr || !istTime) continue;
        if (!utrToIstTime.has(utr)) {
          utrToIstTime.set(utr, istTime);
          matchedThisAccount++;
        }
      }
    }
    perAccount.push({
      user: account.user,
      alertsFetched: fetchedThisAccount,
      matched: matchedThisAccount,
    });
  }

  log(`built UTR→time index of ${utrToIstTime.size} entries`);

  // Apply. Wrap in a single transaction so partial failures don't leave
  // half the table updated.
  let filled = 0;
  db.transaction((tx) => {
    for (const c of candidates) {
      const istTime = utrToIstTime.get(c.ref_no);
      if (!istTime) continue;
      tx.update(transactions)
        .set({ txnTime: istTime, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(transactions.id, c.id))
        .run();
      filled++;
    }
  });

  log(`updated ${filled} of ${candidates.length} candidate rows`);
  return { candidates: candidates.length, filled, perAccount };
}
