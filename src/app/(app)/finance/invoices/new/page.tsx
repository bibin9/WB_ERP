import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import FinanceTabs from "@/components/FinanceTabs";
import InvoiceForm from "@/components/finance/InvoiceForm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { financePolicyFor } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; side?: string }>;
}) {
  await requireAccess("finance.invoices", "create");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const side = sp.side === "Purchase" ? "Purchase" : "Sales";

  const [parties, accounts, jobs, issued, policy] = companyId
    ? await Promise.all([
        db.party.findMany({
          where: {
            companyId, isActive: true,
            type: side === "Sales" ? { in: ["Customer", "Both"] } : { in: ["Supplier", "Both"] },
          },
          orderBy: { name: "asc" },
          select: { id: true, code: true, name: true },
        }),
        // A sale bills to income; a purchase lands on a cost. Offering the whole
        // chart would let somebody credit revenue on a supplier's bill.
        db.chartOfAccount.findMany({
          where: { companyId, isActive: true, type: side === "Sales" ? "Income" : { in: ["Expense", "Asset"] } },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        }),
        db.job.findMany({
          where: { companyId, isActive: true, status: { in: ["Open", "On hold"] } },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        }),
        db.invoice.findMany({
          where: { companyId, side, status: "Issued", docType: "Invoice" },
          orderBy: { issueDate: "desc" },
          take: 200,
          select: { id: true, number: true, partyName: true },
        }),
        financePolicyFor(companyId),
      ])
    : [[], [], [], [], null];

  return (
    <div>
      <Link href={`/finance/invoices?c=${companyId}&side=${side}`} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to invoices
      </Link>

      <PageHeader
        title={side === "Sales" ? "New invoice" : "New supplier bill"}
        subtitle="Saved as a draft. Nothing reaches the books until it is issued."
      />

      <FinanceTabs companyId={companyId} />

      {accounts.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">
          There is no {side === "Sales" ? "income" : "expense"} account on this company yet. Add one on
          Finance → Overview first.
        </div>
      ) : (
        <InvoiceForm
          companyId={companyId}
          side={side}
          parties={parties}
          accounts={accounts}
          jobs={jobs}
          vatRate={policy?.vatRate ?? 0.05}
          invoices={issued}
        />
      )}
    </div>
  );
}
