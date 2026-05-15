/**
 * Cross-account autopay linker.
 *
 * A HDFC CC AUTOPAY is two ledger entries — a debit on the linked savings
 * account, a credit on the CC account — for the same real-world money flow.
 * We keep them as two canonical `transactions` rows (each belongs to its own
 * account) and pair them via `transactions.linked_txn_id`.
 *
 * Match rule:
 *   - savings row's narration matches `^CC \d+(\d{4}) AUTOPAY` → extract card last4
 *   - find a CC account with that last4 (any bank — pattern is HDFC-specific
 *     today but the linker doesn't care)
 *   - find a CC row on the SAME `txn_date` with `deposit = savings.withdrawal`
 *   - both currently have `linked_txn_id IS NULL`
 *
 * Set both rows' `linked_txn_id` symmetrically inside one statement so either
 * side reaches its counterpart with a single FK join.
 *
 * Idempotent — only operates on still-unlinked rows, so it's safe to call
 * after every ingest regardless of order.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { accounts, transactions, type SplitLensDb } from "@splitlens/db";

type TxLike = Parameters<Parameters<SplitLensDb["transaction"]>[0]>[0];

/**
 * Narration pattern extracts card_last4 from the savings autopay row.
 * Real HDFC shape: "CC <prefix-digits><X-mask><last4> AUTOPAY ..."
 * Example: "CC 000552260XXXXXX3969 AUTOPAY SI-TAD".
 */
const SAVINGS_AUTOPAY_RE = /^CC \d+X+(\d{4}) AUTOPAY\b/i;

export interface LinkAutopayPairsResult {
  linkedPairs: number;
}

export function linkAutopayPairs(tx: TxLike): LinkAutopayPairsResult {
  // Pull every still-unlinked savings row whose narration looks like a CC
  // autopay debit. The narration filter narrows the search; the regex below
  // confirms the shape and extracts the card last4.
  const candidates = tx
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      withdrawal: transactions.withdrawal,
      narration: transactions.narration,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.linkedTxnId),
        sql`${transactions.narration} LIKE 'CC %AUTOPAY%'`,
      ),
    )
    .all();

  let linkedPairs = 0;
  for (const c of candidates) {
    if (!c.narration || c.withdrawal == null) continue;
    const m = SAVINGS_AUTOPAY_RE.exec(c.narration);
    if (!m) continue;
    const cardLast4 = m[1]!;

    // Find a credit-card account with that last4.
    const ccAccount = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.type, "credit_card"), eq(accounts.last4, cardLast4)))
      .get();
    if (!ccAccount) continue; // CC statement not ingested yet — try again later.

    // Find a still-unlinked CC payment on the same date with matching amount.
    const ccRow = tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, ccAccount.id),
          eq(transactions.txnDate, c.txnDate),
          eq(transactions.deposit, c.withdrawal),
          isNull(transactions.linkedTxnId),
        ),
      )
      .get();
    if (!ccRow) continue;

    // Symmetric link.
    tx.update(transactions)
      .set({ linkedTxnId: ccRow.id })
      .where(eq(transactions.id, c.id))
      .run();
    tx.update(transactions)
      .set({ linkedTxnId: c.id })
      .where(eq(transactions.id, ccRow.id))
      .run();
    linkedPairs++;
  }

  return { linkedPairs };
}
