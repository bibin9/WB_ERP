import Link from "next/link";
import { Wallet, HandCoins } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import ConfirmDelete from "@/components/ConfirmDelete";
import RunPayrollForm from "@/components/payroll/RunPayrollForm";
import RunStatus from "@/components/payroll/RunStatus";
import AdvanceForm from "@/components/payroll/AdvanceForm";
import { WpsSettings, WpsDownload } from "@/components/payroll/WpsControls";
import { deletePayrollRun, deleteAdvance } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";
const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPeriod = (p: string) => new Date(p + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ c?: string; run?: string }> }) {
  await requireAccess("hr.payroll");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const employees = companyId ? await db.employee.findMany({ where: { companyId, status: { not: "Inactive" } }, orderBy: { name: "asc" }, select: { id: true, empNo: true, name: true } }) : [];
  const advances = companyId ? await db.advance.findMany({ where: { companyId, status: "Active" }, orderBy: { createdAt: "desc" } }) : [];

  const runs = companyId
    ? await db.payrollRun.findMany({ where: { companyId }, include: { _count: { select: { payslips: true } }, payslips: { select: { netPay: true } } }, orderBy: { period: "desc" } })
    : [];
  const selected = sp.run
    ? await db.payrollRun.findFirst({ where: { id: sp.run, companyId }, include: { payslips: { orderBy: { empNo: "asc" } } } })
    : null;

  return (
    <div>
      <PageHeader title="HR & Admin — Payroll" subtitle="Run monthly payroll, recover salary advances, and generate the UAE WPS SIF file for the bank.">
        <div className="flex gap-2">
          {companyId && <AdvanceForm companyId={companyId} employees={employees.map((e) => ({ id: e.id, label: `${e.empNo} — ${e.name}` }))} />}
          {companyId && <RunPayrollForm companyId={companyId} />}
        </div>
      </PageHeader>
      <HrTabs />

      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Runs */}
        <div className="card">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-brand-navy">Payroll runs</h2></div>
          <div className="divide-y divide-line">
            {runs.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No payroll runs yet. Click “Run payroll”.</p>}
            {runs.map((r) => {
              const total = r.payslips.reduce((s, p) => s + p.netPay, 0);
              return (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1">
                    <Link href={`/hr/payroll?c=${companyId}&run=${r.id}`} className="text-sm font-medium text-ink hover:text-brand-blue-600">{fmtPeriod(r.period)}</Link>
                    <div className="text-xs text-muted">{r._count.payslips} payslips · AED {money(total)} · by {r.runBy}</div>
                  </div>
                  <RunStatus id={r.id} status={r.status} />
                  {r.status === "Draft" && <ConfirmDelete action={deletePayrollRun.bind(null, r.id)} label={`Delete draft payroll ${r.period}?`} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Payslips */}
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold text-brand-navy">{selected ? `Payslips — ${fmtPeriod(selected.period)}` : "Payslips"}</h2>
            {selected && <WpsDownload runId={selected.id} />}
          </div>
          {!selected ? (
            <div className="grid place-items-center gap-2 px-5 py-12 text-center text-sm text-muted"><Wallet className="h-6 w-6 text-line" /> Select a run to view its payslips.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                    <th className="px-3 py-2 font-semibold">Emp</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 text-right font-semibold">Basic</th>
                    <th className="px-3 py-2 text-right font-semibold">Allow.</th>
                    <th className="px-3 py-2 text-right font-semibold">Advance</th>
                    <th className="px-3 py-2 text-right font-semibold">Deduct.</th>
                    <th className="px-3 py-2 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {selected.payslips.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-mono text-xs text-brand-navy">{p.empNo}</td>
                      <td className="px-3 py-2 text-ink">{p.employeeName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.basic)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.allowances)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-gold">{p.advanceRecovery ? "−" + money(p.advanceRecovery) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{p.deductions ? "−" + money(p.deductions) : "—"}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{money(p.netPay)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-brand-paper font-semibold">
                    <td className="px-3 py-2" colSpan={6}>Total net pay</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{money(selected.payslips.reduce((s, p) => s + p.netPay, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Advances + WPS settings */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-brand-navy">
            <HandCoins className="h-5 w-5" /><h2 className="font-semibold">Active salary advances</h2>
            <span className="ml-auto text-xs text-muted">{advances.length}</span>
          </div>
          <div className="divide-y divide-line">
            {advances.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No active advances. Click “New advance”.</p>}
            {advances.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium text-ink">{a.employeeName}</div>
                  <div className="text-xs text-muted">Advance AED {money(a.amount)} · recover AED {money(a.monthlyRecovery)}/mo{a.reason ? ` · ${a.reason}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums text-brand-navy">AED {money(a.balance)}</div>
                  <div className="text-[11px] text-muted">outstanding</div>
                </div>
                <ConfirmDelete action={deleteAdvance.bind(null, a.id)} label={`Delete advance for ${a.employeeName}?`} />
              </div>
            ))}
          </div>
        </div>

        {company && <WpsSettings companyId={companyId} employerId={company.wpsEmployerId ?? ""} routing={company.wpsBankRouting ?? ""} />}
      </div>
    </div>
  );
}
