/**
 * Canonical-row merger. Applies the merge policy declared in
 * packages/db/src/schema.ts (transactions table doc-comment):
 *
 *   "prefer the most specific non-null value from any source, except: if
 *    `reviewed=1`, never overwrite `counterparty`, `category`, `person_id`,
 *    `shared_with`, or `notes` (the fields a user typically edits manually)."
 *
 * This v1 keeps the field-merge rules tight and explicit:
 *   - Fields are split into AUTO and USER_EDITABLE groups.
 *   - AUTO fields (narration, ref_no, txn_time, value_date, closing_balance,
 *     counterparty_kind) get filled when currently NULL.
 *   - USER_EDITABLE fields (counterparty, category, category_rule, person_id,
 *     shared_with, notes) get filled when currently NULL *and* reviewed=0.
 *   - withdrawal/deposit/txn_date are NEVER touched after first insert.
 *     If sources disagree on these, the conflict is preserved in
 *     transaction_sources.raw_json for later reconciliation rather than
 *     silently overwritten here.
 *
 * Always runs `updated_at = CURRENT_TIMESTAMP` when any change applies.
 */
import { eq, sql } from "drizzle-orm";
import { transactions, type Transaction, type SplitLensDb } from "@splitlens/db";

type TxLike = Parameters<Parameters<SplitLensDb["transaction"]>[0]>[0];

/** Fields a downstream source can contribute. All optional; null = no opinion. */
export interface MergeFieldsInput {
  narration?: string | null;
  refNo?: string | null;
  txnTime?: string | null;
  valueDate?: string | null;
  closingBalance?: number | null;
  counterparty?: string | null;
  counterpartyKind?: string | null;
  category?: string | null;
  categoryRule?: string | null;
  personId?: string | null;
}

const AUTO_FIELDS: (keyof MergeFieldsInput & keyof Transaction)[] = [
  "narration",
  "refNo",
  "txnTime",
  "valueDate",
  "closingBalance",
  "counterpartyKind",
];

const USER_EDITABLE_FIELDS: (keyof MergeFieldsInput & keyof Transaction)[] = [
  "counterparty",
  "category",
  "categoryRule",
  "personId",
];

export function mergeIntoCanonical(
  tx: TxLike,
  transactionId: number,
  input: MergeFieldsInput,
): { applied: number } {
  const existing = tx.select().from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!existing) return { applied: 0 };

  const updates: Record<string, unknown> = {};

  for (const f of AUTO_FIELDS) {
    if (existing[f] != null) continue;
    const next = input[f];
    if (next != null) updates[f] = next;
  }

  if (!existing.reviewed) {
    for (const f of USER_EDITABLE_FIELDS) {
      if (existing[f] != null) continue;
      const next = input[f];
      if (next != null) updates[f] = next;
    }
  }

  const applied = Object.keys(updates).length;
  if (applied === 0) return { applied: 0 };

  tx.update(transactions)
    .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(transactions.id, transactionId))
    .run();

  return { applied };
}
