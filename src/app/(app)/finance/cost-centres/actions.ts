"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";

/**
 * Cost centres — the second costing dimension.
 *
 * A job answers "did we make money on the ADNOC contract?". A cost centre
 * answers "what does the workshop cost to run?" — the part of the business that
 * no customer is paying for directly. Both ERPNext and Odoo keep the two apart
 * for the same reason: without it, an overhead line and a line somebody simply
 * forgot to tag are the same empty field, so neither the overhead total nor the
 * untagged-cost warning can be trusted.
 *
 * A line carries one or the other, never both. That rule lives in postVoucher,
 * so a cost raised by any module obeys it.
 */

function read(formData: FormData) {
  return {
    name: String(formData.get("name") || "").trim(),
    parentId: String(formData.get("parentId") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
    isActive: String(formData.get("isActive") || "on") !== "off",
  };
}

/** Next code in the CC-01 series, per company. */
async function nextCode(companyId: string): Promise<string> {
  const n = await db.costCentre.count({ where: { companyId } });
  return `CC-${String(n + 1).padStart(2, "0")}`;
}

/**
 * Walk up the tree so a centre cannot be moved inside itself. A cycle here
 * would make the roll-up recurse until the page gives up loading.
 */
async function wouldLoop(centreId: string, parentId: string): Promise<boolean> {
  let cursor: string | null = parentId;
  for (let hops = 0; cursor && hops < 20; hops++) {
    if (cursor === centreId) return true;
    const parent: { parentId: string | null } | null = await db.costCentre.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
  return false;
}

export async function createCostCentre(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.costcentres", "create"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const companyId = String(formData.get("companyId") || "");
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access to this company" };

  const data = read(formData);
  if (!data.name) return { ok: false, error: "Give the cost centre a name" };
  if (data.parentId && !(await db.costCentre.findFirst({ where: { id: data.parentId, companyId } }))) {
    return { ok: false, error: "That parent cost centre is not in this company" };
  }

  const code = String(formData.get("code") || "").trim() || (await nextCode(companyId));
  if (await db.costCentre.findUnique({ where: { companyId_code: { companyId, code } } })) {
    return { ok: false, error: `Cost centre ${code} already exists` };
  }

  const created = await db.costCentre.create({ data: { companyId, code, ...data } });
  await audit({
    action: "Created",
    entity: "CostCentre",
    entityId: created.id,
    summary: `Added cost centre ${code} — ${data.name}`,
  });
  revalidatePath("/finance/cost-centres");
  return { ok: true };
}

export async function updateCostCentre(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.costcentres", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const id = String(formData.get("id") || "");
  const centre = await db.costCentre.findUnique({ where: { id } });
  if (!centre || !session.companies.some((c) => c.id === centre.companyId)) return { ok: false, error: "Not found" };

  const data = read(formData);
  if (!data.name) return { ok: false, error: "Give the cost centre a name" };
  if (data.parentId) {
    if (data.parentId === id) return { ok: false, error: "A cost centre cannot be its own parent" };
    if (!(await db.costCentre.findFirst({ where: { id: data.parentId, companyId: centre.companyId } }))) {
      return { ok: false, error: "That parent cost centre is not in this company" };
    }
    if (await wouldLoop(id, data.parentId)) {
      return { ok: false, error: "That would put the cost centre inside one of its own children" };
    }
  }

  await db.costCentre.update({ where: { id }, data });
  await audit({
    action: "Updated",
    entity: "CostCentre",
    entityId: id,
    summary: `Updated cost centre ${centre.code} — ${data.name}`,
  });
  revalidatePath("/finance/cost-centres");
  return { ok: true };
}

export async function deleteCostCentre(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.costcentres", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const centre = await db.costCentre.findUnique({
    where: { id },
    include: { _count: { select: { lines: true, children: true } } },
  });
  if (!centre || !session.companies.some((c) => c.id === centre.companyId)) return { ok: false, error: "Not found" };

  if (centre._count.children > 0) {
    return {
      ok: false,
      error: `${centre.code} has ${centre._count.children} cost centre${centre._count.children === 1 ? "" : "s"} under it. Move or delete those first.`,
    };
  }
  // Deleting one that has been posted against would orphan the overhead.
  if (centre._count.lines > 0) {
    return {
      ok: false,
      error: `${centre.code} has ${centre._count.lines} posting${centre._count.lines === 1 ? "" : "s"} against it. Untick Active instead.`,
    };
  }

  await db.costCentre.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "CostCentre", entityId: id, summary: `Deleted cost centre ${centre.code}` });
  revalidatePath("/finance/cost-centres");
  return { ok: true };
}
