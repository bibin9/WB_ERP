/**
 * Labour on jobs.
 *
 * The gap this closes: hours were recorded and salaries were posted, but
 * nothing joined them, so a job showed only its materials and subcontractors.
 * On a technical-services contract labour is usually the largest cost, so every
 * margin read better than the truth.
 *
 * The two properties that have to hold together, and are easy to get wrong one
 * at a time:
 *   - the job must gain the labour cost, and
 *   - the profit for the period must not change, because the wages were already
 *     in the accounts. Absorption that quietly double-counts is worse than no
 *     absorption at all.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { hourlyCostFor, lineCost, STANDARD_MONTHLY_HOURS, LABOUR_COST_CODE, LABOUR_RECOVERED_CODE } from "../src/lib/labour.ts";

const read = (p) => fs.readFileSync(p, "utf8");

// postVoucher carries `import "server-only"`; same shim the other suites use.
const SHIM = "src/lib/.posting.labour.ts";
fs.writeFileSync(
  SHIM,
  read("src/lib/posting.ts").replace(/^import "server-only";.*$/m, "").replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let postVoucher;
try {
  ({ postVoucher } = await import("../src/lib/.posting.labour.ts"));
} finally {
  fs.unlinkSync(SHIM);
}

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ============================================================ the rate ==== */
ok("a monthly package spreads over standard hours",
  hourlyCostFor({ basicSalary: 15600, allowances: 5200 }) === 20800 / STANDARD_MONTHLY_HOURS,
  `20,800 / ${STANDARD_MONTHLY_HOURS} = ${(20800 / STANDARD_MONTHLY_HOURS).toFixed(2)}`);
ok("allowances count toward the cost of an hour",
  hourlyCostFor({ basicSalary: 10000, allowances: 5000 }) > hourlyCostFor({ basicSalary: 10000, allowances: 0 }));
ok("an explicit hourly cost overrides the package",
  hourlyCostFor({ basicSalary: 10000, allowances: 5000, hourlyCost: 250 }) === 250);
ok("no pay on record costs nothing", hourlyCostFor({ basicSalary: 0, allowances: 0 }) === 0);
ok("a zero override falls back to the package",
  hourlyCostFor({ basicSalary: 10400, allowances: 0, hourlyCost: 0 }) === 10400 / STANDARD_MONTHLY_HOURS);
ok("standard hours are 26 days of 8, not 30", STANDARD_MONTHLY_HOURS === 208);
ok("a line costs hours times the stored rate", lineCost(7.5, 12) === 90);

/* ================================================= the absorption itself == */
const company = await db.company.findFirst({ where: { code: "WBE" } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const cost = accounts.find((a) => a.code === LABOUR_COST_CODE);
const recovered = accounts.find((a) => a.code === LABOUR_RECOVERED_CODE);
ok("the chart has an account for labour on jobs", !!cost, cost?.name);
ok("and one to recover it from", !!recovered, recovered?.name);
ok("both are expense accounts, so the pair nets to nil in the P&L",
  cost?.type === "Expense" && recovered?.type === "Expense");

const TAG = "TEST-LABOUR";
const cleanup = async () => {
  const ids = (await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } })).map((e) => e.id);
  if (ids.length) {
    await db.timesheet.updateMany({ where: { entryId: { in: ids } }, data: { entryId: null } });
    await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }
  await db.timesheet.deleteMany({ where: { notes: TAG } });
};
await cleanup();

const job = await db.job.findFirst({ where: { companyId: company.id, code: "J-0001" } });
const other = await db.job.findFirst({ where: { companyId: company.id, code: "J-0002" } });
const emp = await db.employee.findFirst({ where: { companyId: company.id } });

/* Profit before, so it can be compared after. */
const profitFor = async () => {
  const lines = await db.journalLine.findMany({
    where: { entry: { companyId: company.id } },
    include: { account: { select: { type: true } } },
  });
  let income = 0, expense = 0;
  for (const l of lines) {
    if (l.account.type === "Income") income += l.credit - l.debit;
    else if (l.account.type === "Expense") expense += l.debit - l.credit;
  }
  return Math.round((income - expense) * 100) / 100;
};
const jobCostFor = async (jobId) => {
  const lines = await db.journalLine.findMany({
    where: { jobId, entry: { companyId: company.id } },
    include: { account: { select: { type: true } } },
  });
  return Math.round(lines.reduce((t, l) => (l.account.type === "Expense" ? t + l.debit - l.credit : t), 0) * 100) / 100;
};

