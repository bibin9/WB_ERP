"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { money } from "@/lib/money";
import { recordMovement, transferStock } from "@/lib/stock-posting";

/**
 * The stores screens.
 *
 * Wrappers: they check the caller is allowed, read the form, and hand the work
 * to lib/stock-posting, where the accounting lives and can be tested against a
 * real database. A server action needs a request behind it, so anything written
 * here could only ever be checked by reading it as text.
 */

type Result = { ok: boolean; error?: string };

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  if (!session.companies.some((c) => c.id === companyId)) return null;
  return session;
}

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const orNull = (fd: FormData, k: string, max = 200) => str(fd, k, max) || null;
const num = (fd: FormData, k: string) => Number(fd.get(k)) || 0;

/* ============================================================== items ==== */

export async function saveItem(formData: FormData): Promise<Result> {
  const id = str(formData, "id");
  const editing = !!id;
  if (!(await allow("inventory.items", editing ? "edit" : "create"))) return { ok: false, error: "Not authorised" };

  const companyId = editing
    ? (await db.item.findUnique({ where: { id } }))?.companyId ?? ""
    : str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const code = str(formData, "code", 40).toUpperCase();
  const name = str(formData, "name", 160);
  if (!code) return { ok: false, error: "Enter a code — a short one people will type, like CBL-4C-16." };
  if (!name) return { ok: false, error: "Enter what it is." };

  const clash = await db.item.findFirst({ where: { companyId, code, ...(editing ? { NOT: { id } } : {}) } });
  if (clash) return { ok: false, error: `${code} is already used by ${clash.name}.` };

  const reorder = num(formData, "reorderLevel");
  const data = {
    code,
    name,
    description: orNull(formData, "description", 500),
    category: orNull(formData, "category", 80),
    unitCode: str(formData, "unitCode", 8) || "EA",
    isStocked: str(formData, "isStocked") === "on",
    reorderLevel: reorder > 0 ? reorder : 0,
    standardCost: Math.max(0, num(formData, "standardCost")),
    isActive: str(formData, "isActive") !== "off",
  };

  if (editing) {
    // Turning stock tracking off on something that has movements would orphan
    // them: the shelf would still hold a balance nothing could ever move.
    if (!data.isStocked) {
      const moved = await db.stockMovement.count({ where: { itemId: id } });
      if (moved > 0) {
        return {
          ok: false,
          error: `${name} already has ${moved} stock movement${moved === 1 ? "" : "s"}, so it cannot be changed to a non-stocked item. Issue what is left first.`,
        };
      }
    }
    await db.item.update({ where: { id }, data });
    await audit({ action: "Updated", entity: "Item", entityId: id, summary: `Updated item ${code} — ${name}` });
  } else {
    const created = await db.item.create({ data: { companyId, ...data } });
    await audit({ action: "Created", entity: "Item", entityId: created.id, summary: `Added item ${code} — ${name}` });
  }
  revalidatePath("/inventory");
  revalidatePath("/inventory/stock");
  return { ok: true };
}

export async function deleteItem(id: string): Promise<Result> {
  if (!(await allow("inventory.items", "delete"))) return { ok: false, error: "Not authorised" };
  const item = await db.item.findUnique({ where: { id } });
  if (!item) return { ok: false, error: "Not found" };
  if (!(await scoped(item.companyId))) return { ok: false, error: "No access" };

  // An item with history is never deleted, the same rule every other register
  // in this system follows. Deactivating keeps the movements explainable.
  const moved = await db.stockMovement.count({ where: { itemId: id } });
  if (moved > 0) {
    return {
      ok: false,
      error: `${item.name} has ${moved} stock movement${moved === 1 ? "" : "s"} behind it. Deactivate it instead, so its history still makes sense.`,
    };
  }
  await db.item.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Item", entityId: id, summary: `Deleted item ${item.code} — ${item.name}` });
  revalidatePath("/inventory");
  return { ok: true };
}

/* ============================================================= stores ==== */

