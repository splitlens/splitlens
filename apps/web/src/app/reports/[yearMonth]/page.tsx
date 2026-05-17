import { notFound } from "next/navigation";
import { getMonthlyReport } from "@/lib/repo";
import { MonthDigest } from "@/components/reports/MonthDigest";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ yearMonth: string }>;
}

export default async function ReportMonthPage({ params }: PageProps) {
  const { yearMonth } = await params;
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) notFound();

  const report = await getMonthlyReport(yearMonth);
  return <MonthDigest report={report} />;
}
