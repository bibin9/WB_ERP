"use server";

import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { identify, MAX_UPLOAD_BYTES } from "@/lib/uploads";
import { attachableFor, cleanKind } from "@/lib/attachments";

/**
 * Putting a file beside a bill or an order, and taking one away.
 *
 * The same rules the employee documents follow, for the same reasons: the file
 * is identified by its first bytes rather than by what it claims to be, the
 * name on disk is random so nothing an uploader writes reaches the filesystem,
 * and every upload is audited. What is different here is that the permission
 * depends on which document it is filed against (lib/attachments.ts).
 */

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
type Result = { ok: boolean; error?: string };

/** The document being attached to, if this person may see it in this company. */
async function target(entity: string, entityId: string, action: "view" | "create" | "delete") {
  const a = attachableFor(entity);
  if (!a) return null;
  const session = await allow(a.screen, action === "view" ? "view" : action);
  if (!session) return null;

  const companyId =
    entity === "Invoice"
      ? (await db.invoice.findUnique({ where: { id: entityId }, select: { companyId: true } }))?.companyId
      : (await db.purchaseOrder.findUnique({ where: { id: entityId }, select: { companyId: true } }))?.companyId;
  if (!companyId || !session.companies.some((c) => c.id === companyId)) return null;
  return { session, companyId, a };
}

/** Where the screens the file belongs to live, so they show it straight away. */
function refresh(entity: string, entityId: string) {
  if (entity === "Invoice") {
    revalidatePath(`/finance/invoices/${entityId}`);
    revalidatePath("/finance/invoices");
  } else {
    revalidatePath("/inventory/orders");
  }
}

export async function uploadAttachment(formData: FormData): Promise<Result> {
  const entity = String(formData.get("entity") || "");
  const entityId = String(formData.get("entityId") || "");
  const t = await target(entity, entityId, "create");
  if (!t) return { ok: false, error: "Not authorised" };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "Choose a file first." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is over 10MB. Scan at a lower resolution, or split it." };
  }

  // What the file IS, not what it says it is.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = identify(file.name, bytes);
  if (!kind.ok) return { ok: false, error: kind.error };

  const storedName = randomBytes(16).toString("hex") + kind.type.extensions[0];
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), Buffer.from(bytes));

  await db.attachment.create({
    data: {
      companyId: t.companyId,
      entity,
      entityId,
      kind: cleanKind(entity, formData.get("kind")),
      fileName: file.name,
      storedName,
      mimeType: kind.type.mime,
      size: file.size,
      uploadedBy: t.session.user.name,
    },
  });
  await audit({
    action: "Created",
    entity: "Attachment",
    entityId,
    summary: `Attached ${file.name} to ${t.a.label.toLowerCase()}`,
  });
  refresh(entity, entityId);
  return { ok: true };
}

export async function deleteAttachment(id: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authorised" };
  const row = await db.attachment.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };

  const t = await target(row.entity, row.entityId, "delete");
  if (!t || t.companyId !== row.companyId) return { ok: false, error: "Not authorised" };

  await db.attachment.delete({ where: { id } });
  await fs.rm(path.join(UPLOAD_DIR, path.basename(row.storedName)), { force: true }).catch(() => undefined);
  await audit({
    action: "Deleted",
    entity: "Attachment",
    entityId: row.entityId,
    summary: `Removed ${row.fileName} from ${t.a.label.toLowerCase()}`,
  });
  refresh(row.entity, row.entityId);
  return { ok: true };
}