const profitBefore = await profitFor();
const jobCostBefore = await jobCostFor(job.id);

// 16 hours at 25.00 on one job, 8 at 25.00 on another.
const RATE = 25;
const made = [];
for (const [j, hrs] of [[job, 8], [job, 8], [other, 8]]) {
  made.push(await db.timesheet.create({
    data: { companyId: company.id, employeeId: emp.id, jobId: j.id, date: new Date("2026-08-20"), hours: hrs, costRate: RATE, notes: TAG },
  }));
}

const posted = await postVoucher({
  companyId: company.id, postedBy: "test", voucherType: "Journal", date: "2026-08-20",
  memo: `${TAG} absorption`,
  sourceType: "labour", sourceId: "test-run-1", source: "timesheet",
  lines: [
    { accountId: cost.id, debit: 400, credit: 0, jobId: job.id },
    { accountId: cost.id, debit: 200, credit: 0, jobId: other.id },
    { accountId: recovered.id, debit: 0, credit: 600 },
  ],
});
ok("labour posts as one balanced voucher", posted.ok, posted.ok ? posted.reference : posted.error);
await db.timesheet.updateMany({ where: { id: { in: made.map((m) => m.id) } }, data: { entryId: posted.entryId } });

const profitAfter = await profitFor();
const jobCostAfter = await jobCostFor(job.id);

ok("the job now carries its labour", jobCostAfter - jobCostBefore === 400,
  `${jobCostBefore} -> ${jobCostAfter}`);
ok("and the profit for the period is unchanged", profitAfter === profitBefore,
  `${profitBefore} -> ${profitAfter}`);

/* ------------------------------------------------- posting twice refused - */
const again = await postVoucher({
  companyId: company.id, postedBy: "test", voucherType: "Journal", date: "2026-08-20",
  memo: `${TAG} repeat`, sourceType: "labour", sourceId: "test-run-1",
  lines: [
    { accountId: cost.id, debit: 400, credit: 0, jobId: job.id },
    { accountId: recovered.id, debit: 0, credit: 400 },
  ],
});
ok("the same labour run cannot post twice", !again.ok && /already been posted/i.test(again.error), again.error);

const stamped = await db.timesheet.count({ where: { id: { in: made.map((m) => m.id) }, entryId: { not: null } } });
ok("every absorbed timesheet is stamped with its voucher", stamped === made.length, `${stamped} of ${made.length}`);

/* ============================================================== wiring ==== */
const actions = read("src/app/(app)/finance/jobs/labour-actions.ts");
ok("the run only takes hours that carry a job", actions.includes("jobId: { not: null }"));
ok("and only hours not already charged", actions.includes("entryId: null"));
ok("it posts through the shared service", actions.includes("await postVoucher({") && actions.includes('from "@/lib/posting"'));
ok("it checks permission first", /postLabourToJobs[\s\S]{0,300}allow\("finance\.jobs", "create"\)/.test(actions));
ok("a second run over the same period is a top-up, not a refusal", actions.includes("runNo"));
ok("hours worth nothing are refused rather than posted as free work",
  actions.includes("costs nothing"));

const att = read("src/app/(app)/hr/attendance/actions.ts");
ok("the rate is snapshotted when time is logged", att.includes("costRate") && att.includes("hourlyCostFor"));
ok("a job from another company is refused", att.includes("not in this company"));
ok("time already charged cannot be deleted", att.includes("Reverse that voucher"));
ok("more than 24 hours in a day is refused", att.includes("more than a day"));

const page = read("src/app/(app)/finance/jobs/page.tsx");
ok("the job screen warns while labour is uncharged", page.includes("missing labour"));

const form = read("src/components/attendance/AttendanceForms.tsx");
ok("the timesheet form asks for a job", form.includes('name="jobId"'));
ok("and shows what the entry will cost before saving", form.includes("costs the job"));

await cleanup();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
