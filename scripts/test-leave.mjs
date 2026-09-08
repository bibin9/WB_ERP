/**
 * UAE annual leave, probation and notice.
 *
 * Every figure worked out by hand from Federal Decree-Law 33/2021 before the
 * code was written.
 *
 * The bug this replaced was quiet and expensive. The balance was a number on
 * the employee record, set to thirty when the record was made and decremented
 * on approval — so a man two months in showed thirty days he had not earned, a
 * man three years in still showed thirty rather than the ninety he had built
 * up, and both figures were encashed in cash in the final settlement.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import {
  ANNUAL_LEAVE_DAYS, ACCRUAL_STARTS_AFTER_MONTHS, PART_YEAR_DAYS_PER_MONTH,
  FULL_YEAR_DAYS_PER_MONTH, DEFAULT_CARRY_FORWARD_DAYS,
  MAX_PROBATION_MONTHS, PROBATION_NOTICE_DAYS, MIN_NOTICE_DAYS, MAX_NOTICE_DAYS,
  monthsOfService, accruedDays, leaveBalance, canBook,
  probationState, maxProbationEnd, noticeDaysFor,
} from "../src/lib/leave.ts";
import { computeSettlement } from "../src/lib/settlement.ts";

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;

/* =================================================== the statutory rates == */
ok("thirty days a year", ANNUAL_LEAVE_DAYS === 30);
ok("nothing accrues in the first six months", ACCRUAL_STARTS_AFTER_MONTHS === 6);
ok("months six to twelve accrue two days each", PART_YEAR_DAYS_PER_MONTH === 2);
ok("a full year accrues two and a half a month", near(FULL_YEAR_DAYS_PER_MONTH, 2.5, 0.001));
ok("probation is six months at most", MAX_PROBATION_MONTHS === 6);
ok("notice on probation is fourteen days", PROBATION_NOTICE_DAYS === 14);
ok("notice otherwise is between thirty and ninety", MIN_NOTICE_DAYS === 30 && MAX_NOTICE_DAYS === 90);

/* ================================================== months of service ===== */
ok("a month is not complete until the date comes round",
  monthsOfService(day("2026-01-15"), day("2026-07-14")) === 5,
  `${monthsOfService(day("2026-01-15"), day("2026-07-14"))} months on 14 July`);
ok("and it is complete on the day it does",
  monthsOfService(day("2026-01-15"), day("2026-07-15")) === 6);
ok("service before the join date is nil, not negative",
  monthsOfService(day("2026-06-01"), day("2026-01-01")) === 0);

/* ========================================================== the accrual === */
{
  const join = day("2026-01-01");
  ok("three months in, nothing has accrued", accruedDays(join, day("2026-04-01")) === 0,
    "the old code showed 30 days here");
  ok("at six months, twelve days", accruedDays(join, day("2026-07-01")) === 12);
  ok("at eleven months, twenty-two", accruedDays(join, day("2026-12-01")) === 22);
  ok("at a full year, thirty", accruedDays(join, day("2027-01-01")) === 30,
    `${accruedDays(join, day("2027-01-01"))}`);
  ok("at two years, sixty", accruedDays(join, day("2028-01-01")) === 60);
  ok("at three years, ninety", accruedDays(join, day("2029-01-01")) === 90,
    "the old code still showed 30");
}
ok("no join date accrues nothing rather than throwing", accruedDays(null, day("2026-01-01")) === 0);

