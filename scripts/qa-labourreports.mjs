/**
 * The overtime and manhours screens, against the real database.
 *
 * The arithmetic is held in test-labourreports.mjs. What this adds is the part
 * that only fails in production: that a genuine over-cap day, written into the
 * attendance table, actually reaches the screen. A compliance report that is
 * correct in a unit test and silent on real rows is worse than none, because
 * somebody will trust it.
 *
 * Everything it writes is removed again, whether it passes or not.
 *
 * Named qa- rather than test- because it drives the running application, like
 * qa-smoke does. The test- sweep stays headless so it can be run anywhere.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/qa-labourreports.mjs
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";
import { signSession, SESSION_COOKIE } from "../src/lib/session-token.ts";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const { overtime, manhours } = await importLibs(["overtime", "manhours"]);
const { dailyBreaches, rollingBreaches, DEFAULT_OVERTIME_POLICY } = overtime;
const { summariseManhours } = manhours;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");
const BASE = "http://localhost:3000";

const tenant = await db.tenant.findFirst();
const co = await db.company.findFirst({ where: { code: "WBE" } });
const admin = await db.user.findFirst({
  where: { tenantId: tenant.id, memberships: { some: { role: { approvalLevel: { gte: 80 } } } } },
});
const token = await signSession({ uid: admin.id, tid: tenant.id, name: admin.name, email: admin.email });
const get = async (path) => {
  const res = await fetch(BASE + path, { headers: { cookie: `${SESSION_COOKIE}=${token}` }, redirect: "manual" });
  return { status: res.status, html: await res.text() };
};

const emp = await db.employee.findFirst({ where: { companyId: co.id } });
const day = 24 * 3600 * 1000;
const iso = (d) => d.toISOString().slice(0, 10);
// A window comfortably inside the current financial year, so the default
// period picker covers it without the test having to guess the dates.
const start = new Date(Date.now() - 40 * day);
const madeAttendance = [];
let madeJob = null;

const cleanup = async () => {
  if (madeAttendance.length) {
    await db.attendance.deleteMany({ where: { id: { in: madeAttendance } } });
  }
  if (madeJob) {
    await db.timesheet.deleteMany({ where: { jobId: madeJob } });
    await db.job.delete({ where: { id: madeJob } }).catch(() => {});
  }
};
await cleanup();

try {
  /* ============ a real over-cap day reaches the screen ================== */
  const before = await get(`/hr/overtime?from=${iso(new Date(start.getTime() - 5 * day))}&to=${iso(new Date())}`);
  ok("the overtime screen renders", before.status === 200, String(before.status));

  // Four hours of overtime in one day: twice the legal cap, split across both
  // rates so the report has to add them together to see it.
  const breachDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const existing = await db.attendance.findUnique({
    where: { employeeId_date: { employeeId: emp.id, date: breachDate } },
  });
  if (!existing) {
    const row = await db.attendance.create({
      data: {
        companyId: co.id, employeeId: emp.id, date: breachDate,
        status: "Present", hours: 8, otHours: 2, otPremiumHours: 2,
      },
    });
    madeAttendance.push(row.id);
  }

  const after = await get(`/hr/overtime?from=${iso(new Date(start.getTime() - 5 * day))}&to=${iso(new Date())}`);
  ok("a day over the cap is reported on the screen",
    after.html.includes("Over the legal cap") && after.html.includes("Overtime in one day"),
    "2h ordinary + 2h premium is 4 hours against a 2 hour cap");
  ok("the person is named", after.html.includes(emp.name), emp.name);
  ok("and the verdict says it plainly", /more overtime than the law allows/.test(after.html));

  // The same rows, through the library, so the screen and the sums agree.
  const rows = await db.attendance.findMany({
    where: { companyId: co.id, date: { gte: new Date(start.getTime() - 5 * day) } },
    select: { employeeId: true, date: true, hours: true, otHours: true, otPremiumHours: true,
      employee: { select: { empNo: true, name: true } } },
  });
  const days = rows.map((a) => ({
    employeeId: a.employeeId, empNo: a.employee?.empNo ?? "—", employeeName: a.employee?.name ?? "—",
    date: a.date, hours: a.hours, otHours: a.otHours, otPremiumHours: a.otPremiumHours,
  }));
  const breaches = dailyBreaches(days, DEFAULT_OVERTIME_POLICY);
  ok("the library sees the same breach the screen shows",
    breaches.some((b) => b.employeeId === emp.id && b.otHours === 4),
    `${breaches.length} daily breaches`);
  ok("and the three-week check runs on real rows without throwing",
    Array.isArray(rollingBreaches(days, DEFAULT_OVERTIME_POLICY)));

  /* ============ manhours against a job with a budget ==================== */
  const job = await db.job.create({
    data: {
      companyId: co.id, code: `MH-${Date.now().toString().slice(-6)}`, name: "Manhours test job",
      type: "Contract", status: "Open", contractValue: 100000, budgetCost: 50000, budgetHours: 100,
    },
  });
  madeJob = job.id;
  await db.timesheet.createMany({
    data: [
      { companyId: co.id, employeeId: emp.id, jobId: job.id, date: new Date(start.getTime() + day), hours: 60, costRate: 20 },
      { companyId: co.id, employeeId: emp.id, jobId: job.id, date: new Date(start.getTime() + 2 * day), hours: 55, costRate: 20 },
    ],
  });

  const mh = await get(`/hr/manhours?from=${iso(new Date(start.getTime() - 5 * day))}&to=${iso(new Date())}`);
  ok("the manhours screen renders", mh.status === 200, String(mh.status));
  ok("the job appears with its hours", mh.html.includes(job.code) && mh.html.includes("115"));
  ok("its budget is shown", mh.html.includes("100h"));
  ok("and it is reported as over, at 115%", mh.html.includes("115%"));
  ok("the verdict names it", new RegExp(`${job.code}`).test(mh.html) && /used more hours than they were priced for/.test(mh.html));
  ok("hours not yet charged to the ledger are flagged", mh.html.includes("not charged"));

  const lines = (await db.timesheet.findMany({
    where: { companyId: co.id, jobId: job.id },
    select: { jobId: true, employeeId: true, date: true, hours: true, costRate: true, entryId: true },
  })).map((t) => ({
    jobId: t.jobId, jobCode: job.code, jobName: job.name,
    employeeId: t.employeeId, empNo: emp.empNo, employeeName: emp.name, trade: null,
    date: t.date, hours: t.hours, costRate: t.costRate, posted: !!t.entryId,
  }));
  const s = summariseManhours(lines, [{ jobId: job.id, code: job.code, name: job.name, status: "Open", budgetHours: 100 }]);
  ok("the library agrees with the screen", s.jobs[0].hours === 115 && s.jobs[0].used === 1.15,
    `${s.jobs[0].hours}h at ${s.jobs[0].used}`);
  ok("and counts the unposted hours", s.jobs[0].unpostedHours === 115);
} finally {
  await cleanup();
}

