/**
 * Email-driven enrichment passes over the canonical ledger.
 *
 * Two passes today, sharing the same bulk-fetch-then-index strategy:
 *
 *   1. backfillTimesFromHdfcAlerts — fills `txn_time` on rows with a UTR
 *      but no wall-clock time, using HDFC InstaAlerts emails as the source.
 *
 *   2. backfillSwiggyZomatoItems — attaches item-level breakdowns (the
 *      stuff you actually ordered) to Swiggy / Zomato / Instamart spend
 *      rows, by matching emails to canonical txns on {amount, date}.
 *
 * Both functions: one bulk IMAP fetch per sender per account, parse once,
 * build an in-memory index, then sweep the candidate rows in a single SQL
 * transaction. Much cheaper than calling findEmailsForTransaction per txn
 * (which would do 3 IMAP round-trips × N transactions).
 */
import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  fetchEmailsFrom,
  hdfcAlertExtractor,
  swiggyExtractor,
  zomatoExtractor,
  type ImapAuth,
} from "@splitlens/email-receipts";
import {
  accounts,
  statements,
  transactionSources,
  transactions,
  type SplitLensDb,
} from "@splitlens/db";

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

// ============================================================================
// Swiggy + Zomato item-level enrichment
// ============================================================================

/**
 * Which canonical-row counterparties should be considered enrichment
 * candidates for which extractor. Match is substring + case-insensitive.
 *
 * In real data the strings vary (e.g. "Swiggy", "SWIGGY", "Swiggy Limited",
 * "SWIGGYINSTAMART", "Swiggy.stores@axisbank", "upiswiggy@icici"). The
 * substring "swiggy" catches them all without false positives. Same logic
 * for "zomato" (catches "RazorpayZomato", "zomato-order@paytm", etc.).
 *
 * Instamart is handled by Swiggy emails but appears in narrations as
 * "SWIGGYINSTAMART" / "Swiggy Instamart" — already caught by "swiggy".
 */
const SWIGGY_NEEDLE = "swiggy";
const ZOMATO_NEEDLE = "zomato";

/** Round to paise so floating-point doesn't kill index lookups. */
function rupeeKey(amount: number): number {
  return Math.round(amount * 100);
}

/** ms in a day, for date-diff math. */
const DAY_MS = 86400 * 1000;

export interface ItemEnrichResult {
  /** Total Swiggy/Zomato canonical txns the sweep considered. */
  candidates: number;
  /** Of those, how many already had a swiggy_email / zomato_email source row. */
  alreadyEnriched: number;
  /** How many we successfully matched + attached items to. */
  matched: number;
  /** Candidates that had no plausible email within the ±₹2 / ±2 day window. */
  unmatched: number;
  perAccount: Array<{
    user: string;
    swiggyEmailsFetched: number;
    zomatoEmailsFetched: number;
    swiggyParsed: number;
    zomatoParsed: number;
  }>;
}

export interface IndexedEmail {
  amount: number;
  /** Email Date: header as a unix ms. */
  emailMs: number;
  /** "swiggy" | "zomato" */
  merchant: "swiggy" | "zomato";
  /** Extractor id from email-receipts (e.g. "swiggy", "zomato"). */
  extractorId: string;
  /** Stable order id when the extractor produced one; otherwise messageId. */
  sourceTxnId: string;
  /** The full extracted fields, as returned by the extractor. */
  fields: Record<string, unknown>;
  /** Short label for diagnostics. */
  summary: string;
}

/** Shape of a candidate canonical txn that pickEmailMatches needs. */
export interface CandidateTxn {
  id: number;
  /** ISO YYYY-MM-DD. */
  txnDate: string;
  withdrawal: number;
  counterparty: string | null;
}

/** Result of the pure-matching step, before any DB write. */
export interface EmailMatchPick {
  candidate: CandidateTxn;
  email: IndexedEmail;
}

/**
 * Pure function: given a set of candidate canonical txns and a pre-built
 * email index, return the best email match for each candidate (when one
 * exists within ±2 days / ±₹2). Each email is consumed at most once —
 * if two candidates compete for the same email, the earlier candidate
 * by date wins.
 *
 * Extracted from `backfillSwiggyZomatoItems` so it can be unit-tested
 * without a live IMAP connection or live database.
 */
