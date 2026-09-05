"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";

const TYPES = ["Customer", "Supplier", "Both"];

/** UAE Tax Registration Numbers are 15 digits. */
function cleanTrn(raw: string): { trn: string | null; error?: string } {
  const t = raw.replace(/[\s-]/g, "");
  if (!t) return { trn: null };
  if (!/^\d{15}$/.test(t)) return { trn: null, error: "A TRN is 15 digits" };
  return { trn: t };
}

function read(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "Customer");
  const { trn, error } = cleanTrn(String(formData.get("trn") || ""));
  return {
    name,
    type: TYPES.includes(type) ? type : "Customer",
    trn,
    trnError: error,
    contactPerson: String(formData.get("contactPerson") || "").trim() || null,
    email: String(formData.get("email") || "").trim() || null,
    phone: String(formData.get("phone") || "").trim() || null,
    address: String(formData.get("address") || "").trim() || null,
    creditDays: Math.max(0, Math.min(365, Number(formData.get("creditDays")) || 0)),
  };
}

/** Next code in the C0001 / S0001 series, per company. */
async function nextCode(companyId: string, type: string): Promise<string> {
  const prefix = type === "Supplier" ? "S" : "C";
  const n = await db.party.count({ where: { companyId, code: { startsWith: prefix } } });
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}

export async function createParty(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.parties", "create"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const companyId = String(formData.get("companyId") || "");
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access to this company" };

  const d = read(formData);
  if (!d.name) return { ok: false, error: "Enter a name" };
  if (d.trnError) return { ok: false, error: d.trnError };

  // The whole point of a master is not having the same customer twice.
  const clash = await db.party.findFirst({
    where: { companyId, name: { equals: d.name } },
  });
  if (clash) return { ok: false, error: `"${clash.name}" already exists as ${clash.code}` };

  const party = await db.party.create({
    data: {
      companyId,
      code: await nextCode(companyId, d.type),
      name: d.name,
      type: d.type,
      trn: d.trn,
      contactPerson: d.contactPerson,
      email: d.email,
      phone: d.phone,
      address: d.address,
      creditDays: d.creditDays,
    },
  });
  await audit({ action: "Created", entity: "Party", entityId: party.id, summary: `Added ${d.type.toLowerCase()} ${party.code} — ${d.name}` });
  revalidatePath("/finance/parties");
  return { ok: true };
}

export async function updateParty(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.parties", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const id = String(formData.get("id") || "");
  const existing = await db.party.findUnique({ where: { id } });
  if (!existing || !session.companies.some((c) => c.id === existing.companyId)) return { ok: false, error: "Not found" };

  const d = read(formData);
  if (!d.name) return { ok: false, error: "Enter a name" };
  if (d.trnError) return { ok: false, error: d.trnError };

  const clash = await db.party.findFirst({
    where: { companyId: existing.companyId, name: { equals: d.name }, id: { not: id } },
  });
  if (clash) return { ok: false, error: `"${clash.name}" already exists as ${clash.code}` };

  await db.party.update({
    where: { id },
    data: {
      name: d.name, type: d.type, trn: d.trn, contactPerson: d.contactPerson,
      email: d.email, phone: d.phone, address: d.address, creditDays: d.creditDays,
    },
  });
  await audit({ action: "Updated", entity: "Party", entityId: id, summary: `Updated ${existing.code} — ${d.name}` });
  revalidatePath("/finance/parties");
  return { ok: true };
}

export async function setPartyActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.parties", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const party = await db.party.findUnique({ where: { id } });
  if (!party || !session.companies.some((c) => c.id === party.companyId)) return { ok: false, error: "Not found" };
  await db.party.update({ where: { id }, data: { isActive } });
  await audit({ action: "Updated", entity: "Party", entityId: id, summary: `${isActive ? "Reactivated" : "Deactivated"} ${party.code} — ${party.name}` });
  revalidatePath("/finance/parties");
  return { ok: true };
}

export async function deleteParty(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.parties", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const party = await db.party.findUnique({ where: { id }, include: { _count: { select: { entries: true } } } });
  if (!party || !session.companies.some((c) => c.id === party.companyId)) return { ok: false, error: "Not found" };

  // A party with history is part of the audit trail. Deactivate instead.
  if (party._count.entries > 0) {
    return { ok: false, error: `${party.name} has ${party._count.entries} voucher(s). Deactivate it instead of deleting.` };
  }
  await db.party.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Party", entityId: id, summary: `Deleted ${party.code} — ${party.name}` });
  revalidatePath("/finance/parties");
  return { ok: true };
}
