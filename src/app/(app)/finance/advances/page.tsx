import { HandCoins, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import AdvanceForm from "@/components/finance/AdvanceForm";
import RecoverAdvance from "@/components/finance/RecoverAdvance";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { balanceOf } from "@/lib/ledger-query";
import { financePolicyFor } from "@/lib/accounts";
import { advanceState, summarise, advancesVerdict, STATUS_HELP } from "@/lib/advances";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const statusColour: Record<string, string> = {
  Open: "bg-brand-blue/10 text-brand-blue-600",
  Recovered: "bg-brand-green/10 text-brand-green-700",
  Refunded: "bg-line text-muted",
  "Written off": "bg-line text-muted",
};

export default async function AdvancesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; show?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("finance.advances");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const showAll = sp.show === "all";
  const term = readSearch(sp);

  const where = {
    companyId,
    ...(showAll ? {} : { status: "Open" }),
    ...(matchAny(term, ["reference", "partyName", "notes"]) ?? {}),
  };
  const paging = readPaging(sp);
  const total = companyId ? await db.partyAdvance.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const rows = companyId
    ? await db.partyAdvance.findMany({
        where,
        include: {
          recoveries: { select: { id: true, amount: true, date: true, invoiceId: true } },
          job: { select: { code: true, name: true } },
          entry: { select: { reference: true } },
        },
        orderBy: [{ date: "desc" }],
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  const parties = companyId
    ? await db.party.findMany({
        where: { companyId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, type: true },
      })
    : [];
  const jobs = companyId
    ? await db.job.findMany({
        where: { companyId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];

  // Cash and bank only. Offering the whole chart here is how an advance ends up
  // credited to revenue, which is the exact mistake this register exists to stop.
  const bankAccounts = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId, controlType: "Cash" },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];
  const writeOffAccounts = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId, type: { in: ["Expense", "Income"] } },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];

  // Issued invoices only: a draft is not a document anything can be set against.
  const invoices = companyId
    ? await db.invoice.findMany({
        where: { companyId, status: "Issued" },
        orderBy: { issuedAt: "desc" },
        take: 100,
        select: { id: true, number: true, grossTotal: true, partyId: true },
      })
    : [];

  // The summary counts every advance, not just the page being looked at.
  const all = companyId
    ? await db.partyAdvance.findMany({
        where: { companyId },
        select: { direction: true, amount: true, status: true, recoveries: { select: { amount: true } } },
      })
    : [];
  const totals = summarise(all);
  const verdict = advancesVerdict(all);

  // Agree the register to the ledger. Both sides posted through this screen, so
  // a difference means a voucher was reversed in the Day Book and the register
  // was not told — which is exactly the drift worth surfacing.
  const finPolicy = await financePolicyFor(companyId);
  const custCode = finPolicy.accounts.customerAdvances;
  const suppCode = finPolicy.accounts.supplierAdvances;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [custBal, suppBal] = companyId
    ? await Promise.all([
        balanceOf(companyId, custCode, today, company?.openingAsOf),
        balanceOf(companyId, suppCode, today, company?.openingAsOf),
      ])
    : [{ found: false, balance: 0 }, { found: false, balance: 0 }];
  // A liability sits as a credit; flip it to compare with what is held.
  const ledgerCustomer = -custBal.balance;
  const ledgerSupplier = suppBal.balance;
  const recon = {
    available: custBal.found && suppBal.found,
    customerDiff: Math.round((totals.Received.outstanding - ledgerCustomer) * 100) / 100,
    supplierDiff: Math.round((totals.Paid.outstanding - ledgerSupplier) * 100) / 100,
  };

  const card = "card p-5";

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Advances Register"
        subtitle={`as at ${fmt(today)}`}
      />

      <PageHeader
        title="Finance — Advances"
        subtitle="Money that moved before any work was billed, and how much of it is still to be recovered."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && (
            <AdvanceForm companyId={companyId} parties={parties} jobs={jobs} bankAccounts={bankAccounts} />
          )}
        </div>
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <p className="mb-5 text-sm text-ink">{verdict}</p>

      {companyId && bankAccounts.length === 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">No account is marked as cash or bank.</span> An advance cannot be recorded
          until one is, because there is nowhere for the money to have moved through. Open Ledgers and set the
          control type on your bank and petty cash accounts.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={`${card} ${totals.Received.outstanding > 0 ? "border-brand-blue/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {totals.Received.outstanding > 0 && <AlertTriangle className="h-4 w-4 text-brand-blue-600" />}
            Customer money held
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">
            {money(totals.Received.outstanding)}
          </div>
          <div className="mt-0.5 text-xs text-muted">taken but not yet billed against</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Recovered from customers</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.Received.recovered)}</div>
          <div className="mt-0.5 text-xs text-muted">of {money(totals.Received.advanced)} advanced</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Paid to suppliers</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.Paid.outstanding)}</div>
          <div className="mt-0.5 text-xs text-muted">still to be billed to us</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Net position</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">
            {money(totals.Received.outstanding - totals.Paid.outstanding)}
          </div>
          <div className="mt-0.5 text-xs text-muted">held from others, less held by others</div>
        </div>
      </div>

      {recon.available && (recon.customerDiff !== 0 || recon.supplierDiff !== 0) && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">The register and the ledger disagree.</span>{" "}
          {recon.customerDiff !== 0 && (
            <>
              Customer advances: {money(totals.Received.outstanding)} outstanding here against{" "}
              {money(ledgerCustomer)} on {custCode}, a difference of {money(recon.customerDiff)}.{" "}
            </>
          )}
          {recon.supplierDiff !== 0 && (
            <>
              Supplier advances: {money(totals.Paid.outstanding)} here against {money(ledgerSupplier)} on {suppCode},
              a difference of {money(recon.supplierDiff)}.{" "}
            </>
          )}
          A voucher was probably reversed in the Day Book without the register being told.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search reference, party or notes" />
        <div className="flex items-center gap-2 text-sm">
          <a
            href={`/finance/advances?c=${companyId}`}
            className={!showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}
          >
            Open
          </a>
          <span className="text-line">|</span>
          <a
            href={`/finance/advances?c=${companyId}&show=all`}
            className={showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}
          >
            All
          </a>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Reference</th>
              <th className="px-4 py-2.5 font-medium">Which way</th>
              <th className="px-4 py-2.5 font-medium">Party</th>
              <th className="px-4 py-2.5 font-medium">Job</th>
              <th className="px-4 py-2.5 text-right font-medium">Advanced</th>
              <th className="px-4 py-2.5 text-right font-medium">Recovered</th>
              <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-muted">
                  {total === 0 && !term
                    ? "No advances recorded. Record one when a customer pays up front, or when you pay a supplier before they have billed you."
                    : "Nothing matches."}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const st = advanceState(r);
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmt(r.date)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-heading">{r.reference}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                    {r.direction === "Received" ? "From a customer" : "To a supplier"}
                  </td>
                  <td className="px-4 py-2.5 text-ink">{r.partyName ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                    {r.job ? `${r.job.code}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(r.amount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {st.recovered > 0 ? money(st.recovered) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">
                    {money(st.outstanding)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span
                      title={STATUS_HELP[r.status]}
                      className={`rounded px-1.5 py-0.5 text-xs ${statusColour[r.status] ?? "bg-line text-muted"}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      {r.status === "Open" && (
                        <RecoverAdvance
                          id={r.id}
                          reference={r.reference}
                          direction={r.direction}
                          outstanding={st.outstanding}
                          recoveryPercent={r.recoveryPercent}
                          invoices={invoices
                            .filter((i) => !r.partyId || !i.partyId || i.partyId === r.partyId)
                            .map((i) => ({ id: i.id, number: i.number, grossTotal: i.grossTotal }))}
                          writeOffAccounts={writeOffAccounts}
                          bankAccounts={bankAccounts}
                        />
                      )}
                      <AdvanceForm
                        companyId={companyId}
                        parties={parties}
                        jobs={jobs}
                        bankAccounts={bankAccounts}
                        row={{
                          id: r.id,
                          direction: r.direction,
                          reference: r.reference,
                          jobId: r.jobId,
                          recoveryPercent: r.recoveryPercent,
                          notes: r.notes,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager info={info} />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <HandCoins className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          An advance is not income and not a cost, because nothing has been supplied when the money moves. One
          received is owed back until the work is billed; one paid is owed to you until the supplier bills for it.
          If the advance is for taxable work, the day the money arrived is a tax point under UAE rules, so raise the
          tax invoice on the Invoices screen and recover the advance against it &mdash; VAT is never charged here, so
          it cannot be declared twice.
        </p>
      </div>
    </div>
  );
}
