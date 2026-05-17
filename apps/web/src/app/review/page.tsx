/**
 * /review — the review hub. Splits into two sub-pages:
 *
 *   /review/category   the existing "what was this txn for?" surface
 *                      (full filter + scrubber + InboxModal flow).
 *
 *   /review/split      the new "who owes whom?" surface — un-split
 *                      person-kind txns, large un-reviewed candidates,
 *                      and recurring person transfers, all queued for
 *                      a focused per-txn split decision.
 *
 * The bare /review path redirects to /review/category so existing
 * bookmarks + shared links keep working. The sub-nav (provided by
 * /review/layout.tsx) is what users actually click to switch.
 */
import { redirect } from "next/navigation";

export default function ReviewIndex() {
  redirect("/review/category");
}