export async function saveStore(formData: FormData): Promise<Result> {
  const id = str(formData, "id");
  const editing = !!id;
  if (!(await allow("inventory.stores", editing ? "edit" : "create"))) return { ok: false, error: "Not authorised" };

  const companyId = editing
    ? (await db.store.findUnique({ where: { id } }))?.companyId ?? ""
    : str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const code = str(formData, "code", 40).toUpperCase();
  const name = str(formData, "name", 160);
  if (!code) return { ok: false, error: "Enter a short code for the store." };
  if (!name) return { ok: false, error: "Enter what it is called." };

  const clash = await db.store.findFirst({ where: { companyId, code, ...(editing ? { NOT: { id } } : {}) } });
  if (clash) return { ok: false, error: `${code} is already used by ${clash.name}.` };

  const isDefault = str(formData, "isDefault") === "on";
  const data = {
    code,
    name,
    location: orNull(formData, "location", 200),
    isDefault,
    isActive: str(formData, "isActive") !== "off",
  };

  // Only one default, or the forms would have to guess which one it meant.
  if (isDefault) {
    await db.store.updateMany({
      where: { companyId, ...(editing ? { NOT: { id } } : {}) },
      data: { isDefault: false },
    });
  }

  if (editing) {
    await db.store.update({ where: { id }, data });
    await audit({ action: "Updated", entity: "Store", entityId: id, summary: `Updated store ${code} — ${name}` });
  } else {
    const created = await db.store.create({ data: { companyId, ...data } });
    await audit({ action: "Created", entity: "Store", entityId: created.id, summary: `Added store ${code} — ${name}` });
  }
  revalidatePath("/inventory/stores");
  return { ok: true };
}

export async function deleteStore(id: string): Promise<Result> {
  if (!(await allow("inventory.stores", "delete"))) return { ok: false, error: "Not authorised" };
  const store = await db.store.findUnique({ where: { id } });
  if (!store) return { ok: false, error: "Not found" };
  if (!(await scoped(store.companyId))) return { ok: false, error: "No access" };

  const moved = await db.stockMovement.count({ where: { storeId: id } });
  if (moved > 0) {
    return {
      ok: false,
      error: `${store.name} has ${moved} stock movement${moved === 1 ? "" : "s"} behind it. Deactivate it instead.`,
    };
  }
  await db.store.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Store", entityId: id, summary: `Deleted store ${store.code} — ${store.name}` });
  revalidatePath("/inventory/stores");
  return { ok: true };
}

/* ========================================================== movements ==== */

export async function saveMovement(formData: FormData): Promise<Result> {
  if (!(await allow("inventory.movements", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const kind = str(formData, "kind", 40);

  // A transfer is written as a pair, because half of one is stock that has left
  // a shelf and arrived nowhere.
  if (kind === "Transfer") {
    const res = await transferStock({
      companyId,
      postedBy: session.user.name,
      itemId: str(formData, "itemId"),
      storeId: str(formData, "storeId"),
      toStoreId: str(formData, "toStoreId"),
      date: str(formData, "date", 10),
      quantity: num(formData, "quantity"),
      reference: str(formData, "reference", 120),
      notes: orNull(formData, "notes", 500),
    });
    if (!res.ok) return res;
    await audit({
      action: "Posted",
      entity: "StockMovement",
      entityId: res.out,
      summary: `Transferred stock on ${str(formData, "reference", 120)}`,
    });
    revalidatePath("/inventory/movements");
    revalidatePath("/inventory/stock");
    return { ok: true };
  }

  const res = await recordMovement({
    companyId,
    postedBy: session.user.name,
    kind,
    itemId: str(formData, "itemId"),
    storeId: str(formData, "storeId"),
    date: str(formData, "date", 10),
    quantity: num(formData, "quantity"),
    unitCost: num(formData, "unitCost"),
    jobId: orNull(formData, "jobId"),
    partyId: orNull(formData, "partyId"),
    reference: str(formData, "reference", 120),
    notes: orNull(formData, "notes", 500),
  });
  if (!res.ok) return res;

  await audit({
    action: "Posted",
    entity: "StockMovement",
    entityId: res.movementId,
    summary:
      `${kind} of ${money(res.value)} on ${str(formData, "reference", 120)}` +
      (res.reference ? ` as ${res.reference}` : " (no voucher — stock moved, nothing else changed)"),
  });
  revalidatePath("/inventory/movements");
  revalidatePath("/inventory/stock");
  revalidatePath("/finance/daybook");
  return { ok: true };
}
