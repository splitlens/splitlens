/**
 * /review/split — the split-focused review surface.
 *
 * Uses the same client-side filtering infrastructure as
 * /review/category: server ships the whole txn ledger + lookup data
 * once, the client component recomputes which rows land in the
 * split queue on every filter change via useMemo. Filter clicks
 * (range pick, day tap, category chip, etc.) are instant.
 *
 * Three queue sections, in priority order of actionability:
 *
 *   1. Persons     — un-split person-kind txns (clear split candidates).
 *   2. Recurring   — monthly/weekly/quarterly to known people.
 *   3. Large       — anything above the threshold (default ₹1k) that's
 *                    not already split.
 *
 * Per-row click opens a focused SplitTxnModal (different from the
 * InboxModal — emphasizes who/balance over category).
 */
import type { Metadata } from "next";
import {
  getReviewFilterMeta,
  getAllClientReviewRows,
  getAllMerchantContexts,
  sweepPendingMerchantRules,
  type ReviewListFilter,
} from "@/lib/review-repo";
import { listKnownPeople } from "@/app/friends/actions";
import { SplitQueueClient } from "@/components/review/SplitQueueClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Split · SplitLens" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readStr(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
function readBool(v: string | string[] | undefined): boolean {
  const s = readStr(v);
  return s === "true" || s === "1";
}
function readInt(v: string | string[] | undefined): number | null {
  const s = readStr(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

const LARGE_THRESHOLD = 1000;

export default async function SplitReviewPage({ searchParams }: PageProps) {
  // Same URL-state schema as /review/category so filter chips, range
  // picks, and shareable links work identically across both surfaces.
  const sp = await searchParams;
  const sortParam = readStr(sp.sort);
  const todParam = readStr(sp.tod);
  const shareParam = readStr(sp.share);
  const recParam = readStr(sp.rec);
  const initialFilter: ReviewListFilter = {
    from: readStr(sp.from),
    to: readStr(sp.to),
    category: readStr(sp.category),
    unreviewedOnly: readBool(sp.unreviewed),
    personId: readStr(sp.personId),
    accountId: readInt(sp.accountId),
    q: readStr(sp.q),
    sort: sortParam === "asc" ? "asc" : sortParam === "desc" ? "desc" : undefined,
    timeOfDay:
      todParam === "morning" ||
      todParam === "afternoon" ||
      todParam === "evening" ||
      todParam === "night"
        ? todParam
        : null,
    shareStatus:
      shareParam === "personal" || shareParam === "shared" ? shareParam : null,
    recurrenceClass:
      recParam === "one_time" || recParam === "recurring" ? recParam : null,
  };

  // Apply any saved per-merchant rules so freshly-arrived rows pick up
  // shared-with/recurrence rules and drop out of the queue automatically.
  await sweepPendingMerchantRules();

  const [meta, people, allRows, merchantContexts] = await Promise.all([
    getReviewFilterMeta(),
    listKnownPeople(),
    getAllClientReviewRows(),
    getAllMerchantContexts(),
  ]);

  return (
    <SplitQueueClient
      filter={initialFilter}
      allRows={allRows}
      merchantContexts={merchantContexts}
      meta={meta}
      people={people}
      largeThreshold={LARGE_THRESHOLD}
    />
  );
}
