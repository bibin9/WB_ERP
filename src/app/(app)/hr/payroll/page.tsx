import Link from "next/link";
import { Wallet } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import ConfirmDelete from "@/components/ConfirmDelete";
import RunPayrollForm from "@/components/payroll/RunPayrollForm";
import RunStatus from "@/components/payroll/RunStatus";
import { deletePayrollRun } from "./actions";
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

  const runs = companyId
    ? await db.payrollRun.findMany({
        where: { companyId },
        include: { _count: { select: { payslips: true } }, payslips: { select: { netPay: true } } },
        orderBy: { period: "desc" },
      })
    : [];

  const selected = sp.run
    ? await db.payrollRun.findFirst({ where: { id: sp.run, companyId }, include: { payslips: { orderBy: { empNo: "asc" } } } })
    : null;

  return (
    <div>
      <PageHeader title="HR & Admin — Payroll" subtitle="Run monthly payroll from the salary structure, review payslips, and approve for payment.">
        {companyId && <RunPayrollForm companyId={companyId} />}
      </PageHeader>
      <HrTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

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
                    <Link href={`/hr/payroll?c=${companyId}&run=${r.id}`} className="text-sm font-medium text-ink hover:text-brand-blue-600">
                      {fmtPeriod(r.period)}
                    </Link>
                    <div className="text-xs text-muted">{r._count.payslips} payslips · AED {money(total)} · by {r.runBy}</div>
                  </div>
                  <RunStatus id={r.id} status={r.status} />
                  {r.status === "Draft" && <ConfirmDelete action={deletePayrollRun.bind(null, r.id)} label={`Delete draft payroll ${r.period}?`} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Payslips of selected run */}
        <div className="card">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-brand-navy">
              {selected ? `Payslips — ${fmtPeriod(selected.period)}` : "Payslips"}
            </h2>
          </div>
          {!selected ? (
            <div className="grid place-items-center gap-2 px-5 py-12 text-center text-sm text-muted">
              <Wallet className="h-6 w-6 text-line" /> Select a run to view its payslips.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                    <th className="px-4 py-2 font-semibold">Emp</th>
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 text-right font-semibold">Basic</th>
                    <th className="px-4 py-2 text-right font-semibold">Allow.</th>
                    <th className="px-4 py-2 text-right font-semibold">Net Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {selected.payslips.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 font-mono text-xs text-brand-navy">{p.empNo}</td>
                      <td className="px-4 py-2 text-ink">{p.employeeName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(p.basic)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(p.allowances)}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">{money(p.netPay)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-brand-paper font-semibold">
                    <td className="px-4 py-2" colSpan={4}>Total net pay</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink">
                      {money(selected.payslips.reduce((s, p) => s + p.netPay, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
