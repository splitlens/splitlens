import { redirect } from "next/navigation";
import { getMonthlyReport } from "@/lib/repo";

/**
 * /reports — default to the latest month we have transactions for.
 *
 * Redirecting (rather than rendering in-place) keeps the URL canonical so
 * back/forward navigation between months works as expected.
 */
export const dynamic = "force-dynamic";

export default async function ReportsIndex() {
  const r = await getMonthlyReport(null);
  redirect(`/reports/${r.yearMonth}`);
}
