"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { MASTER_TYPES } from "@/lib/master";

export async function addMasterItem(formData: FormData) {
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const type = String(formData.get("type") || "");
  const value = String(formData.get("value") || "").trim();
  if (!MASTER_TYPES.includes(type) || !value) return;
  const exists = await db.masterItem.findUnique({ where: { tenantId_type_value: { tenantId: session.tenant.id, type, value } } });
  if (exists) return;
  const count = await db.masterItem.count({ where: { tenantId: session.tenant.id, type } });
  await db.masterItem.create({ data: { tenantId: session.tenant.id, type, value, order: count + 1 } });
  revalidatePath("/settings/master-data");
}

export async function deleteMasterItem(id: string) {
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const item = await db.masterItem.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!item) return;
  await db.masterItem.delete({ where: { id } });
  revalidatePath("/settings/master-data");
}
