/**
 * Cross-source transaction matcher.
 *
 * Given a per-row canonical reference number (UPI UTR / NEFT ref / etc.) and
 * the account it landed on, return the existing canonical transaction id if
 * any source has already observed this movement. Otherwise return null and
 * the caller will INSERT a new canonical row.
 *
 * The matching surface is intentionally narrow today — exact equality on
 * (account_id, ref_no) — because every Indian UPI/NEFT flow has a 12-digit
 * UTR (or equivalent) that's invariant across sources. Fuzzy matching by
 * (date, amount, direction) for the rare UTR-less rows is a follow-up.
 */
import { and, eq } from "drizzle-orm";
import { transactions } from "@splitlens/db";

/** A drizzle transaction handle ⊂ SplitLensDb. */
type TxLike = Parameters<Parameters<import("@splitlens/db").SplitLensDb["transaction"]>[0]>[0];

export function findCanonicalByRef(
  tx: TxLike,
  accountId: number,
  refNo: string | null | undefined,
): number | null {
  if (!refNo) return null;
  const hit = tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.refNo, refNo)))
    .get();
  return hit?.id ?? null;
}
