import { notFound } from "next/navigation";
import { getMonthlyReport } from "@/lib/repo";
import { listKnownPeople } from "@/app/friends/actions";
import { MonthReport } from "@/components/reports/MonthReport";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ yearMonth: string }>;
}

export default async function ReportMonthPage({ params }: PageProps) {
  const { yearMonth } = await params;
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) notFound();

  const [report, people] = await Promise.all([
    getMonthlyReport(yearMonth),
    listKnownPeople(),
  ]);

  return <MonthReport report={report} people={people} />;
}
