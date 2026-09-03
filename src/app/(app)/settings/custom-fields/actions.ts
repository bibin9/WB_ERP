"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";

export async function createCustomField(formData: FormData) {
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const label = String(formData.get("label") || "").trim();
  const type = String(formData.get("type") || "text");
  const options = String(formData.get("options") || "").trim();
  if (!label) return;
  const fieldKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `f_${Date.now()}`;
  const exists = await db.customFieldDef.findUnique({ where: { tenantId_entity_fieldKey: { tenantId: session.tenant.id, entity: "Employee", fieldKey } } });
  if (exists) return;
  const count = await db.customFieldDef.count({ where: { tenantId: session.tenant.id, entity: "Employee" } });
  await db.customFieldDef.create({
    data: { tenantId: session.tenant.id, entity: "Employee", label, fieldKey, type, options: type === "select" ? options || null : null, order: count + 1 },
  });
  revalidatePath("/settings/custom-fields");
}

export async function deleteCustomField(id: string) {
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const def = await db.customFieldDef.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!def) return;
  await db.customFieldDef.delete({ where: { id } });
  revalidatePath("/settings/custom-fields");
}