/* ============ how they are wired in ==================================== */
{
  ok("both screens are behind their own permission",
    /requireAccess\("hr\.overtime"\)/.test(read("src/app/(app)/hr/overtime/page.tsx")) &&
    /requireAccess\("hr\.manhours"\)/.test(read("src/app/(app)/hr/manhours/page.tsx")));
  ok("declared in the screen list",
    read("src/lib/rbac.ts").includes('key: "hr.overtime"') && read("src/lib/rbac.ts").includes('key: "hr.manhours"'));
  ok("granted to the HR roles rather than admins only",
    read("prisma/seed.mjs").includes('"hr.overtime"') && read("prisma/seed.mjs").includes('"hr.manhours"'));
  ok("on the HR Reports tab",
    read("src/lib/moduletabs.ts").includes('href: "/hr/overtime"') &&
    read("src/lib/moduletabs.ts").includes('href: "/hr/manhours"'));
  ok("and in the report registry",
    read("src/lib/reports.ts").includes('key: "overtime"') && read("src/lib/reports.ts").includes('key: "manhours"'));

  const otPage = read("src/app/(app)/hr/overtime/page.tsx");
  ok("the caps come from the company's policy, not a constant in the page",
    /policy\.maxOvertimeHoursPerDay/.test(otPage) && !/= 2;/.test(otPage));
  ok("and are read directly, so a user without the HR Policy screen still gets them",
    /db\.hrPolicy\.findUnique/.test(otPage) && !/policyFor/.test(otPage));
  ok("only approved payroll counts towards the cost",
    /status: \{ in: \["Approved", "Paid"\] \}/.test(otPage));

  ok("budget hours are editable on the job", read("src/components/finance/JobForm.tsx").includes('name="budgetHours"'));
  ok("and saved", read("src/app/(app)/finance/jobs/actions.ts").includes('budgetHours: num("budgetHours")'));
  ok("there is plain-English help for both",
    /id: "overtime-report"/.test(read("src/lib/help.ts")) && /id: "manhours-report"/.test(read("src/lib/help.ts")));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
