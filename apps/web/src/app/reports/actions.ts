"use server";

import "server-only";
import { sql } from "drizzle-orm";
import { openDb } from "@splitlens/db";
import { revalidatePath } from "next/cache";

/**
 * Stamp a transaction as "user has looked at this and made a decision" — used
 * by the monthly-review queue to clear out cards once they've been triaged.
 * Setting `reviewed=1` is also our merger's signal not to overwrite user-
 * edited fields on future ingestion passes, so this doubles as edit-protection.
 */
export async function markReviewed(
  txnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) return { ok: false, error: "invalid id" };
  const db = openDb();
  db.run(sql`
    UPDATE transactions
    SET reviewed = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${txnId}
  `);
  revalidatePath("/reports", "layout");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function unmarkReviewed(
  txnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) return { ok: false, error: "invalid id" };
  const db = openDb();
  db.run(sql`
    UPDATE transactions
    SET reviewed = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${txnId}
  `);
  revalidatePath("/reports", "layout");
  revalidatePath("/dashboard");
  return { ok: true };
}
