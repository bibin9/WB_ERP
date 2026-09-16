import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * The old printable page. The document is now a PDF drawn on the server with
 * the company's letterhead, so a link or bookmark to this address opens that
 * instead of a second, drifting copy of the same document.
 *
 * Checked here as well as in the PDF route, so this address refuses on its
 * own rather than relying on where it points.
 */
export default async function LegacyPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("hr.separation");
  const { id } = await params;
  redirect(`/api/pdf/settlement/${encodeURIComponent(id)}`);
}
