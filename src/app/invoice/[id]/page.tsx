import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import PrintButton from "@/components/hr/PrintButton";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { unitLabel } from "@/lib/invoice";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d?: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "—";

/**
 * The tax invoice, as the customer receives it.
 *
 * Everything on it comes from what was snapshotted at issue rather than from
 * the master records: the customer may have been renamed, moved or had their
 * TRN corrected since, and a reprint of a document already sent must be the
 * same document. That is the whole reason those columns exist.
 *
 * Printed on white in both themes, like the settlement statement — a document
 * that leaves the building is paper, not a screen.
 */
export default async function PrintableInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAccess("finance.invoices");
  const session = await getSession();
  if (!session) return null;

  const inv = await db.invoice.findFirst({
    where: { id, companyId: { in: session.companies.map((c) => c.id) } },
    include: {
      lines: { orderBy: { order: "asc" } },
      company: true,
      originalInvoice: { select: { number: true, issueDate: true } },
    },
  });
  if (!inv) notFound();

  const breakdown: { treatment: string; categoryCode: string; ratePercent: number; taxable: number; tax: number }[] =
    JSON.parse(inv.taxBreakdown || "[]");

  const sellerAddress = inv.sellerAddress
    ?? [inv.company.addressLine, inv.company.city, inv.company.emirate].filter(Boolean).join(", ");

  // The title the law expects on the face of the document.
  const title = inv.docType === "Invoice" ? "TAX INVOICE" : inv.docType.toUpperCase();

  return (
    <div className="theme-light min-h-screen bg-gray-100 py-8 text-gray-900 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href={`/finance/invoices/${inv.id}`} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <PrintButton />
      </div>

      <div className="mx-auto max-w-3xl bg-white p-10 shadow print:max-w-none print:p-0 print:shadow-none">
        {inv.status !== "Issued" && (
          <div className="mb-6 border-2 border-dashed border-amber-500 px-4 py-2 text-center text-sm font-semibold uppercase tracking-widest text-amber-700">
            {inv.status} — not a valid tax invoice
          </div>
        )}

        <div className="flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-5">
          <div>
            {inv.company.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={inv.company.logoUrl} alt={inv.company.name} className="mb-3 h-14 w-auto object-contain" />
            )}
            <div className="text-lg font-bold">{inv.company.name}</div>
            {sellerAddress && <div className="mt-1 max-w-xs text-xs text-gray-600">{sellerAddress}</div>}
            {inv.sellerTrn && <div className="mt-1 text-xs text-gray-600">TRN {inv.sellerTrn}</div>}
          </div>
          <div className="text-right">
            <div className="text-xl font-bold tracking-wide">{title}</div>
            <div className="mt-2 text-sm"><span className="text-gray-600">No.</span> <span className="font-semibold">{inv.number}</span></div>
            <div className="text-sm"><span className="text-gray-600">Date</span> {fmt(inv.issueDate)}</div>
            {inv.dueDate && <div className="text-sm"><span className="text-gray-600">Due</span> {fmt(inv.dueDate)}</div>}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-8">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Billed to</div>
            <div className="mt-1 font-semibold">{inv.partyName}</div>
            {inv.partyAddress && <div className="text-xs text-gray-600">{inv.partyAddress}</div>}
            <div className="mt-1 text-xs text-gray-600">TRN {inv.partyTrn ?? "—"}</div>
          </div>
          {inv.originalInvoice && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Against invoice</div>
              <div className="mt-1 font-semibold">{inv.originalInvoice.number}</div>
              <div className="text-xs text-gray-600">dated {fmt(inv.originalInvoice.issueDate)}</div>
            </div>
          )}
        </div>

        {/* Printed on paper it fits; read on a phone before printing, it would
            run off the side. The wrapper scrolls rather than the page. */}
        <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-gray-300 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              <th className="py-2 font-semibold">Unit</th>
              <th className="py-2 text-right font-semibold">Rate</th>
              <th className="py-2 text-right font-semibold">Net</th>
              <th className="py-2 text-right font-semibold">VAT %</th>
              <th className="py-2 text-right font-semibold">VAT</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-200 align-top">
                <td className="py-2 pr-3">{l.description}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-xs text-gray-600">{unitLabel(l.unitCode)}</td>
                <td className="py-2 text-right tabular-nums">{n(l.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">{n(l.netAmount)}</td>
                <td className="py-2 text-right tabular-nums text-gray-600">{l.vatRate ? `${l.vatRate}%` : "—"}</td>
                <td className="py-2 text-right tabular-nums">{n(l.vatAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Net total</span><span className="tabular-nums">{n(inv.netTotal)}</span></div>
            {/* One line per VAT category. A tax invoice has to show the tax by
                rate, and it is what makes the return provable back to source. */}
            {breakdown.map((g) => (
              <div key={`${g.treatment}-${g.ratePercent}`} className="flex justify-between">
                <span className="text-gray-600">
                  {g.treatment}{g.ratePercent ? ` at ${g.ratePercent}%` : ""}
                  <span className="ml-1 text-xs text-gray-500">on {n(g.taxable)}</span>
                </span>
                <span className="tabular-nums">{n(g.tax)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t-2 border-gray-800 pt-2 text-base font-bold">
              <span>Total {inv.currency}</span>
              <span className="tabular-nums">{n(inv.grossTotal)}</span>
            </div>
          </div>
        </div>

        {inv.notes && (
          <div className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-600">{inv.notes}</div>
        )}

        {inv.lines.some((l) => l.vatTreatment === "Reverse charge") && (
          <div className="mt-4 text-xs font-medium text-gray-700">
            Reverse charge applies: the recipient accounts for the VAT on the marked lines.
          </div>
        )}

        <div className="mt-10 grid grid-cols-2 gap-10 text-xs text-gray-500">
          <div>
            <div className="mb-8">Received in good order</div>
            <div className="border-t border-gray-400 pt-1">Signature and stamp</div>
          </div>
          <div className="text-right">
            <div className="mb-8">For {inv.company.name}</div>
            <div className="border-t border-gray-400 pt-1">Authorised signatory</div>
          </div>
        </div>
      </div>
    </div>
  );
}
