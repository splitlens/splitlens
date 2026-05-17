import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveMerchant } from "@/lib/repo";
import { MerchantBusinessView } from "@/components/merchant/MerchantBusinessView";
import { MerchantPersonView } from "@/components/merchant/MerchantPersonView";
import "@/components/merchant/merchant-detail.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const decoded = safeDecode(id);
  return { title: `${decoded} · Merchant` };
}

/**
 * /merchants/[id] — single route, two visual registers.
 *
 * The id can be a `person_id` (e.g. "rahul-k") or a `counterparty` string
 * (e.g. "Zepto"). `resolveMerchant` tries person first (because person_ids
 * have the narrow alphanumeric shape), then falls back to the counterparty
 * lookup. The returned `kind` discriminator selects the view.
 */
export default async function MerchantDetailPage({ params }: PageProps) {
  const { id } = await params;
  const decoded = safeDecode(id);
  if (!decoded) notFound();

  const data = await resolveMerchant(decoded);
  if (!data) notFound();

  if (data.kind === "person") {
    return <MerchantPersonView data={data} />;
  }
  return <MerchantBusinessView data={data} />;
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
