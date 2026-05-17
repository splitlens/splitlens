/**
 * /review/split — the split-focused review surface.
 *
 * Three sections, in priority order of actionability:
 *
 *   1. Persons     — un-split person-kind txns (clear split candidates).
 *                    Each row has a one-click "Split 2-way with X" CTA.
 *
 *   2. Recurring   — monthly/weekly/quarterly txns to/from known people.
 *                    Likely rent / utilities / regular shared expenses.
 *
 *   3. Large       — anything above the threshold (default ₹1k) that's
 *                    not already split. Catches one-off shared expenses
 *                    (trip hotels, group dinners) that don't have a
 *                    person_id resolved.
 *
 * Per-row click opens a focused SplitTxnModal (different from the
 * InboxModal — emphasizes who/balance over category). The /friends page
 * is the longer-form per-person ledger; this queue links into it for
 * deeper exploration.
 */
import type { Metadata } from "next";
import {
  getSplitQueueRows,
  sweepPendingMerchantRules,
  type SplitQueueRow,
} from "@/lib/review-repo";
import { listKnownPeople } from "@/app/friends/actions";
import { SplitQueueClient } from "@/components/review/SplitQueueClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Split · SplitLens" };

const LARGE_THRESHOLD = 1000;

export default async function SplitReviewPage() {
  // Apply any saved per-merchant rules before fetching the queue so
  // newly-arrived rows pick up shared-with rules and drop out of the
  // person-kind un-split section automatically.
  await sweepPendingMerchantRules();

  const [rows, people] = await Promise.all([
    getSplitQueueRows(LARGE_THRESHOLD),
    listKnownPeople(),
  ]);

  // Section the queue by reason for the UI. We keep the priority order
  // (person → recurring → large) so the highest-leverage rows surface
  // first.
  const personRows = rows.filter((r) => r.reason === "person");
  const recurringRows = rows.filter((r) => r.reason === "recurring");
  const largeRows = rows.filter((r) => r.reason === "large");

  return (
    <SplitQueueClient
      personRows={personRows}
      recurringRows={recurringRows}
      largeRows={largeRows}
      people={people}
      largeThreshold={LARGE_THRESHOLD}
    />
  );
}

export type { SplitQueueRow };
