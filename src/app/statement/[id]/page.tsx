import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import PrintButton from "@/components/hr/PrintButton";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { activeTenant } from "@/config/tenant";

export const dynamic = "force-dynamic";
const aed = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "—");

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAccess("hr.separation");
  const session = await getSession();
  if (!session) return null;

  const sep = await db.separation.findFirst({
    where: { id, companyId: { in: session.companies.map((c) => c.id) } },
    include: { employee: true },
  });
  if (!sep) notFound();
  const company = await db.company.findUnique({ where: { id: sep.companyId } });

  const lines: { label: string; sub?: string; amount: number; deduct?: boolean }[] = [
    { label: "End-of-service gratuity", sub: sep.gratuityDays > 0 ? `${sep.gratuityDays} days of basic pay` : "Not eligible / forfeited", amount: sep.gratuityAmount },
    { label: "Unused leave encashment", sub: `${sep.leaveDays} days`, amount: sep.leaveAmount },
    ...(sep.pendingSalary ? [{ label: "Pending salary", amount: sep.pendingSalary }] : []),
    ...(sep.noticePay ? [{ label: "Notice pay (in lieu)", amount: sep.noticePay }] : []),
    ...(sep.airTicket ? [{ label: "Repatriation air ticket", amount: sep.airTicket }] : []),
    ...(sep.otherAdditions ? [{ label: "Other additions", amount: sep.otherAdditions }] : []),
  ];
  const gross = sep.gratuityAmount + sep.leaveAmount + sep.pendingSalary + sep.noticePay + sep.airTicket + sep.otherAdditions;

  return (
    <div className="min-h-screen bg-gray-100 py-8 text-gray-900 print:bg-white print:py-0">
      {/* Toolbar (screen only) */}
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href="/hr/separation" className="inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Separation
        </Link>
        <PrintButton />
      </div>

      {/* A4 sheet */}
      <div className="mx-auto max-w-3xl bg-white p-10 shadow-panel print:max-w-none print:p-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-gray-800 pb-4">
          <div>
            <div className="text-xl font-bold text-gray-900">{company?.name ?? activeTenant.productName}</div>
            <div className="text-sm text-gray-500">{activeTenant.productName}{company?.code ? ` · ${company.code}` : ""}</div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>Statement date</div>
            <div className="font-medium text-gray-800">{fmt(new Date())}</div>
          </div>
        </div>

        <h1 className="mt-6 text-center text-lg font-bold uppercase tracking-wide text-gray-900">Full &amp; Final Settlement Statement</h1>
        <p className="mt-1 text-center text-xs text-gray-500">End of service — {sep.type}</p>

        {/* Employee details */}
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Detail k="Employee" v={sep.employee.name} />
          <Detail k="Employee No." v={sep.employee.empNo} />
          <Detail k="Designation" v={sep.employee.designation ?? "—"} />
          <Detail k="Department" v={sep.employee.department ?? "—"} />
          <Detail k="Date of joining" v={fmt(sep.employee.joinDate)} />
          <Detail k="Last working day" v={fmt(sep.lastWorkingDay)} />
          <Detail k="Length of service" v={sep.serviceText} />
          <Detail k="Basic salary" v={`AED ${aed(sep.basicSalary)}`} />
        </div>

        {/* Settlement table */}
        <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-gray-300 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-2 text-gray-800">{l.label}{l.sub && <span className="ml-2 text-xs text-gray-400">{l.sub}</span>}</td>
                <td className="py-2 text-right tabular-nums text-gray-900">{aed(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-b border-gray-300 font-semibold">
              <td className="py-2 text-gray-900">Gross entitlements</td>
              <td className="py-2 text-right tabular-nums text-gray-900">{aed(gross)}</td>
            </tr>
            {sep.deductions > 0 && (
              <tr className="border-b border-gray-100">
                <td className="py-2 text-gray-800">Less: deductions</td>
                <td className="py-2 text-right tabular-nums text-red-600">− {aed(sep.deductions)}</td>
              </tr>
            )}
            {sep.adjustment !== 0 && (
              <tr className="border-b border-gray-100">
                <td className="py-2 text-gray-800">Adjustment{sep.adjustmentNote ? <span className="ml-2 text-xs text-gray-400">{sep.adjustmentNote}</span> : ""}</td>
                <td className="py-2 text-right tabular-nums text-gray-900">{sep.adjustment < 0 ? "− " : ""}{aed(Math.abs(sep.adjustment))}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800">
              <td className="py-3 text-base font-bold text-gray-900">Net settlement payable</td>
              <td className="py-3 text-right text-base font-bold tabular-nums text-gray-900">AED {aed(sep.netSettlement)}</td>
            </tr>
          </tfoot>
        </table>
        </div>

        {/* Basis */}
        <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
          End-of-service gratuity is calculated under the UAE Labour Law (Federal Decree-Law No. 33 of 2021): 21 days&apos; basic pay
          for each of the first five years of service and 30 days&apos; basic pay for each subsequent year, subject to a minimum of one
          year of continuous service and a maximum of two years&apos; basic pay. Leave encashment is based on unused annual leave at the
          basic daily wage.
        </p>

        {/* Declaration */}
        <p className="mt-6 text-sm text-gray-800">
          I, <span className="font-medium">{sep.employee.name}</span>, acknowledge that the above represents the full and final
          settlement of all my dues from {company?.name ?? activeTenant.productName}, and I have no further claims whatsoever against
          the company in respect of my employment or its termination.
        </p>

        {/* Signatures */}
        <div className="mt-12 grid grid-cols-2 gap-10 text-sm">
          <div>
            <div className="h-12 border-b border-gray-400" />
            <div className="mt-1 font-medium text-gray-800">Employee signature</div>
            <div className="text-xs text-gray-500">{sep.employee.name} · Date: ____________</div>
          </div>
          <div>
            <div className="h-12 border-b border-gray-400" />
            <div className="mt-1 font-medium text-gray-800">For the Company</div>
            <div className="text-xs text-gray-500">Name / Designation · Date: ____________</div>
          </div>
        </div>

        <div className="mt-10 border-t border-gray-200 pt-3 text-[10px] text-gray-400">
          Prepared by {sep.processedBy ?? "—"} · Generated by {activeTenant.appName} · This is a system-generated statement.
        </div>
      </div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-gray-100 py-1">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium text-gray-900">{v}</span>
    </div>
  );
}
