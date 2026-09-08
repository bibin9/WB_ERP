import { Lock, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PrintReport from "@/components/finance/PrintReport";
import ExportButton from "@/components/ExportButton";
import GuardedDelete from "@/components/GuardedDelete";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import RetentionForm from "@/components/finance/RetentionForm";
import ReleaseRetention from "@/components/finance/ReleaseRetention";
import { deleteRetention } from "./actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { balanceAsAt } from "@/lib/ledger";
import {
  retentionState, ageing, RETENTION_RECEIVABLE_CODE, RETENTION_PAYABLE_CODE,
} from "@/lib/retention";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const statusColour: Record<string, string> = {
  Held: "bg-brand-blue/10 text-brand-blue-600",
  Released: "bg-brand-green/10 text-brand-green-700",
  "Written off": "bg-line text-muted",
};

export default async function RetentionPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; show?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("finance.retention");
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
    ...(showAll ? {} : { status: "Held" }),
    ...(matchAny(term, ["reference", "partyName", "notes", "stage"]) ?? {}),
  };
  const paging = readPaging(sp);
  const total = companyId ? await db.retention.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const rows = companyId
    ? await db.retention.findMany({
        where,
        include: { job: { select: { code: true, name: true } }, entry: { select: { reference: true } } },
        orderBy: [{ dueDate: "asc" }],
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

  // The summary counts everything still held, not just what is on this page.
  const held = companyId
    ? await db.retention.findMany({
        where: { companyId, status: "Held" },
        select: { direction: true, dueDate: true, amount: true, status: true },
      })
    : [];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const receivable = ageing(held.filter((r) => r.direction === "Receivable"), today);
  const payable = ageing(held.filter((r) => r.direction === "Payable"), today);
  const overdueCount = held.filter((r) => retentionState(r, today).overdue).length;

  // Agree the register to the ledger. The certificate already posted the money;
  // if the two disagree, either something was withheld and never recorded here,
  // or recorded here and never withheld.
  const retentionAccounts = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId, code: { in: [RETENTION_RECEIVABLE_CODE, RETENTION_PAYABLE_CODE] } },
        include: { lines: { include: { entry: { select: { date: true } } } } },
      })
    : [];
  const recvAcc = retentionAccounts.find((a) => a.code === RETENTION_RECEIVABLE_CODE);
  const payAcc = retentionAccounts.find((a) => a.code === RETENTION_PAYABLE_CODE);
  const ledgerRecv = recvAcc ? balanceAsAt(recvAcc, today, company?.openingAsOf) : 0;
  // A liability sits as a credit; flip it to compare with what is held.
  const ledgerPay = payAcc ? -balanceAsAt(payAcc, today, company?.openingAsOf) : 0;
  const recon = {
    available: !!recvAcc && !!payAcc,
    recvDiff: Math.round((receivable.total - ledgerRecv) * 100) / 100,
    payDiff: Math.round((payable.total - ledgerPay) * 100) / 100,
  };

  const card = "card p-5";

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Retention Register"
        subtitle={`as at ${fmt(today)}`}
      />

      <PageHeader
        title="Finance — Retention"
        subtitle="What is being held back on your contracts, both ways, and when you can ask for it."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <ExportButton dataset="retention" companyId={companyId} label="Export" />}
          {companyId && <RetentionForm companyId={companyId} parties={parties} jobs={jobs} />}
        </div>
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      {overdueCount > 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {overdueCount === 1
              ? "1 retention entry is past the date it could have been asked for."
              : `${overdueCount} retention entries are past the date they could have been asked for.`}
          </span>{" "}
          Retention sits for a year at a time, so nothing will remind you but this.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={`${card} ${receivable.releasable > 0 ? "border-brand-green/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {receivable.releasable > 0 && <AlertTriangle className="h-4 w-4 text-brand-green-700" />}
            Ready to ask for
          </div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${receivable.releasable > 0 ? "text-brand-green-700" : "text-heading"}`}>
            {money(receivable.releasable)}
          </div>
          <div className="mt-0.5 text-xs text-muted">clients&rsquo; retention now due to us</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Held by clients</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(receivable.total)}</div>
          <div className="mt-0.5 text-xs text-muted">{money(receivable.soon)} due within 60 days</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Held by us</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(payable.total)}</div>
          <div className="mt-0.5 text-xs text-muted">{money(payable.releasable)} now due to subcontractors</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Net held back</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">
            {money(receivable.total - payable.total)}
          </div>
          <div className="mt-0.5 text-xs text-muted">what the contracts owe you, on balance</div>
        </div>
      </div>

      {recon.available && (recon.recvDiff !== 0 || recon.payDiff !== 0) && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">The register and the ledger disagree.</span>{" "}
          {recon.recvDiff !== 0 && (
            <>
              Receivable: {money(receivable.total)} recorded here against {money(ledgerRecv)} on{" "}
              {RETENTION_RECEIVABLE_CODE}, a difference of {money(recon.recvDiff)}.{" "}
            </>
          )}
          {recon.payDiff !== 0 && (
            <>
              Payable: {money(payable.total)} here against {money(ledgerPay)} on {RETENTION_PAYABLE_CODE}, a
              difference of {money(recon.payDiff)}.{" "}
            </>
          )}
          Either something was withheld on a certificate and never noted here, or noted here and never withheld.
        </div>
      )}

      <div className="mb-4">
        <SearchBox placeholder="Search retention…" hint="Certificate, party, stage or a note." />
      </div>

      <div className="card overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Lock className="h-5 w-5 text-heading" />
          <h2 className="font-semibold text-heading">{showAll ? "Every entry" : "Still held"}</h2>
          <span className="ml-auto text-xs text-muted">{total}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Releasable</th>
              <th className="px-4 py-2 font-semibold">Certificate</th>
              <th className="px-4 py-2 font-semibold">Job</th>
              <th className="px-4 py-2 font-semibold">Party</th>
              <th className="px-4 py-2 font-semibold">Stage</th>
              <th className="px-4 py-2 text-right font-semibold">Owed to us</th>
              <th className="px-4 py-2 text-right font-semibold">Owed by us</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold print:hidden" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  {term
                    ? "Nothing matches that."
                    : showAll
                      ? "Nothing in the register yet."
                      : "Nothing held. Record an entry each time a certificate withholds retention, so the money is not forgotten."}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const st = retentionState(r, today);
              const recv = r.direction === "Receivable";
              return (
                <tr key={r.id} className={st.overdue ? "bg-brand-gold/5" : ""}>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span className={st.overdue ? "font-medium text-brand-gold" : "text-ink"}>{fmt(r.dueDate)}</span>
                    {st.held && (
                      <span className="block text-xs text-muted">
                        {st.overdue
                          ? `${Math.abs(st.daysUntilDue)}d ago`
                          : st.daysUntilDue === 0
                            ? "today"
                            : `in ${st.daysUntilDue}d`}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-heading">
                    {r.reference}
                    {r.entry && <span className="ml-2 text-brand-green-700">{r.entry.reference}</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{r.job ? r.job.code : "—"}</td>
                  <td className="px-4 py-2 text-ink">{r.partyName ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {r.stage}
                    {r.percent ? <span className="ml-1">({r.percent}%)</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{recv ? money(r.amount) : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{recv ? <span className="text-muted">—</span> : money(r.amount)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColour[r.status] ?? ""}`}>{r.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      {r.status === "Held" && (
                        <ReleaseRetention
                          id={r.id}
                          reference={r.reference}
                          amount={money(r.amount)}
                          direction={r.direction}
                          releasable={st.releasable}
                        />
                      )}
                      {!r.entryId && (
                        <RetentionForm
                          companyId={companyId}
                          parties={parties}
                          jobs={jobs}
                          row={{
                            id: r.id,
                            direction: r.direction,
                            reference: r.reference,
                            jobId: r.jobId,
                            partyId: r.partyId,
                            amount: r.amount,
                            percent: r.percent,
                            dueDate: r.dueDate.toISOString().slice(0, 10),
                            stage: r.stage,
                            notes: r.notes,
                          }}
                        />
                      )}
                      {!r.entryId && (
                        <GuardedDelete
                          screen="finance.retention"
                          action={deleteRetention.bind(null, r.id)}
                          label={`Remove retention on ${r.reference}?`}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager info={info} label="entries" />
      </div>

      <p className="mt-3 text-xs text-muted">
        Recording an entry does not change your accounts &mdash; the certificate that withheld the money already did.
        Releasing does: it moves the amount into the ordinary receivable or payable so it appears in Outstanding and
        gets chased or paid.{" "}
        <a className="underline" href={`/finance/retention?c=${companyId}&show=${showAll ? "held" : "all"}`}>
          {showAll ? "Show what is still held only" : "Show released entries too"}
        </a>
        .
      </p>
    </div>
  );
}
