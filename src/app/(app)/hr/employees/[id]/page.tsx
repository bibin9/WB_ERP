import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Download, IdCard } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GuardedDelete from "@/components/GuardedDelete";
import DocumentUpload from "@/components/employee/DocumentUpload";
import { updateEmployeeProfile, deleteDocument } from "../actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";
const d = (v: Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

function Field({ label, name, def = "", type = "text" }: { label: string; name: string; def?: string; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <input name={name} type={type} defaultValue={def} className="input" />
    </div>
  );
}
function Select({ label, name, def, options }: { label: string; name: string; def?: string | null; options: string[] }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <select name={name} defaultValue={def ?? ""} className="input">
        <option value="">—</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}
function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-heading">{icon}{title}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{children}</div>
    </div>
  );
}

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAccess("hr.employees");
  const session = await getSession();
  if (!session) return null;
  const e = await db.employee.findUnique({
    where: { id },
    include: { company: true, documents: { orderBy: { createdAt: "desc" } }, customValues: true },
  });
  if (!e || !session.companies.some((c) => c.id === e.companyId)) notFound();

  const customDefs = await db.customFieldDef.findMany({ where: { tenantId: session.tenant.id, entity: "Employee" }, orderBy: { order: "asc" } });
  const valueMap = new Map(e.customValues.map((v) => [v.fieldDefId, v.value]));

  return (
    <div>
      <Link href="/hr" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to Employees</Link>
      <PageHeader title={`${e.name}`} subtitle={`${e.empNo} · ${e.designation ?? "—"} · ${e.company.code}`} />

      <form action={updateEmployeeProfile} className="space-y-5">
        <input type="hidden" name="id" value={e.id} />

        <Section title="Personal">
          <Field label="Full name" name="name" def={e.name} />
          <Field label="Date of birth" name="dateOfBirth" def={d(e.dateOfBirth)} type="date" />
          <Select label="Gender" name="gender" def={e.gender} options={["Male", "Female"]} />
          <Field label="Nationality" name="nationality" def={e.nationality ?? ""} />
          <Select label="Marital status" name="maritalStatus" def={e.maritalStatus} options={["Single", "Married"]} />
          <Field label="Blood group" name="bloodGroup" def={e.bloodGroup ?? ""} />
          <Field label="Personal email" name="personalEmail" def={e.personalEmail ?? ""} type="email" />
        </Section>

        <Section title="Contact">
          <Field label="Work email" name="email" def={e.email ?? ""} type="email" />
          <Field label="Phone" name="phone" def={e.phone ?? ""} />
          <Field label="Address" name="address" def={e.address ?? ""} />
          <Field label="Emergency contact name" name="emergencyName" def={e.emergencyName ?? ""} />
          <Field label="Emergency contact phone" name="emergencyPhone" def={e.emergencyPhone ?? ""} />
        </Section>

        <Section title="Employment">
          <Field label="Department" name="department" def={e.department ?? ""} />
          <Field label="Designation" name="designation" def={e.designation ?? ""} />
          <Field label="Grade" name="grade" def={e.grade ?? ""} />
          <Select label="Employment type" name="employmentType" def={e.employmentType} options={["Full-time", "Part-time", "Contract", "Supplied"]} />
          <Field label="Join date" name="joinDate" def={d(e.joinDate)} type="date" />
          <Select label="Contract type" name="contractType" def={e.contractType} options={["Limited", "Unlimited"]} />
          <Field label="Contract end date" name="contractEndDate" def={d(e.contractEndDate)} type="date" />
          <Field label="Manpower supplier" name="supplier" def={e.supplier ?? ""} />
          <Field label="Basic salary (AED)" name="basicSalary" def={String(e.basicSalary)} type="number" />
          <Field label="Allowances (AED)" name="allowances" def={String(e.allowances)} type="number" />
        </Section>

        <Section title="UAE Documents" icon={<IdCard className="h-4 w-4" />}>
          <Field label="Emirates ID No." name="emiratesIdNo" def={e.emiratesIdNo ?? ""} />
          <Field label="Emirates ID expiry" name="emiratesIdExpiry" def={d(e.emiratesIdExpiry)} type="date" />
          <div className="hidden md:block" />
          <Field label="Passport No." name="passportNo" def={e.passportNo ?? ""} />
          <Field label="Passport expiry" name="passportExpiry" def={d(e.passportExpiry)} type="date" />
          <div className="hidden md:block" />
          <Field label="Visa No." name="visaNo" def={e.visaNo ?? ""} />
          <Select label="Visa type" name="visaType" def={e.visaType} options={["Employment", "Mission", "Local", "Family"]} />
          <Field label="Visa expiry" name="visaExpiry" def={d(e.visaExpiry)} type="date" />
          <Field label="Labour Card No." name="labourCardNo" def={e.labourCardNo ?? ""} />
          <Field label="Labour Card expiry" name="labourCardExpiry" def={d(e.labourCardExpiry)} type="date" />
        </Section>

        <Section title="Banking (WPS)">
          <Field label="Bank name" name="bankName" def={e.bankName ?? ""} />
          <Field label="IBAN" name="iban" def={e.iban ?? ""} />
          <Field label="Bank routing code (WPS agent ID)" name="bankRoutingCode" def={e.bankRoutingCode ?? ""} />
        </Section>

        {customDefs.length > 0 && (
          <Section title="Custom Fields">
            {customDefs.map((f) => (
              f.type === "select" ? (
                <Select key={f.id} label={f.label} name={`cf_${f.id}`} def={valueMap.get(f.id) ?? ""} options={(f.options ?? "").split(",").map((o) => o.trim()).filter(Boolean)} />
              ) : (
                <Field key={f.id} label={f.label} name={`cf_${f.id}`} def={valueMap.get(f.id) ?? ""} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} />
              )
            ))}
          </Section>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary">Save profile</button>
        </div>
      </form>

      {/* Documents */}
      <div className="mt-6">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-heading"><FileText className="h-4 w-4" /> Documents</h3>
        <div className="mb-3"><DocumentUpload employeeId={e.id} /></div>
        <div className="card divide-y divide-line">
          {e.documents.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No documents uploaded yet.</p>}
          {e.documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-5 py-3">
              <span className="rounded bg-brand-navy/5 px-2 py-0.5 text-xs font-medium text-heading">{doc.category}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{doc.fileName}</span>
              <span className="text-xs text-muted">{(doc.size / 1024).toFixed(0)} KB · by {doc.uploadedBy}</span>
              <a href={`/api/documents/${doc.id}`} target="_blank" className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-line hover:text-brand-blue-600" title="View / download">
                <Download className="h-4 w-4" />
              </a>
              <GuardedDelete screen="hr.employees" action={deleteDocument.bind(null, doc.id)} label={`Delete ${doc.fileName}?`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
