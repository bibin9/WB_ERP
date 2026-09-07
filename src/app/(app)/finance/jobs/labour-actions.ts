"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { postVoucher } from "@/lib/posting";
import { toFils } from "@/lib/money";
import { lineCost, LABOUR_COST_CODE, LABOUR_RECOVERED_CODE } from "@/lib/labour";

/**
 * Absorbing timesheet hours into the ledger.
 *
 * One voucher per run, whatever the period covers: a debit to Site Labour for
 * each job, and a single credit to Labour Recovered for the total. It goes
 * through postVoucher like everything else, so the period lock, the balance
 * check and company ownership all apply without being restated here.
 *
 * Each timesheet is stamped with the voucher that took it, which is what stops
 * the same hours being charged twice. Adding a late timesheet and running again
 * picks up only what has not been posted.
 */

export type LabourResult =
  | { ok: true; reference: string; jobs: number; hours: number; amount: number }
  | { ok: false; error: string };

function parseDates(fromStr: string, toStr: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) return null;
  const from = new Date(fromStr + "T00:00:00.000Z");
  const to = new Date(toStr + "T23:59:59.999Z");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) return null;
  return { from, to };
}

export async function postLabourToJobs(
  companyId: string,
  fromStr: string,
  toStr: string
): Promise<LabourResult> {
  if (!(await allow("finance.jobs", "create"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access to this company" };

  const period = parseDates(fromStr, toStr);
  if (!period) return { ok: false, error: "Choose a valid date range" };

  // Only hours that carry a job and have not already been absorbed.
  const sheets = await db.timesheet.findMany({
    where: { companyId, jobId: { not: null }, entryId: null, date: { gte: period.from, lte: period.to } },
    select: { id: true, jobId: true, hours: true, costRate: true },
  });
  if (sheets.length === 0) {
    return {
      ok: false,
      error:
        "There is nothing to post. Either the time in this period is already on the jobs, or it was logged without a job against it.",
    };
  }

  const byJob = new Map<string, { hours: number; amount: number }>();
  for (const t of sheets) {
    const slot = byJob.get(t.jobId!) ?? { hours: 0, amount: 0 };
    slot.hours += t.hours;
    slot.amount += lineCost(t.hours, t.costRate);
    byJob.set(t.jobId!, slot);
  }

  // A rate of zero means nobody has put a salary on that employee yet. Posting
  // a nil line would say the work was free, which is worse than saying so.
  const charged = [...byJob.entries()].map(([jobId, v]) => ({ jobId, hours: v.hours, amount: toFils(v.amount) }))
    .filter((j) => j.amount > 0);
  if (charged.length === 0) {
    return {
      ok: false,
      error:
        "Every hour in this period costs nothing, because the people who logged it have no pay on record. Add their salary, or an hourly cost, then post again.",
    };
  }

  const accounts = await db.chartOfAccount.findMany({
    where: { companyId, code: { in: [LABOUR_COST_CODE, LABOUR_RECOVERED_CODE] } },
    select: { id: true, code: true },
  });
  const cost = accounts.find((a) => a.code === LABOUR_COST_CODE);
  const recovered = accounts.find((a) => a.code === LABOUR_RECOVERED_CODE);
  if (!cost || !recovered) {
    return {
      ok: false,
      error: `This company needs accounts ${LABOUR_COST_CODE} (Site Labour) and ${LABOUR_RECOVERED_CODE} (Labour Recovered) before labour can be charged to jobs. Add them under Ledgers.`,
    };
  }

  const total = toFils(charged.reduce((s, j) => s + j.amount, 0));
  const lines = [
    ...charged.map((j) => ({ accountId: cost.id, debit: j.amount, credit: 0, jobId: j.jobId })),
    { accountId: recovered.id, debit: 0, credit: total },
  ];

  // A second run over the same period is a top-up, not a repeat, so the source
  // id carries the run number — the unique index would otherwise refuse it.
  const runNo =
    (await db.journalEntry.count({ where: { companyId, sourceType: "labour" } })) + 1;

  const result = await postVoucher({
    companyId,
    postedBy: session.user.name,
    voucherType: "Journal",
    date: toStr,
    memo: `Labour on jobs, ${fromStr} to ${toStr}`,
    lines,
    sourceType: "labour",
    sourceId: `${fromStr}_${toStr}#${runNo}`,
    source: "timesheet",
  });
  if (!result.ok) return result;

  // Stamp the hours that went into it. Anything logged after this run stays
  // unstamped and is picked up next time.
  await db.timesheet.updateMany({
    where: { id: { in: sheets.map((t) => t.id) } },
    data: { entryId: result.entryId },
  });

  const hours = charged.reduce((s, j) => s + j.hours, 0);
  await audit({
    action: "Posted",
    entity: "JournalEntry",
    entityId: result.entryId,
    summary: `Charged ${hours}h of labour to ${charged.length} job(s) as ${result.reference}`,
  });
  revalidatePath("/finance/jobs");
  revalidatePath("/hr/attendance");
  revalidatePath("/finance/daybook");
  return { ok: true, reference: result.reference, jobs: charged.length, hours, amount: total };
}