/* ========================================================== the balance === */
{
  // Two months in: no entitlement, and the screen has to say why rather than
  // showing a bare nil.
  const b = leaveBalance(day("2026-07-01"), day("2026-09-01"), 0);
  ok("a new joiner has no balance", b.balance === 0 && b.accruing);
  ok("and is told when it starts", /six months/.test(b.note), b.note);
}
{
  // A year and a half, ten days taken: 45 accrued − 10 = 35.
  const b = leaveBalance(day("2025-03-01"), day("2026-09-01"), 10);
  ok("eighteen months accrues forty-five days", b.accrued === 45, `${b.accrued}`);
  ok("less ten taken leaves thirty-five", b.balance === 35, `${b.balance}`);
  ok("nothing has lapsed yet", b.lapsed === 0);
}
{
  // Three years, nothing taken: 90 accrued, ceiling 60, so 30 lapse — and are
  // reported, not silently dropped.
  const b = leaveBalance(day("2023-09-01"), day("2026-09-01"), 0);
  ok("the ceiling holds the balance at sixty", b.balance === 60, `${b.balance} of ${b.accrued} accrued`);
  ok("and the days lost are shown, not hidden", b.lapsed === 30, `${b.lapsed} lapsed`);
  ok("with a note that explains it", /ceiling/.test(b.note), b.note);
}
{
  // A balance brought across from whatever the company used before.
  const b = leaveBalance(day("2026-01-01"), day("2026-09-01"), 0, 12);
  ok("an opening adjustment is added to the accrual", b.balance === 12 + 16,
    `opening 12 + accrued ${b.accrued}`);
}
{
  const b = leaveBalance(null, day("2026-09-01"), 0);
  ok("no join date gives nil and says so", b.balance === 0 && /join date/i.test(b.note), b.note);
}
{
  const b = leaveBalance(day("2020-01-01"), day("2026-09-01"), 500);
  ok("taking more than was earned cannot go below nil in a useful way",
    b.balance <= 0, `${b.balance}`);
}

/* ====================================================== booking a request = */
{
  const bal = leaveBalance(day("2026-01-01"), day("2026-09-01"), 0); // 16 days
  ok("a request inside the balance is allowed", canBook("Annual", 10, bal).ok);
  const over = canBook("Annual", 20, bal);
  ok("a request beyond it is refused", !over.ok);
  ok("and says how many days there actually are", /16/.test(over.note), over.note);
}
{
  const bal = leaveBalance(day("2026-07-01"), day("2026-09-01"), 0);
  const r = canBook("Annual", 5, bal);
  ok("annual leave before six months is refused", !r.ok);
  ok("with the reason", /six months/.test(r.note), r.note);
}
{
  const bal = leaveBalance(day("2026-07-01"), day("2026-09-01"), 0);
  ok("sick leave does not draw on the annual balance", canBook("Sick", 20, bal).ok);
  ok("nor does unpaid leave", canBook("Unpaid", 30, bal).ok);
  ok("nor time off in lieu", canBook("Comp-Off", 3, bal).ok);
}

/* ============================================================= probation == */
ok("six months from joining is the longest probation allowed",
  maxProbationEnd(day("2026-01-15")).toISOString().slice(0, 10) === "2026-07-15",
  maxProbationEnd(day("2026-01-15")).toISOString().slice(0, 10));
{
  const st = probationState(day("2026-10-01"), day("2026-09-08"));
  ok("probation running is flagged as running", st.onProbation && !st.overdue);
  ok("and as ending soon when a decision is due", st.endingSoon, `${st.daysRemaining} days left`);
}
{
  const st = probationState(day("2026-08-01"), day("2026-09-08"));
  ok("a probation date that has passed is flagged", st.overdue && !st.onProbation);
}
ok("no probation date means not on probation",
  !probationState(null, day("2026-09-08")).onProbation);

/* ================================================================ notice == */
ok("notice during probation is fourteen days",
  noticeDaysFor(day("2026-10-01"), 60, day("2026-09-08")).days === 14);
ok("after probation it is the contract's figure",
  noticeDaysFor(day("2026-08-01"), 60, day("2026-09-08")).days === 60);
ok("with thirty days assumed when the contract is silent",
  noticeDaysFor(day("2026-08-01"), null, day("2026-09-08")).days === 30);
ok("a contract asking for more than ninety is held at ninety",
  noticeDaysFor(day("2026-08-01"), 120, day("2026-09-08")).days === 90);
ok("and one asking for less than thirty is held at thirty",
  noticeDaysFor(day("2026-08-01"), 10, day("2026-09-08")).days === 30);

