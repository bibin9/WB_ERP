"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { looksLikeEmail } from "@/lib/mailsettings";

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

/**
 * Next code in the C0001 / S0001 series, per company.
 *
 * Taken from the highest already issued rather than from a count. Counting
 * assumes the series is dense: delete one party and count + 1 lands on a code
 * somebody already has, and the create then fails on the unique index with a
 * message nobody can read. The same assumption stopped a company posting
 * vouchers for a financial year before it was found, so it is not repeated.
 */
async function nextCode(companyId: string, type: string): Promise<string> {
  const prefix = type === "Supplier" ? "S" : "C";
  const rows = await db.party.findMany({
    where: { companyId, code: { startsWith: prefix } },
    select: { code: true },
  });
  const highest = rows.reduce((top, r) => {
    const n = Number(r.code.slice(prefix.length));
    return Number.isFinite(n) && n > top ? n : top;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/* ============================== the people at a customer, as master data = */

const CONTACT_MAX = 200;
const text = (fd: FormData, k: string, max = CONTACT_MAX) => String(fd.get(k) ?? "").trim().slice(0, max);

/**
 * Save one contact against a party.
 *
 * These are what a quotation picks its recipients from, which is the whole
 * point: an address chosen from a list is right, and one typed from memory
 * loses a letter and nobody notices for a week.
 */
export async function savePartyContact(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.parties", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const id = text(formData, "id");
  const partyId = id
    ? (await db.partyContact.findUnique({ where: { id }, select: { partyId: true } }))?.partyId ?? ""
    : text(formData, "partyId");

  const party = partyId ? await db.party.findUnique({ where: { id: partyId } }) : null;
  if (!party) return { ok: false, error: "That customer no longer exists." };
  if (!session.companies.some((c) => c.id === party.companyId)) {
    return { ok: false, error: "No access to this company" };
  }

  const name = text(formData, "name");
  if (!name) return { ok: false, error: "Give the contact a name." };

  const email = text(formData, "email");
  if (email && !looksLikeEmail(email)) {
    return { ok: false, error: `${email} does not look like an email address.` };
  }

  const isPrimary = text(formData, "isPrimary") === "on";
  const data = {
    name,
    role: text(formData, "role", 80) || null,
    email: email || null,
    phone: text(formData, "phone", 40) || null,
    notes: text(formData, "notes", 300) || null,
    isPrimary,
    isActive: text(formData, "isActive") !== "off",
  };

  // Only one main contact, or a quotation form would have to guess which of
  // two it meant.
  if (isPrimary) {
    await db.partyContact.updateMany({
      where: { partyId, ...(id ? { NOT: { id } } : {}) },
      data: { isPrimary: false },
    });
  }

  if (id) {
    await db.partyContact.update({ where: { id }, data });
  } else {
    await db.partyContact.create({ data: { partyId, ...data } });
  }

  await audit({
    action: id ? "Updated" : "Created",
    entity: "PartyContact",
    entityId: id || partyId,
    summary: `${id ? "Updated" : "Added"} contact ${name} at ${party.name}`,
  });
  revalidatePath("/finance/parties");
  return { ok: true };
}

export async function deletePartyContact(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.parties", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  const contact = await db.partyContact.findUnique({ where: { id }, include: { party: true } });
  if (!contact) return { ok: false, error: "Not found" };
  if (!session?.companies.some((c) => c.id === contact.party.companyId)) {
    return { ok: false, error: "No access to this company" };
  }

  await db.partyContact.delete({ where: { id } });
  await audit({
    action: "Deleted", entity: "PartyContact", entityId: id,
    summary: `Removed contact ${contact.name} from ${contact.party.name}`,
  });
  revalidatePath("/finance/parties");
  return { ok: true };
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
