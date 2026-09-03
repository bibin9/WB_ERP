"use server";

import { revalidatePath } from "next/cache";
import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const STR_FIELDS = [
  "name", "email", "phone", "department", "designation", "grade", "employmentType", "supplier",
  "gender", "nationality", "maritalStatus", "bloodGroup", "personalEmail", "address", "emergencyName", "emergencyPhone",
  "contractType", "emiratesIdNo", "passportNo", "visaNo", "visaType", "labourCardNo", "bankName", "iban",
];
const DATE_FIELDS = ["dateOfBirth", "joinDate", "contractEndDate", "emiratesIdExpiry", "passportExpiry", "visaExpiry", "labourCardExpiry"];

async function scoped(employeeId: string) {
  const session = await getSession();
  if (!session) return null;
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return null;
  return { session, emp };
}

export async function updateEmployeeProfile(formData: FormData) {
  const id = String(formData.get("id") || "");
  const s = await scoped(id);
  if (!s) return;
  const data: Record<string, unknown> = {};
  for (const f of STR_FIELDS) { const v = String(formData.get(f) ?? "").trim(); data[f] = v || null; }
  if (!data.name) return;
  for (const f of DATE_FIELDS) { const v = String(formData.get(f) ?? ""); data[f] = v ? new Date(v) : null; }
  data.basicSalary = Number(formData.get("basicSalary")) || 0;
  data.allowances = Number(formData.get("allowances")) || 0;

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
  const employeeId = String(formData.get("employeeId") || "");
  const s = await scoped(employeeId);
  if (!s) return { ok: false, error: "Not authorised" };
  const file = formData.get("file") as File | null;
  const category = String(formData.get("category") || "Other");
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "File exceeds 10MB" };

  const ext = path.extname(file.name).slice(0, 10);
  const storedName = randomBytes(16).toString("hex") + ext;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), Buffer.from(await file.arrayBuffer()));

  await db.employeeDocument.create({
    data: { companyId: s.emp.companyId, employeeId, category, fileName: file.name, storedName, mimeType: file.type || "application/octet-stream", size: file.size, uploadedBy: s.session.user.name },
  });
  await audit({ action: "Created", entity: "EmployeeDocument", summary: `Uploaded ${category} for ${s.emp.empNo}` });
  revalidatePath(`/hr/employees/${employeeId}`);
  return { ok: true };
}

export async function deleteDocument(id: string) {
  const session = await getSession();
  if (!session) return;
  const doc = await db.employeeDocument.findUnique({ where: { id } });
  if (!doc || !session.companies.some((c) => c.id === doc.companyId)) return;
  await fs.rm(path.join(UPLOAD_DIR, doc.storedName), { force: true }).catch(() => {});
  await db.employeeDocument.delete({ where: { id } });
  revalidatePath(`/hr/employees/${doc.employeeId}`);
}
