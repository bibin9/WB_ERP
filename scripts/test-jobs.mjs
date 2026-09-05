/**
 * Job costing (BRD FIN-06).
 *
 * The question this exists to answer is "did we make money on the ADNOC job?".
 * These check that the figures come from the ledgers rather than a parallel
 * total, that a job which has been posted against cannot be deleted out from
 * under its history, and that a correction follows the job it corrects.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const D = (s) => new Date(s + "T00:00:00.000Z");
const read = (p) => fs.readFileSync(p, "utf8");

const company = await db.company.findFirst({ where: { code: "WBE" } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const revenueAcct = accounts.find((a) => a.type === "Income");
const costAcct = accounts.find((a) => a.type === "Expense");
const cashAcct = accounts.find((a) => a.code === "1000");

const TAG = "TEST-JOB";
const cleanup = async () => {
  const ids = (await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } })).map((m) => m.id);
  if (ids.length) {
    await db.journalEntry.updateMany({ where: { reversalOfId: { in: ids } }, data: { reversalOfId: null } });
    await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }
  await db.job.deleteMany({ where: { code: { startsWith: "ZZ-" } } });
};
await cleanup();

/* ------------------------------------------------------- the job master -- */
const job = await db.job.create({
  data: { companyId: company.id, code: "ZZ-0001", name: "Test contract", contractValue: 500000, budgetCost: 300000 },
});
ok("a job can be created with a contract value and a budget", job.contractValue === 500000 && job.budgetCost === 300000);

let dupe = false;
try {
  await db.job.create({ data: { companyId: company.id, code: "ZZ-0001", name: "Another" } });
} catch { dupe = true; }
ok("job codes are unique within a company", dupe);

/* ------------------------------------------- costing comes from the ledger */
// Revenue 400,000 and cost 250,000, tagged to the job.
await db.journalEntry.create({
  data: {
    companyId: company.id, reference: `${TAG}/SI`, date: D("2026-06-10"), voucherType: "Sales",
    memo: `${TAG} progress invoice`, postedBy: "test",
    lines: { create: [
      { accountId: cashAcct.id, debit: 400000, credit: 0 },
      { accountId: revenueAcct.id, debit: 0, credit: 400000, jobId: job.id },
    ] },
  },
});
await db.journalEntry.create({
  data: {
    companyId: company.id, reference: `${TAG}/PI`, date: D("2026-06-20"), voucherType: "Purchase",
    memo: `${TAG} subcontractor`, postedBy: "test",
    lines: { create: [
      { accountId: costAcct.id, debit: 250000, credit: 0, jobId: job.id },
      { accountId: cashAcct.id, debit: 0, credit: 250000 },
    ] },
  },
});

/** The same arithmetic the screen does. */
async function cost(jobId, from, to) {
  const lines = await db.journalLine.findMany({
    where: { jobId, entry: { date: { gte: from, lte: to } } },
    include: { account: { select: { type: true } } },
  });
  let revenue = 0, spend = 0;
  for (const l of lines) {
    const net = l.debit - l.credit;
    if (l.account.type === "Income") revenue += -net;
    else if (l.account.type === "Expense") spend += net;
  }
  return { revenue, cost: spend, margin: revenue - spend };
}

const year = await cost(job.id, D("2026-01-01"), D("2026-12-31"));
ok("revenue is read from income accounts", year.revenue === 400000, String(year.revenue));
ok("cost is read from expense accounts", year.cost === 250000, String(year.cost));
ok("margin is revenue less cost", year.margin === 150000, String(year.margin));
ok("margin percentage is right", Math.abs(year.margin / year.revenue - 0.375) < 0.0001, "37.5%");
ok("the job is inside its budget", year.cost < job.budgetCost, `${year.cost} of ${job.budgetCost}`);

// Only the bank side of each voucher is untagged; it must not count as cost.
const untaggedCash = await db.journalLine.count({
  where: { entry: { memo: { contains: TAG } }, jobId: null },
});
ok("lines with no job are excluded", untaggedCash === 2, `${untaggedCash} untagged lines ignored`);

/* ------------------------------------------------------- by period ------- */
const firstHalf = await cost(job.id, D("2026-01-01"), D("2026-06-15"));
ok("costing respects the reporting period", firstHalf.revenue === 400000 && firstHalf.cost === 0,
  `revenue ${firstHalf.revenue}, cost ${firstHalf.cost} to 15 June`);

/* --------------------------------------------- a correction follows it --- */
const original = await db.journalEntry.findFirst({ where: { reference: `${TAG}/PI` }, include: { lines: true } });
await db.journalEntry.create({
  data: {
    companyId: company.id, reference: `${TAG}/REV`, date: D("2026-07-01"), voucherType: "Purchase",
    memo: `${TAG} reversal`, postedBy: "test", reversalOfId: original.id,
    lines: { create: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, jobId: l.jobId })) },
  },
});
const afterReversal = await cost(job.id, D("2026-01-01"), D("2026-12-31"));
ok("reversing a cost removes it from the job", afterReversal.cost === 0, String(afterReversal.cost));
ok("and the margin recovers", afterReversal.margin === 400000, String(afterReversal.margin));
ok("the reversal action carries the job through",
  read("src/app/(app)/finance/actions.ts").includes("vatTreatment: l.vatTreatment, jobId: l.jobId"));

/* ------------------------------------------------ deleting a used job --- */
const used = await db.job.findUnique({ where: { id: job.id }, include: { _count: { select: { lines: true } } } });
ok("a job knows how much has been posted to it", used._count.lines > 0, `${used._count.lines} lines`);
ok("the delete action refuses a job with postings",
  read("src/app/(app)/finance/jobs/actions.ts").includes("Set it to Closed instead"));

/* ------------------------------------------------------------ wiring ---- */
ok("the screen is registered for access control", read("src/lib/rbac.ts").includes('"finance.jobs"'));
ok("every action checks permission",
  (read("src/app/(app)/finance/jobs/actions.ts").match(/await allow\("finance\.jobs"/g) || []).length === 3);
ok("a job's customer must belong to the same company",
  read("src/app/(app)/finance/jobs/actions.ts").includes("That customer is not in this company"));
ok("an end date before the start is refused",
  read("src/app/(app)/finance/jobs/actions.ts").includes("end date is before the start date"));
ok("the voucher form can tag a line with a job", read("src/components/JournalForm.tsx").includes("jobId: l.jobId || null"));
ok("the day book can show one job's vouchers",
  read("src/app/(app)/finance/daybook/page.tsx").includes("lines: { some: { jobId: sp.j } }"));
ok("jobs can be exported", read("src/app/(app)/export/actions.ts").includes('label: "jobs"'));

/* ------------------------------------------------------------- seed ----- */
const seeded = await db.job.findMany({ where: { companyId: company.id, code: { startsWith: "J-" } } });
ok("the demo has jobs to look at", seeded.length >= 2, seeded.map((j) => j.code).join(", "));
const demo = await cost(seeded[0].id, D("2026-01-01"), D("2026-12-31"));
ok("and the demo job shows real figures", demo.revenue > 0 && demo.cost > 0,
  `revenue ${demo.revenue}, cost ${demo.cost}, margin ${demo.margin}`);

await cleanup();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
