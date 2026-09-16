"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { checkDocumentSettings } from "@/lib/document-settings";

/**
 * How a company's documents look: letterhead artwork, contact line, footer,
 * standard terms. One row per company, read by every PDF the company prints.
 */

export type Result = { ok: true } | { ok: false; error: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function saveDocumentSettings(formData: FormData): Promise<Result> {
  if (!(await allow("settings.documents", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  const companyId = str(formData, "companyId");
  if (!session || !session.companies.some((c) => c.id === companyId)) {
    return { ok: false, error: "No access to this company" };
  }

  const checked = checkDocumentSettings({
    accentColor: str(formData, "accentColor"),
    headerImage: str(formData, "headerImage"),
    footerImage: str(formData, "footerImage"),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    website: str(formData, "website"),
    footerNote: str(formData, "footerNote"),
    quotationTerms: str(formData, "quotationTerms"),
    purchaseOrderTerms: str(formData, "purchaseOrderTerms"),
    rfqTerms: str(formData, "rfqTerms"),
    showSignatures: str(formData, "showSignatures") === "on",
  });
  if (!checked.ok) return checked;

  const existing = await db.documentSettings.findUnique({ where: { companyId } });
  const data = { ...checked.data, updatedBy: session.user.name };
  await db.documentSettings.upsert({
    where: { companyId },
    update: data,
    create: { companyId, ...data },
  });

  // Say what changed in words, not the artwork itself — a data URI in the audit
  // log is a megabyte of noise nobody can read.
  const changed: string[] = [];
  if (existing) {
    if (existing.headerImage !== data.headerImage) {
      changed.push(data.headerImage ? "header artwork replaced" : "header artwork removed");
    }
    if (existing.footerImage !== data.footerImage) {
      changed.push(data.footerImage ? "footer artwork replaced" : "footer artwork removed");
    }
    for (const [k, label] of [
      ["quotationTerms", "quotation terms"],
      ["purchaseOrderTerms", "purchase order terms"],
      ["rfqTerms", "enquiry terms"],
    ] as const) {
      if (existing[k] !== data[k]) changed.push(`${label} changed`);
    }
  }

  await audit({
    action: existing ? "Updated" : "Created",
    entity: "DocumentSettings",
    entityId: companyId,
    summary: `Printed document settings saved${changed.length ? ": " + changed.join(", ") : ""}`,
  });

  revalidatePath("/settings/documents");
  return { ok: true };
}
