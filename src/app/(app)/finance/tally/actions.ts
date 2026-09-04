"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { tallyRequest, companyListXml, ledgersExportXml, parseLedgers, parseCompanyNames, mapGroupToType } from "@/lib/tally";
import { allow } from "@/lib/guard";

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session || !session.companies.some((c) => c.id === companyId)) return null;
  return session;
}

export async function saveTallyConfig(formData: FormData) {
  if (!(await allow("finance.tally", "edit"))) return;
  const companyId = String(formData.get("companyId") || "");
  const session = await scoped(companyId);
  if (!session || !(await canAdminister())) return;
  const host = String(formData.get("host") || "localhost").trim();
  const port = Number(formData.get("port")) || 9000;
  const tallyCompany = String(formData.get("tallyCompany") || "").trim() || null;
  await db.tallyConfig.upsert({
    where: { companyId },
    update: { host, port, tallyCompany },
    create: { companyId, host, port, tallyCompany },
  });
  revalidatePath("/finance/tally");
}

export async function testTallyConnection(companyId: string): Promise<{ ok: boolean; message: string }> {
  if (!(await allow("finance.tally", "view"))) return { ok: false, message: "Not authorised" };
  const session = await scoped(companyId);
  if (!session) return { ok: false, message: "No access" };
  const cfg = await db.tallyConfig.findUnique({ where: { companyId } });
  if (!cfg) return { ok: false, message: "Save the connection settings first." };
  try {
    const xml = await tallyRequest(cfg.host, cfg.port, companyListXml());
    const companies = parseCompanyNames(xml);
    return { ok: true, message: `Connected. Companies open in Tally: ${companies.length ? companies.join(", ") : "(none reported)"}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed" };
  }
}

export async function importLedgersFromTally(companyId: string): Promise<{ ok: boolean; message: string }> {
  if (!(await allow("finance.tally", "create"))) return { ok: false, message: "Not authorised" };
  const session = await scoped(companyId);
  if (!session || !(await canAdminister())) return { ok: false, message: "Not authorised" };
  const cfg = await db.tallyConfig.findUnique({ where: { companyId } });
  if (!cfg?.tallyCompany) return { ok: false, message: "Set the Tally company name in settings first." };

  let ledgers;
  try {
    const xml = await tallyRequest(cfg.host, cfg.port, ledgersExportXml(cfg.tallyCompany), 20000);
    ledgers = parseLedgers(xml);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Import failed" };
  }
  if (ledgers.length === 0) return { ok: false, message: "No ledgers returned — check the Tally company name." };

  let created = 0, updated = 0;
  const startCount = await db.chartOfAccount.count({ where: { companyId } });
  for (const [i, l] of ledgers.entries()) {
    const type = mapGroupToType(l.parent);
    const existing = await db.chartOfAccount.findFirst({ where: { companyId, tallyGuid: l.name } });
    if (existing) {
      await db.chartOfAccount.update({ where: { id: existing.id }, data: { name: l.name, type, parentGroup: l.parent || null } });
      updated++;
    } else {
      const code = `TLY${String(startCount + created + 1).padStart(4, "0")}`;
      await db.chartOfAccount.create({ data: { companyId, code, name: l.name, type, parentGroup: l.parent || null, tallyGuid: l.name } });
      created++;
    }
  }
  const info = `Imported ${ledgers.length} ledgers (${created} new, ${updated} updated).`;
  await db.tallyConfig.update({ where: { companyId }, data: { lastSyncAt: new Date(), lastSyncInfo: info } });
  await audit({ action: "Updated", entity: "TallyConfig", summary: `Tally import: ${info}` });
  revalidatePath("/finance/tally");
  revalidatePath("/finance");
  return { ok: true, message: info };
}
