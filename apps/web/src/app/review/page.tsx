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
  listTransactionsForReview,
  getTransactionForReview,
  getReviewFilterMeta,
  getTimeBuckets,
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
  };

  const [list, meta, people, buckets] = await Promise.all([
    listTransactionsForReview(filter),
    getReviewFilterMeta(),
    listKnownPeople(),
    getTimeBuckets(filter),
  ]);

  // Pick the active row: explicit ?id wins; otherwise first unreviewed in the
  // filtered list; otherwise the first row (empty state handled in client).
  const requestedId = readInt(sp.id);
  let activeId: number | null = requestedId;
  if (activeId === null) {
    const firstUnreviewed = list.rows.find((r) => !r.reviewed);
    activeId = firstUnreviewed?.id ?? list.rows[0]?.id ?? null;
  }
  const detail = activeId != null ? await getTransactionForReview(activeId) : null;

  return (
    <ReviewLayout
      filter={filter}
      list={list}
      meta={meta}
      people={people}
      buckets={buckets}
      activeId={activeId}
      activeDetail={detail}
    />
  );
}
