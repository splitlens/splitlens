"use server";

import "server-only";
import { sql } from "drizzle-orm";
import { openDb } from "@splitlens/db";
import { DEFAULT_PEOPLE } from "@splitlens/core";
import { revalidatePath } from "next/cache";

/**
 * Mark a transaction as shared among `personIds` (plus you).
 * shareCount = personIds.length + 1 (the +1 is you).
 *
 * Persists into `transactions.shared_with` (CSV) + `shared_with` count, and
 * stamps `updated_at`. Invalidates the affected dashboard + friends routes
 * so the next page render reflects the new balance.
 */
export async function markShared(
  txnId: number,
  personIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) {
    return { ok: false, error: "invalid txnId" };
  }
  // Validate every personId against the in-code registry — no free-text
  // friends today. Adding a person to the registry is its own flow.
  const known = new Set(DEFAULT_PEOPLE.map((p) => p.id));
  const cleaned = Array.from(new Set(personIds.map((p) => p.trim()).filter(Boolean)));
  for (const pid of cleaned) {
    if (!known.has(pid)) return { ok: false, error: `unknown person: ${pid}` };
  }
  if (cleaned.length === 0) {
    return { ok: false, error: "pick at least one friend" };
  }

  const db = openDb();
  const sharedWith = cleaned.join(",");
  const shareCount = cleaned.length + 1; // include yourself
  db.run(sql`
    UPDATE transactions
    SET shared_with = ${sharedWith},
        share_count = ${shareCount},
        reviewed    = 1,
        updated_at  = CURRENT_TIMESTAMP
    WHERE id = ${txnId}
  `);

  revalidatePath("/dashboard");
  revalidatePath("/friends");
  for (const pid of cleaned) revalidatePath(`/friends/${pid}`);
  return { ok: true };
}

export async function unmarkShared(
  txnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(txnId) || txnId <= 0) {
    return { ok: false, error: "invalid txnId" };
  }
  const db = openDb();
  db.run(sql`
    UPDATE transactions
    SET shared_with = NULL,
        share_count = 1,
        updated_at  = CURRENT_TIMESTAMP
    WHERE id = ${txnId}
  `);
  revalidatePath("/dashboard");
  revalidatePath("/friends");
  return { ok: true };
}

/**
 * Picker data for the share modal. Returns the in-code registry, plus a
 * count of how many existing transactions are tied to each person — so the
 * UI can sort by "most-likely-relevant" friends first.
 */
export async function listKnownPeople(): Promise<
  Array<{ id: string; displayName: string; relationship: string; txnCount: number }>
> {
  const db = openDb();
  const rows = db.all<{ person_id: string; n: number }>(sql`
    SELECT person_id, count(*) AS n
    FROM transactions
    WHERE person_id IS NOT NULL
    GROUP BY person_id
  `);
  const txnCountByPid = new Map(rows.map((r) => [r.person_id, r.n]));
  return DEFAULT_PEOPLE.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    relationship: p.relationship,
    txnCount: txnCountByPid.get(p.id) ?? 0,
  })).sort((a, b) => b.txnCount - a.txnCount);
}
