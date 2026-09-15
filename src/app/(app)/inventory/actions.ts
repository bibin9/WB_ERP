"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { money } from "@/lib/money";
import { recordMovement, transferStock, inspectReceipt, postReturn } from "@/lib/stock-posting";
import { EQUIPMENT_STATUSES, CALIBRATION_RESULTS, expiryFrom } from "@/lib/calibration";
import { createRequest, createOrder, submitOrder, cancelOrder, receiveAgainstOrder } from "@/lib/purchase-posting";

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


/* =========================================== material requests (INV-01) == */

export async function saveRequest(formData: FormData): Promise<Result> {
  if (!(await allow("inventory.requests", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  let lines: { itemId?: string; description: string; unitCode?: string; quantity: number }[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { ok: false, error: "Could not read the lines. Try again." };
  }

  const res = await createRequest({
    companyId,
    tenantId: session.tenant.id,
    requestedBy: session.user.name,
    jobId: orNull(formData, "jobId"),
    storeId: orNull(formData, "storeId"),
    neededBy: orNull(formData, "neededBy", 10),
    notes: orNull(formData, "notes", 500),
    lines: lines.map((l) => ({
      itemId: l.itemId || null,
      description: String(l.description ?? "").slice(0, 300),
      unitCode: String(l.unitCode ?? "EA").slice(0, 8),
      quantity: Number(l.quantity) || 0,
    })),
  });
  if (!res.ok) return res;

  await audit({
    action: "Created",
    entity: "MaterialRequest",
    entityId: res.requestId,
    summary: `Raised material request ${res.number} and sent it for approval`,
  });
  revalidatePath("/inventory/requests");
  revalidatePath("/approvals");
  return { ok: true };
}

/* ========================================== returns from site (INV-16) == */

/**
 * A material return note.
 *
 * The condition on each line is the whole document: reusable goes back on the
 * shelf and credits the job, scrap does neither. The library decides both — the
 * action only reads the form and says who is asking.
 */
export async function saveReturn(formData: FormData): Promise<Result> {
  if (!(await allow("inventory.returns", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  let lines: { itemId: string; condition: string; quantity: number; notes?: string }[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { ok: false, error: "Could not read the lines. Try again." };
  }

  const res = await postReturn({
    companyId,
    postedBy: session.user.name,
    jobId: str(formData, "jobId"),
    storeId: str(formData, "storeId"),
    date: str(formData, "date", 10),
    returnedBy: str(formData, "returnedBy"),
    notes: orNull(formData, "notes", 500),
    lines: lines.map((l) => ({
      itemId: String(l.itemId ?? ""),
      condition: String(l.condition ?? ""),
      quantity: Number(l.quantity) || 0,
      notes: String(l.notes ?? "").slice(0, 300) || null,
    })),
  });
  if (!res.ok) return res;

  await audit({
    action: "Created",
    entity: "MaterialReturn",
    entityId: res.returnId,
    summary: `Recorded material return ${res.number} from site`,
  });
  revalidatePath("/inventory/returns");
  revalidatePath("/inventory/movements");
  revalidatePath("/inventory/stock");
  return { ok: true };
}

/* ============================================= purchase orders (INV-05) == */

export async function saveOrder(formData: FormData): Promise<Result> {
  if (!(await allow("inventory.orders", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  let lines: { itemId?: string; description: string; unitCode?: string; quantity: number; unitPrice: number }[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { ok: false, error: "Could not read the lines. Try again." };
  }

  const res = await createOrder({
    companyId,
    raisedBy: session.user.name,
    partyId: str(formData, "partyId"),
    jobId: orNull(formData, "jobId"),
    storeId: orNull(formData, "storeId"),
    requestId: orNull(formData, "requestId"),
    date: str(formData, "date", 10),
    expectedDate: orNull(formData, "expectedDate", 10),
    notes: orNull(formData, "notes", 500),
    lines: lines.map((l) => ({
      itemId: l.itemId || null,
      description: String(l.description ?? "").slice(0, 300),
      unitCode: String(l.unitCode ?? "EA").slice(0, 8),
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
    })),
  });
  if (!res.ok) return res;

  await audit({
    action: "Created",
    entity: "PurchaseOrder",
    entityId: res.orderId,
    summary: `Raised purchase order ${res.number}`,
  });
  revalidatePath("/inventory/orders");
  return { ok: true };
}

/** Send an order for approval (INV-08). */
export async function sendOrderForApproval(orderId: string): Promise<Result> {
  if (!(await allow("inventory.orders", "edit"))) return { ok: false, error: "Not authorised" };
  const order = await db.purchaseOrder.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "Not found" };
  const session = await scoped(order.companyId);
  if (!session) return { ok: false, error: "No access" };

  const res = await submitOrder(orderId, session.tenant.id, session.user.name);
  if (!res.ok) return res;

  await audit({
    action: "Updated",
    entity: "PurchaseOrder",
    entityId: orderId,
    summary: `Sent purchase order ${order.number} for approval`,
  });
  revalidatePath("/inventory/orders");
  revalidatePath("/approvals");
  return { ok: true };
}

export async function callOffOrder(orderId: string): Promise<Result> {
  if (!(await allow("inventory.orders", "edit"))) return { ok: false, error: "Not authorised" };
  const order = await db.purchaseOrder.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "Not found" };
  const session = await scoped(order.companyId);
  if (!session) return { ok: false, error: "No access" };

  const res = await cancelOrder(orderId, session.user.name);
  if (!res.ok) return res;

  await audit({
    action: "Updated",
    entity: "PurchaseOrder",
    entityId: orderId,
    summary: `Cancelled purchase order ${order.number}`,
  });
  revalidatePath("/inventory/orders");
  return { ok: true };
}

/** Record a delivery against an order line (INV-10). */
export async function receiveOrderLine(formData: FormData): Promise<Result> {
  if (!(await allow("inventory.movements", "create"))) return { ok: false, error: "Not authorised" };
  const lineId = str(formData, "orderLineId");
  const line = await db.purchaseOrderLine.findUnique({ where: { id: lineId }, include: { order: true } });
  if (!line) return { ok: false, error: "Not found" };
  const session = await scoped(line.order.companyId);
  if (!session) return { ok: false, error: "No access" };

  const res = await receiveAgainstOrder({
    orderLineId: lineId,
    postedBy: session.user.name,
    storeId: str(formData, "storeId"),
    date: str(formData, "date", 10),
    quantity: num(formData, "quantity"),
    reference: str(formData, "reference", 120),
    notes: orNull(formData, "notes", 500),
  });
  if (!res.ok) return res;

  await audit({
    action: "Posted",
    entity: "PurchaseOrder",
    entityId: line.orderId,
    summary: `Received material against ${line.order.number} on ${str(formData, "reference", 120)}`,
  });
  revalidatePath("/inventory/orders");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/movements");
  return { ok: true };
}


/* ================================================ QA/QC inspection (INV-11) */

export async function recordInspection(formData: FormData): Promise<Result> {
  if (!(await allow("inventory.movements", "edit"))) return { ok: false, error: "Not authorised" };
  const movementId = str(formData, "movementId");
  const movement = await db.stockMovement.findUnique({ where: { id: movementId }, include: { item: true } });
  if (!movement) return { ok: false, error: "Not found" };
  const session = await scoped(movement.companyId);
  if (!session) return { ok: false, error: "No access" };

  const outcome = str(formData, "outcome") === "Rejected" ? "Rejected" : "Accepted";
  const res = await inspectReceipt({
    movementId,
    inspectedBy: session.user.name,
    outcome,
    note: orNull(formData, "note", 500),
  });
  if (!res.ok) return res;

  await audit({
    action: "Updated",
    entity: "StockMovement",
    entityId: movementId,
    summary: `${outcome} ${movement.quantity} ${movement.item.unitCode} of ${movement.item.code} on ${movement.reference}`,
  });
  revalidatePath("/inventory/movements");
  revalidatePath("/inventory/stock");
  return { ok: true };
}


/* ================================ equipment and calibration (INV-12/13) == */

export async function saveEquipment(formData: FormData): Promise<Result> {
  const id = str(formData, "id");
  const editing = !!id;
  if (!(await allow("inventory.equipment", editing ? "edit" : "create"))) return { ok: false, error: "Not authorised" };

  const companyId = editing
    ? (await db.equipment.findUnique({ where: { id } }))?.companyId ?? ""
    : str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const serialNo = str(formData, "serialNo", 80);
  const description = str(formData, "description", 200);
  if (!serialNo) return { ok: false, error: "Enter the serial number. It is what tells one wrench from another." };
  if (!description) return { ok: false, error: "Enter what it is." };

  const clash = await db.equipment.findFirst({ where: { companyId, serialNo, ...(editing ? { NOT: { id } } : {}) } });
  if (clash) return { ok: false, error: `${serialNo} is already on the register as ${clash.description}.` };

  const status = str(formData, "status");
  if (!(EQUIPMENT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Choose a status." };
  }
  const jobId = orNull(formData, "jobId");
  if (jobId && !(await db.job.findFirst({ where: { id: jobId, companyId } }))) {
    return { ok: false, error: "That job is not in this company." };
  }
  const storeId = orNull(formData, "storeId");
  if (storeId && !(await db.store.findFirst({ where: { id: storeId, companyId } }))) {
    return { ok: false, error: "That store is not in this company." };
  }

  const months = Math.round(num(formData, "calibrationMonths"));
  const data = {
    serialNo,
    description,
    category: orNull(formData, "category", 80),
    manufacturer: orNull(formData, "manufacturer", 120),
    model: orNull(formData, "model", 120),
    status,
    requiresCalibration: str(formData, "requiresCalibration") === "on",
    calibrationMonths: months >= 1 && months <= 120 ? months : 12,
    storeId,
    jobId,
    heldBy: orNull(formData, "heldBy", 120),
    notes: orNull(formData, "notes", 500),
    isActive: editing ? str(formData, "isActive") === "on" : true,
  };

  if (editing) {
    await db.equipment.update({ where: { id }, data });
    await audit({ action: "Updated", entity: "Equipment", entityId: id, summary: `Updated equipment ${serialNo}` });
  } else {
    const created = await db.equipment.create({ data: { companyId, ...data } });
    await audit({ action: "Created", entity: "Equipment", entityId: created.id, summary: `Added equipment ${serialNo} — ${description}` });
  }
  revalidatePath("/inventory/equipment");
  return { ok: true };
}

/**
 * Record a calibration (INV-12).
 *
 * Nothing is posted. What the lab charged arrives on their invoice like any
 * other service; this is the certificate, not the money.
 *
 * The expiry is computed from the calibration date rather than from today,
 * because a certificate for work done last week runs from when the work was
 * done. Counting from today would extend every certificate by however long the
 * paperwork took to come back.
 */
export async function saveCalibration(formData: FormData): Promise<Result> {
  if (!(await allow("inventory.equipment", "edit"))) return { ok: false, error: "Not authorised" };
  const equipmentId = str(formData, "equipmentId");
  const equipment = await db.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) return { ok: false, error: "Not found" };
  const session = await scoped(equipment.companyId);
  if (!session) return { ok: false, error: "No access" };

  if (!equipment.requiresCalibration) {
    return {
      ok: false,
      error: `${equipment.serialNo} is not set to carry a certificate, so there is nothing to calibrate. Turn that on first if it should.`,
    };
  }

  const result = str(formData, "result");
  if (!(CALIBRATION_RESULTS as readonly string[]).includes(result)) {
    return { ok: false, error: "Say whether it passed or failed." };
  }
  const calibratedOn = str(formData, "calibratedOn", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calibratedOn)) return { ok: false, error: "Enter the date it was calibrated." };

  // A date in the future would hand out a certificate that has not happened.
  const when = new Date(calibratedOn + "T00:00:00.000Z");
  if (when.getTime() > Date.now() + 86_400_000) {
    return { ok: false, error: "That date is in the future. A certificate cannot start before the work was done." };
  }

  const months = Math.round(num(formData, "months")) || equipment.calibrationMonths || 12;
  const validTo = result === "Passed" ? expiryFrom(calibratedOn, months) : null;

  await db.calibrationRecord.create({
    data: {
      equipmentId,
      calibratedOn: when,
      result,
      validTo,
      certificateNo: orNull(formData, "certificateNo", 80),
      calibratedBy: orNull(formData, "calibratedBy", 120),
      notes: orNull(formData, "notes", 500),
      recordedBy: session.user.name,
    },
  });

  // Back in service once it has been calibrated, wherever it was before. A
  // failure leaves it blocked by the result rather than by the status.
  if (equipment.status === "Out for calibration") {
    await db.equipment.update({ where: { id: equipmentId }, data: { status: "In service" } });
  }

  await audit({
    action: "Created",
    entity: "Equipment",
    entityId: equipmentId,
    summary:
      `${result} calibration for ${equipment.serialNo}` +
      (validTo ? `, valid to ${validTo.toISOString().slice(0, 10)}` : ""),
  });
  revalidatePath("/inventory/equipment");
  return { ok: true };
}