export function pickEmailMatches(
  candidates: CandidateTxn[],
  indexByAmount: Map<number, IndexedEmail[]>,
): { picks: EmailMatchPick[]; unmatched: CandidateTxn[] } {
  const consumedSourceTxnIds = new Set<string>();
  const picks: EmailMatchPick[] = [];
  const unmatched: CandidateTxn[] = [];

  // Sort by date so when two candidates compete for the same email the
  // earlier one wins. Predictable + idempotent.
  const sorted = [...candidates].sort((a, b) => a.txnDate.localeCompare(b.txnDate));

  for (const c of sorted) {
    const counterparty = (c.counterparty ?? "").toLowerCase();
    const isSwiggy = counterparty.includes(SWIGGY_NEEDLE);
    const isZomato = counterparty.includes(ZOMATO_NEEDLE);
    if (!isSwiggy && !isZomato) {
      unmatched.push(c);
      continue;
    }
    const txnMs = new Date(c.txnDate + "T00:00:00Z").getTime();
    const targetKey = rupeeKey(c.withdrawal);
    const inWindow: IndexedEmail[] = [];
    for (let delta = -200; delta <= 200; delta++) {
      const list = indexByAmount.get(targetKey + delta);
      if (!list) continue;
      for (const e of list) {
        if (e.merchant === "swiggy" && !isSwiggy) continue;
        if (e.merchant === "zomato" && !isZomato) continue;
        if (consumedSourceTxnIds.has(e.sourceTxnId)) continue;
        const dayDiff = Math.abs(e.emailMs - txnMs) / DAY_MS;
        if (dayDiff > 2) continue;
        inWindow.push(e);
      }
    }
    if (inWindow.length === 0) {
      unmatched.push(c);
      continue;
    }
    inWindow.sort((a, b) => {
      const sa = Math.abs(a.amount - c.withdrawal) + Math.abs(a.emailMs - txnMs) / DAY_MS;
      const sb = Math.abs(b.amount - c.withdrawal) + Math.abs(b.emailMs - txnMs) / DAY_MS;
      return sa - sb;
    });
    const best = inWindow[0]!;
    consumedSourceTxnIds.add(best.sourceTxnId);
    picks.push({ candidate: c, email: best });
  }

  return { picks, unmatched };
}

/**
 * Attach Swiggy / Zomato item-level breakdowns to canonical transactions.
 *
 * Matching policy: a canonical row is a candidate iff
 *   - withdrawal is non-null and > 0
 *   - counterparty contains "swiggy" or "zomato" (case-insensitive)
 *   - no transaction_sources row already exists with source_type=
 *     `swiggy_email` or `zomato_email` (idempotency)
 *
 * For each candidate we scan the email index for entries within ±2 days of
 * `txn_date` and ±₹2 of `withdrawal`, then pick the closest on a combined
 * (|amountDiff|/2 + |dayDiff|) score. Ties prefer the email closest in
 * time. The chosen email's `extracted.fields` is JSON-blob'd into
 * `transaction_sources.raw_json` so the UI has everything (items,
 * restaurant, order id, …) without re-fetching the email.
 */
