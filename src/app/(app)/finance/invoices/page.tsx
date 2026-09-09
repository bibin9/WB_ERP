import Link from "next/link";
import clsx from "clsx";
import { FileText, Plus, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import Pager from "@/components/Pager";
import SearchBox from "@/components/SearchBox";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, like, numericTerm } from "@/lib/search";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d?: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const statusStyle: Record<string, string> = {
  Draft: "bg-brand-gold/15 text-brand-gold",
  Issued: "bg-brand-green/10 text-brand-green-700",
  Cancelled: "bg-line text-muted",
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; side?: string; status?: string; p?: string; per?: string; q?: string }>;
}) {
  await requireAccess("finance.invoices");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const side = sp.side === "Purchase" ? "Purchase" : "Sales";
  const status = ["Draft", "Issued", "Cancelled"].includes(sp.status ?? "") ? sp.status : undefined;
  const q = readSearch(sp);
  const mayCreate = can(session, "finance.invoices", "create");

  const amount = numericTerm(q);
  const where = {
    companyId,
    side,
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { number: like(q) },
            { partyName: like(q) },
            { notes: like(q) },
            ...(amount !== null ? [{ grossTotal: amount }] : []),
            { lines: { some: { description: like(q) } } },
          ],
        }
      : {}),
  };

  const paging = readPaging(sp);
  const total = companyId ? await db.invoice.count({ where }) : 0;
  const info = pageInfo(paging, total);
  const rows = companyId
    ? await db.invoice.findMany({
        where,
        orderBy: [{ issueDate: "desc" }, { number: "desc" }],
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
        select: {
          id: true, number: true, docType: true, status: true, issueDate: true, dueDate: true,
          partyName: true, netTotal: true, vatTotal: true, grossTotal: true, entryId: true,
          entry: { select: { reference: true } },
        },
      })
    : [];

  // A draft is money not yet billed. Worth a line at the top rather than
  // something noticed at month-end.
  const drafts = companyId ? await db.invoice.count({ where: { companyId, side, status: "Draft" } }) : 0;

  const tab = (label: string, key: string, value?: string) => {
    const params = new URLSearchParams();
    if (companyId) params.set("c", companyId);
    params.set("side", side);
    if (key === "status" && value) params.set("status", value);
    const active = key === "status" ? sp.status === value || (!sp.status && !value) : false;
    return (
      <Link
        key={`${key}-${value ?? "all"}`}
        href={`/finance/invoices?${params.toString()}`}
        className={clsx(
          "rounded-full px-3 py-1.5 text-xs transition-colors",
          active ? "bg-brand-navy text-white" : "border border-line text-muted hover:bg-brand-paper hover:text-ink",
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <div>
      <PageHeader
        title="Finance — Invoices"
        subtitle="Tax invoices you issue and supplier bills you receive. A draft posts nothing; issuing it does."
      >
        {mayCreate && companyId && (
          <Link
            href={`/finance/invoices/new?c=${companyId}&side=${side}`}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" /> New {side === "Sales" ? "invoice" : "bill"}
          </Link>
        )}
      </PageHeader>

      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <div className="flex gap-1">
          {(["Sales", "Purchase"] as const).map((s) => (
            <Link
              key={s}
              href={`/finance/invoices?c=${companyId}&side=${s}`}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs transition-colors",
                side === s ? "bg-brand-navy text-white" : "border border-line text-muted hover:bg-brand-paper hover:text-ink",
              )}
            >
              {s === "Sales" ? "We issued" : "Suppliers billed us"}
            </Link>
          ))}
        </div>
        <span className="text-line">|</span>
        <div className="flex flex-wrap gap-1">
          {tab("All", "status")}
          {tab("Draft", "status", "Draft")}
          {tab("Issued", "status", "Issued")}
          {tab("Cancelled", "status", "Cancelled")}
        </div>
      </div>

      <div className="mb-4">
        <SearchBox
          placeholder="Search invoices…"
          hint="Number, customer or supplier, a line description, a note — or an amount."
        />
      </div>

      {drafts > 0 && !status && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-4 py-3 text-sm text-ink print:hidden">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" />
          <p>
            {drafts} {drafts === 1 ? "draft has" : "drafts have"} not been issued. Nothing is in the
            books, and nobody has been asked to pay.
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Number</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">{side === "Sales" ? "Customer" : "Supplier"}</th>
                <th className="px-4 py-2.5 font-semibold">Due</th>
                <th className="px-4 py-2.5 text-right font-semibold">Net</th>
                <th className="px-4 py-2.5 text-right font-semibold">VAT</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    {q ? `Nothing matches “${q}”.` : `No ${side === "Sales" ? "invoices" : "supplier bills"} yet.`}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={`/finance/invoices/${r.id}`} className="font-medium text-brand-blue-600 hover:underline">
                      {r.number}
                    </Link>
                    {r.docType !== "Invoice" && (
                      <span className="ml-2 rounded bg-brand-gold/15 px-1.5 py-0.5 text-[11px] text-brand-gold">{r.docType}</span>
                    )}
                    {r.entry?.reference && (
                      <div className="text-[11px] text-muted">{r.entry.reference}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{fmt(r.issueDate)}</td>
                  <td className="px-4 py-2.5 text-ink">{r.partyName}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{fmt(r.dueDate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{n(r.netTotal)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{n(r.vatTotal)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-heading">{n(r.grossTotal)}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", statusStyle[r.status])}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager info={info} label={side === "Sales" ? "invoices" : "bills"} />
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">A draft is not an invoice.</span> Nothing reaches the
          books, the VAT return or the customer until it is issued — and once issued it cannot be
          edited, only credited. That is what makes the numbered series something an auditor can rely
          on.
        </p>
      </div>
    </div>
  );
}