/* ============================== unpaid leave comes out of the service ===== */
{
  // Three years to the day, of which ninety were unpaid. Gratuity is earned on
  // service, and unpaid leave is not service — so it must not be paid for.
  const base = { basicSalary: 3000, joinDate: day("2022-01-01"), lastWorkingDay: day("2025-01-01"), leaveBalanceDays: 0, separationType: "Resignation" };
  const clean = computeSettlement(base);
  const withUnpaid = computeSettlement({ ...base, unpaidLeaveDays: 90 });
  ok("three clean years reads as three years", near(clean.service.decimalYears, 3, 0.01),
    `${clean.service.decimalYears.toFixed(3)}`);
  ok("ninety unpaid days shortens the service",
    withUnpaid.service.decimalYears < clean.service.decimalYears,
    `${withUnpaid.service.decimalYears.toFixed(3)} vs ${clean.service.decimalYears.toFixed(3)}`);
  ok("and reduces the gratuity with it",
    withUnpaid.gratuity.amount < clean.gratuity.amount,
    `AED ${withUnpaid.gratuity.amount} vs AED ${clean.gratuity.amount}`);
  ok("by roughly a quarter of a year's worth",
    near(clean.gratuity.amount - withUnpaid.gratuity.amount, 21 * (3000 / 30) * (90 / 365), 5),
    `AED ${(clean.gratuity.amount - withUnpaid.gratuity.amount).toFixed(2)}`);
}
{
  // A man just over a year with three months unpaid drops under the one-year
  // threshold, which is the case that decides whether anything is owed at all.
  const s = computeSettlement({
    basicSalary: 3000, joinDate: day("2024-01-01"), lastWorkingDay: day("2025-02-01"),
    leaveBalanceDays: 0, separationType: "Resignation", unpaidLeaveDays: 100,
  });
  ok("unpaid leave can take somebody under the one-year threshold",
    !s.gratuity.eligible, s.gratuity.note);
}
{
  const s = computeSettlement({
    basicSalary: 3000, joinDate: day("2022-01-01"), lastWorkingDay: day("2025-01-01"),
    leaveBalanceDays: 0, separationType: "Resignation", unpaidLeaveDays: -50,
  });
  ok("a negative unpaid figure cannot lengthen service",
    near(s.service.decimalYears, 3, 0.01), `${s.service.decimalYears.toFixed(3)}`);
}

/* ====================================================== duplicate control = */
{
  const src = fs.readFileSync("src/app/(app)/hr/employees/actions.ts", "utf8");
  ok("a duplicate Emirates ID is checked for", /emiratesIdNo/.test(src) && /duplicate|already/i.test(src));
  ok("and a duplicate passport", /passportNo/.test(src) && /duplicate|already/i.test(src));
}

/* ============================================== against the real records == */
{
  const staff = await db.employee.findMany();
  ok("there are employees to check", staff.length > 0, `${staff.length}`);
  const asAt = new Date();

  console.log("");
  for (const e of staff) {
    const taken = await db.leaveRequest.aggregate({
      where: { employeeId: e.id, type: "Annual", status: "Approved" },
      _sum: { days: true },
    });
    const b = leaveBalance(e.joinDate, asAt, taken._sum.days ?? 0, e.annualLeaveBalance);
    console.log(`   ${e.empNo.padEnd(9)} ${e.name.padEnd(20)} ${String(b.months).padStart(3)}mo  accrued ${String(b.accrued).padStart(5)}  taken ${String(b.taken).padStart(4)}  balance ${String(b.balance).padStart(5)}${b.lapsed ? `  (${b.lapsed} lapsed)` : ""}`);
  }
  console.log("");

  const bad = [];
  for (const e of staff) {
    const b = leaveBalance(e.joinDate, asAt, 0, e.annualLeaveBalance);
    if (!Number.isFinite(b.balance) || b.balance < 0 || b.balance > b.cap) bad.push(`${e.empNo} ${b.balance}`);
  }
  ok("every balance is a real number inside the ceiling", bad.length === 0, bad.join(", ") || `${staff.length} checked`);

  // Two people cannot be the same person.
  const eids = staff.map((e) => e.emiratesIdNo).filter(Boolean);
  ok("no two employees share an Emirates ID", new Set(eids).size === eids.length,
    `${eids.length} recorded`);
  const passports = staff.map((e) => e.passportNo).filter(Boolean);
  ok("no two employees share a passport number", new Set(passports).size === passports.length,
    `${passports.length} recorded`);
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