export async function backfillSwiggyZomatoItems(
  db: SplitLensDb,
  emailAccounts: ImapAuth[],
  opts: { lookbackDays?: number; verbose?: boolean } = {},
): Promise<ItemEnrichResult> {
  const lookbackDays = opts.lookbackDays ?? 365 * 2;
  const log = opts.verbose
    ? (m: string) => console.log(`[email-backfill:items] ${m}`)
    : () => {};
  // Keep the type chain referencing schema helpers we may not use directly.
  void and;
  void isNotNull;
  void isNull;

  // Find candidate canonical rows. Pull narration + counterparty so we can
  // log why each row was picked.
  const candidates = db.all<{
    id: number;
    account_id: number;
    txn_date: string;
    withdrawal: number;
    counterparty: string | null;
    narration: string | null;
  }>(sql`
    SELECT id, account_id, txn_date, withdrawal, counterparty, narration
    FROM transactions
    WHERE withdrawal IS NOT NULL
      AND withdrawal > 0
      AND counterparty IS NOT NULL
      AND (
        lower(counterparty) LIKE '%' || ${SWIGGY_NEEDLE} || '%'
        OR lower(counterparty) LIKE '%' || ${ZOMATO_NEEDLE} || '%'
      )
  `);

  if (candidates.length === 0) {
    log("no Swiggy/Zomato candidates in ledger");
    return { candidates: 0, alreadyEnriched: 0, matched: 0, unmatched: 0, perAccount: [] };
  }
  log(`${candidates.length} Swiggy/Zomato candidates in the ledger`);

  // Filter out rows that already have a swiggy_email or zomato_email source.
  // Idempotency: re-running the command should be a no-op on already-enriched
  // rows.
  const enrichedIds = new Set<number>(
    db
      .all<{ transaction_id: number }>(sql`
        SELECT DISTINCT transaction_id
        FROM transaction_sources
        WHERE source_type IN ('swiggy_email', 'zomato_email')
      `)
      .map((r) => r.transaction_id),
  );
  const work = candidates.filter((c) => !enrichedIds.has(c.id));
  log(
    `${enrichedIds.size} already enriched; ${work.length} candidates remaining`,
  );
  if (work.length === 0) {
    return {
      candidates: candidates.length,
      alreadyEnriched: enrichedIds.size,
      matched: 0,
      unmatched: 0,
      perAccount: [],
    };
  }
  if (emailAccounts.length === 0) {
    log("no email accounts configured — set GMAIL_USER_1 / GMAIL_APP_PWD_1");
    return {
      candidates: candidates.length,
      alreadyEnriched: enrichedIds.size,
      matched: 0,
      unmatched: work.length,
      perAccount: [],
    };
  }

  // Pull all Swiggy + Zomato emails across every configured account. The
  // primary key into our index is the rupee amount, so different accounts
  // happily share one merged index — Gmail deduplication by messageId keeps
  // us from indexing the same email twice when a user has both their
  // personal + work inbox configured.
  const seenMessageIds = new Set<string>();
  const indexByAmount = new Map<number, IndexedEmail[]>();
  const perAccount: ItemEnrichResult["perAccount"] = [];

  const SWIGGY_SENDERS = ["noreply@swiggy.in", "no-reply@swiggy.in"];
  const ZOMATO_SENDERS = ["noreply@zomato.com"];

  for (const account of emailAccounts) {
    let swiggyEmailsFetched = 0;
    let zomatoEmailsFetched = 0;
    let swiggyParsed = 0;
    let zomatoParsed = 0;

    for (const sender of SWIGGY_SENDERS) {
      log(`fetching ${sender} on ${account.user}…`);
      const emails = await fetchEmailsFrom(account, {
        fromAddress: sender,
        sinceDays: lookbackDays,
        maxMessages: 10_000,
        subjectContains: "delivered",
      });
      swiggyEmailsFetched += emails.length;
      log(`  ${emails.length} swiggy emails`);
      for (const e of emails) {
        if (seenMessageIds.has(e.messageId)) continue;
        seenMessageIds.add(e.messageId);
        const got = swiggyExtractor.extract(e);
        if (!got) continue;
        const amount = Number(got.fields.amount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const emailMs = e.date ? new Date(e.date).getTime() : NaN;
        if (!Number.isFinite(emailMs)) continue;
        const orderId = (got.fields.orderId as string | null) ?? null;
        const sourceTxnId = orderId ?? `swiggy:${e.messageId}`;
        addToIndex(indexByAmount, {
          amount,
          emailMs,
          merchant: "swiggy",
          extractorId: swiggyExtractor.id,
          sourceTxnId,
          fields: got.fields,
          summary: got.summary,
        });
        swiggyParsed++;
      }
    }

    for (const sender of ZOMATO_SENDERS) {
      log(`fetching ${sender} on ${account.user}…`);
      const emails = await fetchEmailsFrom(account, {
        fromAddress: sender,
        sinceDays: lookbackDays,
        maxMessages: 10_000,
      });
      zomatoEmailsFetched += emails.length;
      log(`  ${emails.length} zomato emails`);
      for (const e of emails) {
        if (seenMessageIds.has(e.messageId)) continue;
        seenMessageIds.add(e.messageId);
        const got = zomatoExtractor.extract(e);
        if (!got) continue;
        const amount = Number(got.fields.amount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const emailMs = e.date ? new Date(e.date).getTime() : NaN;
        if (!Number.isFinite(emailMs)) continue;
        const orderId =
          (got.fields.orderId as string | null) ??
          (got.fields.zomatoTxnId as string | null) ??
          null;
        const sourceTxnId = orderId ?? `zomato:${e.messageId}`;
        addToIndex(indexByAmount, {
          amount,
          emailMs,
          merchant: "zomato",
          extractorId: zomatoExtractor.id,
          sourceTxnId,
          fields: got.fields,
          summary: got.summary,
        });
        zomatoParsed++;
      }
    }

    perAccount.push({
      user: account.user,
      swiggyEmailsFetched,
      zomatoEmailsFetched,
      swiggyParsed,
      zomatoParsed,
    });
  }

  log(
    `built email index: ${[...indexByAmount.values()].reduce((s, v) => s + v.length, 0)} entries across ${indexByAmount.size} amount buckets`,
  );

  const candidateInputs: CandidateTxn[] = work.map((c) => ({
    id: c.id,
    txnDate: c.txn_date,
    withdrawal: c.withdrawal,
    counterparty: c.counterparty,
  }));
  const { picks, unmatched } = pickEmailMatches(candidateInputs, indexByAmount);
  // Re-attach the original row's account_id for the writer step.
  const accountById = new Map<number, number>(work.map((c) => [c.id, c.account_id]));
  log(`matched ${picks.length} of ${work.length} candidates`);

  // Now write transaction_sources rows. Each pick gets one row; the synthetic
  // statement is shared per (emailUser, merchant, accountId) tuple so we have
  // a stable statement_id to reference. `source_row_idx` is the candidate's
  // canonical transaction id — guaranteed unique within a statement.
  let matchedCount = 0;
  // We don't have a single "owning" email account per pick (the index merges
  // across accounts), so attribute all of them to the first configured user.
  // Same email gets indexed once per messageId so this is consistent.
  const primaryUser = emailAccounts[0]!.user;

  db.transaction((tx) => {
    // Cache statement ids by (merchant, accountId). Created lazily.
    const statementCache = new Map<string, number>();
    const getStatementId = (merchant: "swiggy" | "zomato", accountId: number): number => {
      const cacheKey = `${merchant}:${accountId}`;
      const cached = statementCache.get(cacheKey);
      if (cached) return cached;
      const sourceFile = `imap://${primaryUser}/${merchant}`;
      const sourceHash = createHash("sha256")
        .update(`${primaryUser}|${merchant}|${accountId}|email-receipts`)
        .digest("hex");
      // Idempotent — upsert via SELECT-then-INSERT inside the transaction.
      const existing = tx
        .select({ id: statements.id })
        .from(statements)
        .where(eq(statements.sourceHash, sourceHash))
        .get();
      if (existing) {
        statementCache.set(cacheKey, existing.id);
        return existing.id;
      }
      const inserted = tx
        .insert(statements)
        .values({
          accountId,
          sourceFile,
          sourceHash,
          sourceType: merchant === "swiggy" ? "swiggy_email" : "zomato_email",
          periodFrom: null,
          periodTo: null,
          pageCount: null,
          txnCount: null,
        })
        .returning({ id: statements.id })
        .get();
      statementCache.set(cacheKey, inserted.id);
      return inserted.id;
    };
    // Defensive: make sure every accountId we reference actually exists.
    // If it doesn't (e.g. test fixture), skip — we'd FK-violate otherwise.
    const accountIds = new Set<number>(
      tx.select({ id: accounts.id }).from(accounts).all().map((r) => r.id),
    );

    for (const pick of picks) {
      const accountId = accountById.get(pick.candidate.id);
      if (accountId == null || !accountIds.has(accountId)) continue;
      const sType =
        pick.email.merchant === "swiggy" ? "swiggy_email" : "zomato_email";
      const statementId = getStatementId(pick.email.merchant, accountId);
      // Belt + suspenders: ensure no duplicate insert for the same canonical
      // row + statement.
      try {
        tx.insert(transactionSources)
          .values({
            transactionId: pick.candidate.id,
            sourceType: sType,
            statementId,
            sourceRowIdx: pick.candidate.id,
            sourceTxnId: pick.email.sourceTxnId,
            rawJson: JSON.stringify({
              ...pick.email.fields,
              extractorId: pick.email.extractorId,
              emailDate: new Date(pick.email.emailMs).toISOString(),
              summary: pick.email.summary,
            }),
          })
          .run();
        matchedCount++;
      } catch (err) {
        // Most likely cause: re-run race where the unique index fired
        // between the candidate filter and the insert. Skip + keep going.
        log(`  insert skipped for txn=${pick.candidate.id}: ${(err as Error).message}`);
      }
    }
  });

  log(
    `wrote ${matchedCount} transaction_sources rows; ${unmatched.length} unmatched`,
  );

  return {
    candidates: candidates.length,
    alreadyEnriched: enrichedIds.size,
    matched: matchedCount,
    unmatched: unmatched.length,
    perAccount,
  };
}

function addToIndex(
  index: Map<number, IndexedEmail[]>,
  entry: IndexedEmail,
): void {
  const key = rupeeKey(entry.amount);
  const list = index.get(key);
  if (list) {
    list.push(entry);
  } else {
    index.set(key, [entry]);
  }
}
