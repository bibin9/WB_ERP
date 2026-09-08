import Link from "next/link";
import { Users } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import EmployeeForm from "@/components/EmployeeForm";
import EmployeeStatus from "@/components/EmployeeStatus";
import GuardedDelete from "@/components/GuardedDelete";
import { deleteEmployee } from "@/app/(app)/hr/employee-actions";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/guard";
import { activeTenant } from "@/config/tenant";
import ExportButton from "@/components/ExportButton";
import { money } from "@/lib/money";
import Pager from "@/components/Pager";
import { readPaging, pageInfo } from "@/lib/paging";
import SearchBox from "@/components/SearchBox";
import { readSearch, matchAny, like, looksLikePhone, normalisePhone } from "@/lib/search";

export const dynamic = "force-dynamic";

const statusColor: Record<string, string> = {
  Active: "bg-brand-green/10 text-brand-green-700",
  "On Leave": "bg-brand-gold/15 text-brand-gold",
  Inactive: "bg-line text-muted",
};

const typeColor: Record<string, string> = {
  "Full-time": "text-ink",
  Contract: "text-brand-blue-600",
  Supplied: "text-brand-gold",
  "Part-time": "text-muted",
};



export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; per?: string; q?: string }>;
}) {
  const session = await requireAccess("hr.employees");
  const sp = await searchParams;
  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  // Only the companies this user is a member of — never the whole tenant.
  const scope = session.companies.map((c) => c.id);
  const companies = tenant
    ? await db.company.findMany({ where: { tenantId: tenant.id, id: { in: scope } }, orderBy: { code: "asc" } })
    : [];
  // An employee list is one of the few here that reaches four figures, so it
  // is searched and paged rather than rendered whole. The fields are the ones
  // somebody actually has to hand: a name, a mobile number, or the number on a
  // document they are holding.
  const term = readSearch(sp);
  // A number is matched with its separators stripped as well as as typed, so
  // "0504128837" finds someone stored as "050 412 8837" and the other way round.
  const digits = looksLikePhone(term) ? normalisePhone(term) : "";
  const textMatch = matchAny(term, [
    "name", "empNo", "email", "phone", "department", "designation",
    "emiratesIdNo", "passportNo", "visaNo", "labourCardNo",
  ]);
  const empWhere = {
    companyId: { in: companies.map((c) => c.id) },
    ...(term
      ? {
          OR: [
            ...(textMatch ? textMatch.OR : []),
            ...(digits ? [{ phone: like(digits) }] : []),
          ],
        }
      : {}),
  };
  const paging = readPaging(sp);
  const empTotal = await db.employee.count({ where: empWhere });
  const info = pageInfo(paging, empTotal);
  const employees = await db.employee.findMany({
    where: empWhere,
    include: { company: true },
    orderBy: { empNo: "asc" },
    skip: (info.page - 1) * info.perPage,
    take: info.perPage,
  });
  const mi = tenant ? await db.masterItem.findMany({ where: { tenantId: tenant.id, isActive: true }, orderBy: { order: "asc" } }) : [];
  const master = {
    Department: mi.filter((m) => m.type === "Department").map((m) => m.value),
    Designation: mi.filter((m) => m.type === "Designation").map((m) => m.value),
    Grade: mi.filter((m) => m.type === "Grade").map((m) => m.value),
  };

  const active = employees.filter((e) => e.status === "Active").length;
  const totalPayroll = employees.reduce((s, e) => s + e.basicSalary + e.allowances, 0);

  return (
    <div>
      <PageHeader
        title="HR & Admin"
        subtitle="Everyone on the books, their contract and their pay. Attendance, leave, payroll and end-of-service all read from these records."
      >
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton dataset="employees" companyId="*" label="Export employees" />
          <EmployeeForm companies={companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))} master={master} />
        </div>
      </PageHeader>
      <HrTabs />

      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="stat-card">
          <div className="text-2xl font-bold text-ink">{employees.length}</div>
          <div className="text-sm text-muted">Employees</div>
        </div>
        <div className="stat-card">
          <div className="text-2xl font-bold text-brand-green-700">{active}</div>
          <div className="text-sm text-muted">Active</div>
        </div>
        <div className="stat-card">
          <div className="text-2xl font-bold text-ink">AED {money(totalPayroll)}</div>
          <div className="text-sm text-muted">Monthly payroll (gross)</div>
        </div>
      </div>

      <div className="mb-4">
        <SearchBox
          placeholder="Search employees…"
          hint="Name, employee number, mobile, email, department, or a number from their Emirates ID, passport, visa or labour card."
        />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Emp No</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Department</th>
                <th className="px-4 py-3 font-semibold">Designation</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Gross (AED)</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {employees.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted">No employees yet. Click “Add employee”.</td></tr>
              )}
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-heading">{e.empNo}</td>
                  <td className="px-4 py-3">
                    <Link href={`/hr/employees/${e.id}`} className="font-medium text-ink hover:text-brand-blue-600">{e.name}</Link>
                    {e.email && <div className="text-xs text-muted">{e.email}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-brand-navy/5 px-2 py-0.5 text-xs font-medium text-heading">{e.company.code}</span>
                  </td>
                  <td className="px-4 py-3 text-ink">{e.department ?? "—"}</td>
                  <td className="px-4 py-3 text-ink">{e.designation ?? "—"}</td>
                  <td className={clsx("px-4 py-3 text-xs font-medium", typeColor[e.employmentType] ?? "text-muted")}>{e.employmentType}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{money(e.basicSalary + e.allowances)}</td>
                  <td className="px-4 py-3"><EmployeeStatus id={e.id} status={e.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <EmployeeForm
                        companies={companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))} master={master}
                        employee={{
                          id: e.id, name: e.name, email: e.email, phone: e.phone,
                          department: e.department, designation: e.designation, grade: e.grade,
                          employmentType: e.employmentType, supplier: e.supplier, basicSalary: e.basicSalary, allowances: e.allowances,
                        }}
                      />
                      <GuardedDelete
                        screen="hr.employees"
                        action={deleteEmployee.bind(null, e.id)}
                        label={`Delete employee ${e.empNo} — ${e.name}?`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager info={info} label="employees" />
        </div>
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">This screen is the source of everything else.</span> A
          payroll run needs a join date, a basic salary, an IBAN, a labour-card number and a bank routing
          code &mdash; a record missing any of them is held back rather than paid wrong. When somebody
          leaves, set their last working day here and the final month is worked out for the days served.
        </p>
      </div>
    </div>
  );
}
