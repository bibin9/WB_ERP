import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The old printable page. The document is now a PDF drawn on the server with
 * the company's letterhead, so a link or bookmark to this address opens that
 * instead of a second, drifting copy of the same document.
 *
 * The PDF route checks the permission and the company itself.
 */
export default async function LegacyPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/api/pdf/tax-invoice/${encodeURIComponent(id)}`);
}
