import { UserMinus } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import ConfirmDelete from "@/components/ConfirmDelete";
import SeparationForm from "@/components/hr/SeparationForm";
import SeparationStatus from "@/components/hr/SeparationStatus";
import { deleteSeparation } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";
const aed = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function SeparationPage() {
  await requireAccess("hr.separation");
  const session = await getSession();
  const companyIds = session?.companies.map((c) => c.id) ?? [];

  const employees = await db.employee.findMany({
    where: { companyId: { in: companyIds }, status: { not: "Inactive" } },
    orderBy: { name: "asc" },
    select: { id: true, empNo: true, name: true, basicSalary: true, allowances: true, joinDate: true, annualLeaveBalance: true },
  });

  const separations = await db.separation.findMany({
    where: { companyId: { in: companyIds } },
    include: { employee: { select: { name: true, empNo: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div>
      <PageHeader title="HR — Separation & Settlement" subtitle="Resignation or termination with an automatic UAE end-of-service settlement (gratuity, leave, adjustments)." />
      <HrTabs />

      <div className="mb-6">
        <SeparationForm employees={employees.map((e) => ({ ...e, joinDate: e.joinDate ? e.joinDate.toISOString() : null }))} />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Settlement records</h2>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Last day</th>
                <th className="px-4 py-3 font-semibold">Service</th>
                <th className="px-4 py-3 text-right font-semibold">Gratuity</th>
                <th className="px-4 py-3 text-right font-semibold">Leave</th>
                <th className="px-4 py-3 text-right font-semibold">Net (AED)</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {separations.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">No separations recorded yet.</td></tr>
              )}
              {separations.map((s) => (
                <tr key={s.id} className="hover:bg-brand-paper/60">
                  <td className="px-4 py-3"><span className="font-medium text-ink">{s.employee.name}</span> <span className="font-mono text-xs text-muted">{s.employee.empNo}</span></td>
                  <td className="px-4 py-3 text-ink">{s.type}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{fmt(s.lastWorkingDay)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{s.serviceText}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{aed(s.gratuityAmount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{aed(s.leaveAmount)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-green-700">{aed(s.netSettlement)}</td>
                  <td className="px-4 py-3"><SeparationStatus id={s.id} status={s.status} /></td>
                  <td className="px-4 py-3 text-right"><ConfirmDelete action={deleteSeparation.bind(null, s.id)} label={`Delete settlement for ${s.employee.name}? This reactivates the employee.`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <UserMinus className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">How the gratuity is calculated (UAE Labour Law, Decree-Law 33/2021):</span> based on
          basic salary — 21 days&apos; pay per year for the first 5 years, 30 days per year beyond 5, minimum 1 year of service, capped at
          2 years&apos; basic pay. Resignation and termination earn the same gratuity; gross-misconduct dismissal can forfeit it. Leave
          encashment is unused annual-leave days × daily basic. HR can adjust any figure before marking the settlement Settled.
        </p>
      </div>
    </div>
  );
}
