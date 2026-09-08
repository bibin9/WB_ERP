import { Banknote, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PrintReport from "@/components/finance/PrintReport";
import ExportButton from "@/components/ExportButton";
import GuardedDelete from "@/components/GuardedDelete";
import ChequeForm from "@/components/finance/ChequeForm";
import ChequeStatusControl from "@/components/finance/ChequeStatus";
import { deleteCheque } from "./actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { chequeState, forecast, OPEN_STATUSES } from "@/lib/cheques";
import Pager from "@/components/Pager";
import { readPaging, pageInfo } from "@/lib/paging";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const statusColour: Record<string, string> = {
  "In hand": "bg-brand-blue/10 text-brand-blue-600",
  Deposited: "bg-brand-gold/15 text-brand-gold",
  Cleared: "bg-brand-green/10 text-brand-green-700",
  Bounced: "bg-red-50 text-red-600",
  Returned: "bg-line text-muted",
};

export default async function ChequesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; show?: string; p?: string; per?: string }>;
}) {
  await requireAccess("finance.cheques");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  // Only for the letterhead: each company prints on its own.
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  // Settled cheques are history: kept, but out of the way unless asked for.
  const showAll = sp.show === "all";

  // The register keeps every cheque ever recorded, so it is paged. The forecast
  // below is deliberately not: it must count them all.
  const chequeWhere = { companyId, ...(showAll ? {} : { status: { in: [...OPEN_STATUSES] } }) };
  const paging = readPaging(sp);
  const chequeTotal = companyId ? await db.cheque.count({ where: chequeWhere }) : 0;
  const info = pageInfo(paging, chequeTotal);
  const cheques = companyId
    ? await db.cheque.findMany({
        where: chequeWhere,
        include: { entry: { select: { reference: true } } },
        orderBy: [{ chequeDate: "asc" }],
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

  // The forecast is what the register is for, so it is built from every open
  // cheque rather than only the ones currently on screen.
  const open = companyId
    ? await db.cheque.findMany({
        where: { companyId, status: { in: [...OPEN_STATUSES] } },
        select: { direction: true, chequeDate: true, amount: true, status: true },
      })
    : [];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const f = forecast(open, today);
  const overdueCount = open.filter((c) => chequeState(c, today).overdue).length;

  const card = "card p-5";

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Cheque Register"
        subtitle={`as at ${fmt(today)}`}
      />

      <PageHeader
        title="Finance — Cheque Register"
        subtitle="Post-dated cheques you are holding or have issued, and what is due to be banked."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <ExportButton dataset="cheques" companyId={companyId} label="Export" />}
          {companyId && <ChequeForm companyId={companyId} parties={parties} />}
        </div>
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      {overdueCount > 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {overdueCount} cheque{overdueCount === 1 ? "" : "s"} past the date on the cheque and still not banked.
          </span>{" "}
          That is money sitting in a drawer. They are at the top of the list.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={`${card} ${f.overdue !== 0 ? "border-brand-gold/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {f.overdue !== 0 && <AlertTriangle className="h-4 w-4 text-brand-gold" />}
            Overdue to bank
          </div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${f.overdue !== 0 ? "text-brand-gold" : "text-heading"}`}>
            {money(f.overdue)}
          </div>
          <div className="mt-0.5 text-xs text-muted">dated already, still in hand</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Next 7 days</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(f.week)}</div>
          <div className="mt-0.5 text-xs text-muted">bankable this week</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Next 30 days</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(f.month)}</div>
          <div className="mt-0.5 text-xs text-muted">the month ahead</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Later</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(f.later)}</div>
          <div className="mt-0.5 text-xs text-muted">beyond 30 days</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Banknote className="h-5 w-5 text-heading" />
          <h2 className="font-semibold text-heading">{showAll ? "Every cheque" : "Open cheques"}</h2>
          <span className="ml-auto text-xs text-muted">{chequeTotal}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Due</th>
              <th className="px-4 py-2 font-semibold">Cheque</th>
              <th className="px-4 py-2 font-semibold">Bank</th>
              <th className="px-4 py-2 font-semibold">Party</th>
              <th className="px-4 py-2 text-right font-semibold">In</th>
              <th className="px-4 py-2 text-right font-semibold">Out</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Held by</th>
              <th className="px-4 py-2 font-semibold print:hidden" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cheques.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  {showAll
                    ? "No cheques recorded yet."
                    : "No open cheques. Record one when a customer hands you a post-dated cheque, or when you issue one."}
                </td>
              </tr>
            )}
            {cheques.map((c) => {
              const st = chequeState(c, today);
              const received = c.direction === "Received";
              return (
                <tr key={c.id} className={st.overdue ? "bg-brand-gold/5" : ""}>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span className={st.overdue ? "font-medium text-brand-gold" : "text-ink"}>{fmt(c.chequeDate)}</span>
                    {st.open && (
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
                    {c.chequeNo}
                    {c.entry && <span className="ml-2 text-brand-green-700">{c.entry.reference}</span>}
                  </td>
                  <td className="px-4 py-2 text-muted">{c.bankName ?? "—"}</td>
                  <td className="px-4 py-2 text-ink">{c.partyName ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{received ? money(c.amount) : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{received ? <span className="text-muted">—</span> : money(c.amount)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColour[c.status] ?? ""}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{c.heldBy ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      <ChequeStatusControl id={c.id} status={c.status} chequeNo={c.chequeNo} amount={money(c.amount)} />
                      {!c.entryId && (
                        <ChequeForm
                          companyId={companyId}
                          parties={parties}
                          cheque={{
                            id: c.id,
                            direction: c.direction,
                            chequeNo: c.chequeNo,
                            bankName: c.bankName,
                            chequeDate: c.chequeDate.toISOString().slice(0, 10),
                            amount: c.amount,
                            partyId: c.partyId,
                            heldBy: c.heldBy,
                            notes: c.notes,
                          }}
                        />
                      )}
                      {!c.entryId && (
                        <GuardedDelete
                          screen="finance.cheques"
                          action={deleteCheque.bind(null, c.id)}
                          label={`Remove cheque ${c.chequeNo} from the register?`}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager info={info} label="cheques" />
      </div>

      <p className="mt-3 text-xs text-muted">
        Recording a cheque does not touch the accounts &mdash; it is a promise, not money. Only marking one{" "}
        <span className="font-medium text-ink">Cleared</span> posts a voucher, on the day the bank actually paid it, so
        a cheque that bounces leaves nothing to unwind.{" "}
        <a className="underline" href={`/finance/cheques?c=${companyId}&show=${showAll ? "open" : "all"}`}>
          {showAll ? "Show open cheques only" : "Show settled ones too"}
        </a>
        .
      </p>
    </div>
  );
}
