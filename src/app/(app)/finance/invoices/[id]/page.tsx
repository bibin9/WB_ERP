import Link from "next/link";
import clsx from "clsx";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer, ScrollText } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import FinanceTabs from "@/components/FinanceTabs";
import InvoiceForm from "@/components/finance/InvoiceForm";
import IssueInvoice from "@/components/finance/IssueInvoice";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { financePolicyFor } from "@/lib/accounts";
import { unitLabel } from "@/lib/invoice";
import { type VatTreatment } from "@/lib/vat";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d?: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAccess("finance.invoices");
  const session = await getSession();
  if (!session) return null;

  const inv = await db.invoice.findFirst({
    where: { id, companyId: { in: session.companies.map((c) => c.id) } },
    include: {
      lines: { orderBy: { order: "asc" }, include: { account: { select: { code: true, name: true } }, job: { select: { code: true } } } },
      entry: { select: { id: true, reference: true } },
      originalInvoice: { select: { id: true, number: true } },
      adjustments: { select: { id: true, number: true, docType: true, grossTotal: true, status: true } },
    },
  });
  if (!inv) notFound();

  const side = inv.side as "Sales" | "Purchase";
  const editable = inv.status === "Draft" && can(session, "finance.invoices", "edit");
  const mayIssue = inv.status === "Draft" && can(session, "finance.invoices", "approve");

  const [parties, accounts, jobs, issued, policy] = await Promise.all([
    db.party.findMany({
      where: {
        companyId: inv.companyId, isActive: true,
        type: side === "Sales" ? { in: ["Customer", "Both"] } : { in: ["Supplier", "Both"] },
      },
      orderBy: { name: "asc" }, select: { id: true, code: true, name: true },
    }),
    db.chartOfAccount.findMany({
      where: { companyId: inv.companyId, isActive: true, type: side === "Sales" ? "Income" : { in: ["Expense", "Asset"] } },
      orderBy: { code: "asc" }, select: { id: true, code: true, name: true },
    }),
    db.job.findMany({
      where: { companyId: inv.companyId, isActive: true, status: { in: ["Open", "On hold"] } },
      orderBy: { code: "asc" }, select: { id: true, code: true, name: true },
    }),
    db.invoice.findMany({
      where: { companyId: inv.companyId, side, status: "Issued", docType: "Invoice", id: { not: inv.id } },
      orderBy: { issueDate: "desc" }, take: 200,
      select: { id: true, number: true, partyName: true },
    }),
    financePolicyFor(inv.companyId),
  ]);

  const breakdown: { treatment: string; categoryCode: string; ratePercent: number; taxable: number; tax: number }[] =
    JSON.parse(inv.taxBreakdown || "[]");

  return (
    <div>
      <Link href={`/finance/invoices?c=${inv.companyId}&side=${side}`} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to invoices
      </Link>

      <PageHeader
        title={`${inv.docType} ${inv.number}`}
        subtitle={`${inv.partyName} · ${fmt(inv.issueDate)} · ${inv.status}`}
      >
        {inv.status === "Issued" && side === "Sales" && (
          <Link href={`/invoice/${inv.id}`} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-brand-paper">
            <Printer className="h-4 w-4" /> Print
          </Link>
        )}
      </PageHeader>

      <FinanceTabs companyId={inv.companyId} />

      {inv.status === "Draft" ? (
        <>
          {mayIssue && (
            <div className="mb-5">
              <IssueInvoice id={inv.id} docType={inv.docType} number={inv.number} />
            </div>
          )}
          {editable ? (
            <InvoiceForm
              companyId={inv.companyId}
              side={side}
              parties={parties}
              accounts={accounts}
              jobs={jobs}
              vatRate={policy?.vatRate ?? 0.05}
              invoices={issued}
              existing={{
                id: inv.id, docType: inv.docType, number: inv.number,
                issueDate: inv.issueDate.toISOString().slice(0, 10),
                partyId: inv.partyId, jobId: inv.jobId ?? "", notes: inv.notes ?? "",
                originalInvoiceId: inv.originalInvoiceId ?? "",
                lines: inv.lines.map((l) => ({
                  description: l.description, quantity: String(l.quantity), unitCode: l.unitCode,
                  unitPrice: String(l.unitPrice), discount: l.discount ? String(l.discount) : "",
                  vatTreatment: l.vatTreatment as VatTreatment, accountId: l.accountId, jobId: l.jobId ?? "",
                })),
              }}
            />
          ) : (
            <Readonly inv={inv} breakdown={breakdown} />
          )}
        </>
      ) : (
        <>
          {inv.entry && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-3 text-sm">
              <ScrollText className="h-4 w-4 shrink-0 text-brand-green-700" />
              <span className="text-brand-green-700">
                Issued and posted as <span className="font-medium">{inv.entry.reference}</span>
                {inv.issuedBy ? ` by ${inv.issuedBy}` : ""}
                {inv.issuedAt ? ` on ${fmt(inv.issuedAt)}` : ""}.
              </span>
              <Link href={`/finance/daybook?c=${inv.companyId}`} className="text-brand-blue-600 hover:underline">
                See it in the day book
              </Link>
            </div>
          )}
          <Readonly inv={inv} breakdown={breakdown} />
        </>
      )}

      {inv.originalInvoice && (
        <p className="mt-4 text-sm text-muted">
          This {inv.docType.toLowerCase()} adjusts{" "}
          <Link href={`/finance/invoices/${inv.originalInvoice.id}`} className="text-brand-blue-600 hover:underline">
            {inv.originalInvoice.number}
          </Link>.
        </p>
      )}
      {inv.adjustments.length > 0 && (
        <div className="card mt-5 p-5">
          <h2 className="mb-2 text-sm font-semibold text-heading">Adjusted by</h2>
          <ul className="space-y-1 text-sm">
            {inv.adjustments.map((a) => (
              <li key={a.id}>
                <Link href={`/finance/invoices/${a.id}`} className="text-brand-blue-600 hover:underline">{a.number}</Link>
                <span className="text-muted"> — {a.docType}, {n(a.grossTotal)} ({a.status})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** An issued document, and a draft somebody may look at but not change. */
function Readonly({
  inv,
  breakdown,
}: {
  inv: {
    partyName: string; partyTrn: string | null; sellerTrn: string | null; notes: string | null;
    dueDate: Date | null; netTotal: number; vatTotal: number; grossTotal: number; currency: string;
    lines: { id: string; description: string; quantity: number; unitCode: string; unitPrice: number; discount: number; netAmount: number; vatTreatment: string; vatRate: number; vatAmount: number; account: { code: string; name: string } | null; job: { code: string } | null }[];
  };
  breakdown: { treatment: string; ratePercent: number; taxable: number; tax: number }[];
}) {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-1 gap-4 border-b border-line p-5 sm:grid-cols-3">
        <Fact label="Billed to" value={inv.partyName} sub={inv.partyTrn ? `TRN ${inv.partyTrn}` : "no TRN on file"} />
        <Fact label="Our TRN" value={inv.sellerTrn ?? "—"} />
        <Fact label="Due" value={fmt(inv.dueDate)} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-semibold">Description</th>
              <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
              <th className="px-4 py-2.5 font-semibold">Unit</th>
              <th className="px-4 py-2.5 text-right font-semibold">Rate</th>
              <th className="px-4 py-2.5 font-semibold">VAT</th>
              <th className="px-4 py-2.5 font-semibold">Account</th>
              <th className="px-4 py-2.5 text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5 text-ink">
                  {l.description}
                  {l.job && <span className="ml-2 text-xs text-muted">{l.job.code}</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{l.quantity}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{unitLabel(l.unitCode)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{n(l.unitPrice)}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{l.vatTreatment}{l.vatRate ? ` ${l.vatRate}%` : ""}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{l.account ? `${l.account.code} ${l.account.name}` : "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-heading">{n(l.netAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line bg-brand-paper/60 px-5 py-4">
        <div className="ml-auto max-w-sm space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted">Net</span><span className="tabular-nums text-ink">{n(inv.netTotal)}</span></div>
          {breakdown.map((g) => (
            <div key={`${g.treatment}-${g.ratePercent}`} className="flex justify-between">
              <span className="text-muted">
                {g.treatment}{g.ratePercent ? ` at ${g.ratePercent}%` : ""}
                <span className="ml-1 text-xs text-muted/70">on {n(g.taxable)}</span>
              </span>
              <span className="tabular-nums text-ink">{n(g.tax)}</span>
            </div>
          ))}
          <div className="!mt-2 flex items-baseline justify-between border-t border-line pt-2">
            <span className="font-medium text-ink">Total {inv.currency}</span>
            <span className="text-lg font-bold tabular-nums text-heading">{n(inv.grossTotal)}</span>
          </div>
        </div>
        {inv.notes && <p className="mt-4 text-xs text-muted">{inv.notes}</p>}
      </div>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-ink">{value}</div>
      {sub && <div className={clsx("text-xs", sub.includes("no TRN") ? "text-brand-gold" : "text-muted")}>{sub}</div>}
    </div>
  );
}
