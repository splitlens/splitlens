/**
 * /review — dedicated form-driven transaction review surface.
 *
 * Server component. Reads filter + active-id from URL search params, fetches
 * the sidebar list and the detail for the active txn, hands them to the
 * client-side ReviewLayout for editing + keyboard nav.
 *
 * URL state:
 *   /review                                — open on the most recent unreviewed
 *   /review?id=2656                        — pin to a specific txn
 *   /review?unreviewed=true&category=Food:Restaurant&from=2026-05-01
 *                                          — filter-driven queue
 *
 * The active-id resolution rule (when ?id is absent):
 *   1. First unreviewed row in the filtered list, or
 *   2. First row in the filtered list (if all are reviewed), or
 *   3. null (empty state — no matching rows)
 */
import type { Metadata } from "next";
import {
  getTransactionForReview,
  getReviewFilterMeta,
  listCustomCategories,
  getAllClientReviewRows,
  getAllMerchantContexts,
  sweepPendingMerchantRules,
  type ReviewListFilter,
} from "@/lib/review-repo";
import { listKnownPeople } from "../friends/actions";
import { ReviewLayout } from "@/components/review/ReviewLayout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review · SplitLens" };

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

export default async function ReviewPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const sortParam = readStr(sp.sort);
  const todParam = readStr(sp.tod);
  const shareParam = readStr(sp.share);
  const recParam = readStr(sp.rec);
  const filter: ReviewListFilter = {
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

  // Apply any saved per-merchant rules to un-reviewed txns that landed
  // since the last visit. Cheap idempotent UPDATE — no-op when no rules
  // exist. Runs before the bulk row load so the response carries
  // already-categorized rows.
  await sweepPendingMerchantRules();

  // /review now runs the filter pipeline on the client. The server's job
  // is to ship the whole txn ledger + the static dropdown/lookup data
  // once; the client recomputes filters/buckets/aggregates on every click
  // via useMemo in ReviewLayout. The only remaining per-request server
  // work is the active txn detail (one row, on demand).
  const [meta, people, customCategories, allRows, merchantContexts] =
    await Promise.all([
      getReviewFilterMeta(),
      listKnownPeople(),
      listCustomCategories(),
      getAllClientReviewRows(),
      getAllMerchantContexts(),
    ]);

  // Pick the active row: explicit ?id wins; otherwise first unreviewed in
  // the matching slice; otherwise the first matching row. The matching
  // slice is computed inline (server-side) so we land on a real row on
  // first paint without waiting for the client filter to run.
  const requestedId = readInt(sp.id);
  let activeId: number | null = requestedId;
  if (activeId === null) {
    const matchesFilter = (r: (typeof allRows)[number]) => {
      if (filter.from && r.txnDate < filter.from) return false;
      if (filter.to && r.txnDate > filter.to) return false;
      if (filter.category && r.category !== filter.category) return false;
      if (filter.unreviewedOnly && r.reviewed) return false;
      if (filter.personId && r.personId !== filter.personId) return false;
      if (filter.accountId != null && r.accountId !== filter.accountId)
        return false;
      return true;
    };
    const matching = allRows.filter(matchesFilter);
    const firstUnreviewed = matching.find((r) => !r.reviewed);
    activeId = firstUnreviewed?.id ?? matching[0]?.id ?? null;
  }
  const detail = activeId != null ? await getTransactionForReview(activeId) : null;

  return (
    <ReviewLayout
      filter={filter}
      meta={meta}
      people={people}
      activeId={activeId}
      activeDetail={detail}
      customCategories={customCategories}
      allRows={allRows}
      merchantContexts={merchantContexts}
    />
  );
}
