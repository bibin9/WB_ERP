"use server";

import { revalidatePath } from "next/cache";
import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";
import { redirect } from "next/navigation";
import { EMPLOYEE_VALIDATORS } from "@/lib/uae";
import { normalisePhone } from "@/lib/search";
import { identify, MAX_UPLOAD_BYTES } from "@/lib/uploads";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const STR_FIELDS = [
  "name", "email", "phone", "department", "designation", "grade", "employmentType", "supplier",
  "gender", "nationality", "maritalStatus", "bloodGroup", "personalEmail", "address", "emergencyName", "emergencyPhone",
  "contractType", "emiratesIdNo", "passportNo", "visaNo", "visaType", "labourCardNo", "bankName", "iban", "bankRoutingCode",
];
const DATE_FIELDS = ["dateOfBirth", "joinDate", "lastWorkingDay", "probationEndDate", "contractEndDate", "iloeExpiry", "emiratesIdExpiry", "passportExpiry", "visaExpiry", "labourCardExpiry"];

async function scoped(employeeId: string) {
  const session = await getSession();
  if (!session) return null;
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return null;
  return { session, emp };
}

export async function updateEmployeeProfile(formData: FormData) {
  if (!(await allow("hr.employees", "edit"))) return;
  const id = String(formData.get("id") || "");
  const s = await scoped(id);
  if (!s) return;
  const data: Record<string, unknown> = {};
  for (const f of STR_FIELDS) {
    const v = String(formData.get(f) ?? "").trim();
    // Phone numbers are stored without separators, or nobody can search for one.
    data[f] = v ? (f === "phone" || f === "emergencyPhone" ? normalisePhone(v) : v) : null;
  }
  if (!data.name) return;

  // The identifiers that something downstream will reject. A malformed IBAN is
  // not discovered until the bank refuses the whole WPS file days later, naming
  // no row, so it has to be caught while the person is still looking at the box.
  // Blank stays allowed — a profile is filled in over time — and completeness is
  // enforced at WPS generation instead.
  for (const [field, clean] of Object.entries(EMPLOYEE_VALIDATORS)) {
    const typed = String(formData.get(field) ?? "").trim();
    if (!typed) continue;
    const { value, error } = clean(typed);
    if (error) redirect(`/hr/employees/${id}?err=${encodeURIComponent(error)}`);
    data[field] = value;
  }
  // One person, one record. Production had two "Rajesh Kumar" rows before this
  // check existed, and a duplicate is not a cosmetic problem: both records go
  // into the payroll run, both go into the WPS file, and the same man is paid
  // twice. An Emirates ID and a passport number each identify exactly one
  // human, so they are the right things to test.
  for (const [field, label] of [["emiratesIdNo", "Emirates ID"], ["passportNo", "passport number"]] as const) {
    const value = data[field] as string | null;
    if (!value) continue;
    const clash = await db.employee.findFirst({
      where: { companyId: s.emp.companyId, [field]: value, NOT: { id } },
      select: { name: true, empNo: true },
    });
    if (clash) {
      redirect(
        `/hr/employees/${id}?err=` +
          encodeURIComponent(
            `That ${label} is already on ${clash.name} (${clash.empNo}). Two records for one person get paid twice.`
          )
      );
    }
  }

  for (const f of DATE_FIELDS) { const v = String(formData.get(f) ?? ""); data[f] = v ? new Date(v) : null; }
  data.basicSalary = toFils(Number(formData.get("basicSalary")) || 0);
  data.allowances = toFils(Number(formData.get("allowances")) || 0);
  data.airTicketAllowance = toFils(Number(formData.get("airTicketAllowance")) || 0);

  // Between thirty and ninety days by law; blank means the contract is silent
  // and the statutory thirty applies.
  const notice = Number(formData.get("noticePeriodDays"));
  data.noticePeriodDays = Number.isFinite(notice) && notice > 0 ? Math.min(90, Math.max(30, Math.round(notice))) : null;
  data.probationCleared = String(formData.get("probationCleared") || "") === "on";
  data.skilledRole = String(formData.get("skilledRole") || "") === "on";
  data.iloeSubscribed = String(formData.get("iloeSubscribed") || "") === "on";
  data.iloeExempt = String(formData.get("iloeExempt") || "") === "on";

  await db.employee.update({ where: { id }, data });
  await audit({ action: "Updated", entity: "Employee", entityId: id, summary: `Updated profile of ${s.emp.empNo}` });

  // Custom field values
  const defs = await db.customFieldDef.findMany({ where: { tenantId: s.session.tenant.id, entity: "Employee" } });
  for (const d of defs) {
    const val = String(formData.get(`cf_${d.id}`) ?? "").trim();
    if (val) {
      await db.customFieldValue.upsert({
        where: { employeeId_fieldDefId: { employeeId: id, fieldDefId: d.id } },
        update: { value: val }, create: { employeeId: id, fieldDefId: d.id, value: val },
      });
    } else {
      await db.customFieldValue.deleteMany({ where: { employeeId: id, fieldDefId: d.id } });
    }
  }
  revalidatePath(`/hr/employees/${id}`);
  revalidatePath("/hr");
}

export async function uploadDocument(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.employees", "create"))) return { ok: false, error: "Not authorised" };
  const employeeId = String(formData.get("employeeId") || "");
  const s = await scoped(employeeId);
  if (!s) return { ok: false, error: "Not authorised" };
  const file = formData.get("file") as File | null;
  const category = String(formData.get("category") || "Other");
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "File exceeds 10MB" };

  // What the file IS, not what it says it is. The declared type and the
  // extension are both written by whoever uploaded it; the first bytes are not.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = identify(file.name, bytes);
  if (!kind.ok) return { ok: false, error: kind.error };

  // The name on disk is random, so nothing an uploader writes reaches the
  // filesystem — no traversal, no collision, no shell surprises. The extension
  // comes from what was detected rather than from the name.
  const storedName = randomBytes(16).toString("hex") + kind.type.extensions[0];
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), Buffer.from(bytes));

  await db.employeeDocument.create({
    data: {
      companyId: s.emp.companyId,
      employeeId,
      category,
      fileName: file.name,
      storedName,
      // The detected type, so the download route can never be talked into
      // serving something as text/html.
      mimeType: kind.type.mime,
      size: file.size,
      uploadedBy: s.session.user.name,
    },
  });
  await audit({ action: "Created", entity: "EmployeeDocument", summary: `Uploaded ${category} for ${s.emp.empNo}` });
  revalidatePath(`/hr/employees/${employeeId}`);
  return { ok: true };
}

export async function deleteDocument(id: string) {
  if (!(await allow("hr.employees", "delete"))) return;
  const session = await getSession();
  if (!session) return;
  const doc = await db.employeeDocument.findUnique({ where: { id } });
  if (!doc || !session.companies.some((c) => c.id === doc.companyId)) return;
  await fs.rm(path.join(UPLOAD_DIR, doc.storedName), { force: true }).catch(() => {});
  await db.employeeDocument.delete({ where: { id } });
  revalidatePath(`/hr/employees/${doc.employeeId}`);
}

import { toFils } from "@/lib/money";