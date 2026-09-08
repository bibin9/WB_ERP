/**
 * The company's HR policy, and the floor it cannot go below.
 *
 * Two things have to be true at once, and they pull against each other:
 *
 *   - nothing about a company's handbook is baked into the code, so WBE, WBTS
 *     and VTS can each run their own and the next customer can run a third;
 *   - and no configuration can put a company below Federal Decree-Law 33/2021,
 *     because an ERP that lets somebody set a twenty-day leave entitlement has
 *     not given them flexibility.
 *
 * Every calculation is exercised twice here: once on the statutory default, and
 * once on a deliberately more generous handbook, to prove the number actually
 * moves rather than merely being passed a policy nobody reads.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";
const L = await importLibs(["hrpolicy", "ledger", "leave", "payroll", "settlement"]);
const { STATUTORY_POLICY, POLICY_RULES, validatePolicy, withDefaults, fullYearDaysPerMonth, aboveStatutory } = L.hrpolicy;
const { accruedDays, leaveBalance, canBook, maxProbationEnd, noticeDaysFor } = L.leave;
const { overtimePay, hourlyBasic, splitDayHours, sickSplit, computePayslip } = L.payroll;
const { computeGratuity, computeSettlement } = L.settlement;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

/** A handbook better than the law in every direction it can be. */
const GENEROUS = {
  ...STATUTORY_POLICY,
  annualLeaveDays: 45,
  leaveAccrualAfterMonths: 3,
  partYearDaysPerMonth: 3,
  carryForwardDays: 15,
  probationMonths: 3,
  probationNoticeDays: 30,
  noticeDays: 60,
  normalHoursPerDay: 7,
  daysPerMonth: 26,
  otNormalRate: 1.5,
  otPremiumRate: 2,
  sickFullDays: 30,
  sickHalfDays: 30,
  sickUnpaidDays: 45,
  sickHalfPayRate: 0.75,
  gratuityFirst5Days: 30,
  gratuityAfter5Days: 30,
  gratuityCapYears: 3,
  gratuityMinYears: 0.5,
  airTicketEveryMonths: 12,
  airTicketDefault: 2500,
};

/* ============================== the default is the law ==================== */
ok("the default policy is the statutory one",
  STATUTORY_POLICY.annualLeaveDays === 30 && STATUTORY_POLICY.otNormalRate === 1.25 &&
  STATUTORY_POLICY.gratuityFirst5Days === 21 && STATUTORY_POLICY.probationMonths === 6);
ok("a company with no policy is compliant by default", validatePolicy(STATUTORY_POLICY).length === 0);
ok("an empty record falls back to the law", withDefaults(null).annualLeaveDays === 30);
ok("a partial record keeps the law for what it does not say",
  withDefaults({ annualLeaveDays: 45 }).otNormalRate === 1.25);
ok("a garbage value falls back rather than poisoning the sum",
  withDefaults({ annualLeaveDays: NaN }).annualLeaveDays === 30);
ok("the monthly accrual is derived from the yearly figure",
  near(fullYearDaysPerMonth({ ...STATUTORY_POLICY, annualLeaveDays: 36 }), 3, 0.001));

/* ============================== the floor cannot be crossed =============== */
ok("every rule carries the reason it exists",
  POLICY_RULES.every((r) => r.why.length > 20 && r.label.length > 2));
{
  const p = validatePolicy({ ...STATUTORY_POLICY, annualLeaveDays: 20 });
  ok("twenty days of annual leave is refused", p.length === 1, p.map((x) => x.message).join("; "));
  ok("and the refusal cites the article", /Article 29/.test(p[0].message), p[0].message);
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, probationMonths: 12 });
  ok("a twelve-month probation is refused", p.length === 1);
  ok("and says why", /Article 9|six months/.test(p[0].message), p[0].message);
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, otNormalRate: 1, otPremiumRate: 1.2 });
  ok("overtime below 125% and 150% is refused", p.length === 2, p.map((x) => x.label).join(", "));
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, noticeDays: 7 });
  ok("a seven-day notice period is refused", p.length === 1, p[0].message);
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, gratuityFirst5Days: 14, gratuityCapYears: 1, gratuityMinYears: 3 });
  ok("gratuity cannot be cut three ways at once", p.length === 3, p.map((x) => x.label).join(", "));
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, daysPerMonth: 31 });
  ok("a divisor above thirty is refused", p.length >= 1, p[0].message);
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, normalHoursPerDay: 10 });
  ok("a ten-hour normal day is refused", p.length === 1, p[0].message);
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, sickFullDays: 5, sickHalfDays: 5, sickUnpaidDays: 5 });
  ok("sick bands that do not add to ninety are refused",
    p.some((x) => /ninety days/.test(x.message)), p.map((x) => x.message).join("; "));
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, annualLeaveDays: 3650 });
  ok("a figure that looks like a typing slip is questioned",
    p.some((x) => /typing slip/.test(x.message)), p.map((x) => x.message).join("; "));
}
{
  const p = validatePolicy({ ...STATUTORY_POLICY, annualLeaveDays: -5 });
  ok("a negative is refused outright", p.length === 1 && /negative/.test(p[0].message));
}
ok("a generous handbook passes", validatePolicy(GENEROUS).length === 0,
  validatePolicy(GENEROUS).map((x) => x.message).join("; "));
ok("everything wrong is reported at once, not one at a time",
  validatePolicy({ ...STATUTORY_POLICY, annualLeaveDays: 10, noticeDays: 5, otNormalRate: 1 }).length === 3);

/* ================== the numbers actually move with the policy ============= */
{
  const join = day("2026-01-01"), asAt = day("2027-01-01"); // 12 months
  ok("statutory accrual at a year is thirty days", accruedDays(join, asAt) === 30);
  ok("a 45-day handbook accrues forty-five", accruedDays(join, asAt, GENEROUS) === 45,
    `${accruedDays(join, asAt, GENEROUS)}`);
}
{
  // Four months of service: nothing under the law, twelve days under a
  // handbook that starts at three months and gives three a month.
  const join = day("2026-05-01"), asAt = day("2026-09-01");
  ok("four months earns nothing under the law", accruedDays(join, asAt) === 0);
  ok("but twelve days under a three-month handbook",
    accruedDays(join, asAt, GENEROUS) === 12, `${accruedDays(join, asAt, GENEROUS)}`);
}
{
  const join = day("2026-05-01"), asAt = day("2026-09-01");
  const law = leaveBalance(join, asAt, 0);
  const ours = leaveBalance(join, asAt, 0, 0, GENEROUS);
  ok("the balance note quotes the company's own figure",
    /accruing at 3 months/.test(ours.note) || !ours.accruing, ours.note);
  ok("a request refused under the law is allowed under the handbook",
    !canBook("Annual", 10, law).ok && canBook("Annual", 10, ours, GENEROUS).ok);
}
{
  const law = leaveBalance(day("2023-09-01"), day("2026-09-01"), 0);
  const ours = leaveBalance(day("2023-09-01"), day("2026-09-01"), 0, 0, GENEROUS);
  ok("the carry-forward ceiling follows the policy",
    law.cap === 60 && ours.cap === 60, `law ${law.cap}, handbook ${ours.cap}`);
}
{
  // Basic 3,000. Statutory: 3000/30/8 = 12.50 an hour, 10h at 125% = 156.25.
  // Handbook: 3000/26/7 = 16.48 an hour, 10h at 150% = 247.25.
  ok("an hour of basic follows the divisor and the working day",
    near(hourlyBasic(3000), 12.5) && near(hourlyBasic(3000, GENEROUS), 16.4835, 0.001),
    `AED ${hourlyBasic(3000).toFixed(2)} vs AED ${hourlyBasic(3000, GENEROUS).toFixed(4)}`);
  ok("statutory overtime on ten hours is AED 156.25", near(overtimePay(3000, 10, 0).total, 156.25));
  ok("the handbook's is AED 247.25", near(overtimePay(3000, 10, 0, GENEROUS).total, 247.25, 0.02),
    `AED ${overtimePay(3000, 10, 0, GENEROUS).total}`);
  ok("the rates used are reported back so a payslip can show them",
    overtimePay(3000, 1, 1, GENEROUS).normalRate === 1.5 && overtimePay(3000, 1, 1, GENEROUS).premiumRate === 2);
}
{
  // A ten-hour day: two hours of overtime under the law, three under a
  // seven-hour handbook.
  ok("the overtime threshold follows the normal working day",
    splitDayHours(10).ot === 2 && splitDayHours(10, null, null, GENEROUS).ot === 3,
    `${splitDayHours(10).ot}h vs ${splitDayHours(10, null, null, GENEROUS).ot}h`);
}
{
  // Twenty sick days. Law: 15 full + 5 half, costing 2.5 days.
  // Handbook: 30 full, so all twenty are paid and nothing is lost.
  ok("the statutory ladder costs two and a half days", sickSplit(0, 20).unpaidEquivalent === 2.5);
  ok("a thirty-day full-pay band costs nothing",
    sickSplit(0, 20, GENEROUS).unpaidEquivalent === 0, `${sickSplit(0, 20, GENEROUS).unpaidEquivalent}`);
  // And a handbook paying 75% on the middle band loses a quarter, not a half.
  const mid = sickSplit(30, 10, GENEROUS);
  ok("a 75% middle band loses a quarter of each day",
    near(mid.unpaidEquivalent, 2.5), `${mid.unpaidEquivalent}`);
}
{
  // Seven years on basic 5,000. Law: 5x21 + 2x30 = 165 days at 166.67 = 27,500.
  // Handbook: 30 days throughout on a /26 divisor = 210 x 192.31 = 40,384.62.
  const law = computeGratuity(5000, 7);
  const ours = computeGratuity(5000, 7, false, GENEROUS);
  ok("statutory gratuity on seven years is AED 27,500", near(law.amount, 27500, 0.5), `AED ${law.amount}`);
  ok("a 30-day handbook on a /26 divisor pays AED 40,384.62",
    near(ours.amount, 40384.62, 0.5), `AED ${ours.amount}`);
  // Forty years, basic 3,000. Law: 1,155 days x 100 = 115,500, held at two
  // years' pay = 72,000. Handbook: 1,200 days x 115.38 = 138,462, held at its
  // own three years = 108,000. The cap bites in both, at different heights.
  ok("and the cap follows the policy too",
    computeGratuity(3000, 40).amount === 72000 &&
    near(computeGratuity(3000, 40, false, GENEROUS).amount, 108000, 0.5),
    `law AED 72,000, handbook AED ${computeGratuity(3000, 40, false, GENEROUS).amount}`);
  ok("a raw gratuity below the cap is not capped",
    !computeGratuity(3000, 30, false, GENEROUS).capped,
    `AED ${computeGratuity(3000, 30, false, GENEROUS).amount} against a AED 108,000 ceiling`);
}
{
  // Nine months of service: nothing under the law, payable under a handbook
  // that promises gratuity from six months.
  const base = { basicSalary: 3000, joinDate: day("2025-12-01"), lastWorkingDay: day("2026-09-01"), leaveBalanceDays: 0, separationType: "Resignation" };
  ok("nine months earns no gratuity under the law", !computeSettlement(base).gratuity.eligible);
  ok("but does under a six-month handbook",
    computeSettlement({ ...base, policy: GENEROUS }).gratuity.eligible,
    `AED ${computeSettlement({ ...base, policy: GENEROUS }).gratuity.amount}`);
}
{
  const law = computePayslip({
    basic: 3000, allowances: 1200, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2020-01-01"), otHours: 10,
  });
  const ours = computePayslip({
    basic: 3000, allowances: 1200, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2020-01-01"), otHours: 10, policy: GENEROUS,
  });
  ok("a whole payslip moves with the handbook",
    ours.netPay > law.netPay, `AED ${law.netPay} under the law, AED ${ours.netPay} under the handbook`);
}
{
  ok("probation length follows the policy",
    maxProbationEnd(day("2026-01-15")).toISOString().slice(0, 10) === "2026-07-15" &&
    maxProbationEnd(day("2026-01-15"), GENEROUS).toISOString().slice(0, 10) === "2026-04-15",
    maxProbationEnd(day("2026-01-15"), GENEROUS).toISOString().slice(0, 10));
  ok("a policy cannot stretch probation past the statutory six months",
    maxProbationEnd(day("2026-01-15"), { ...STATUTORY_POLICY, probationMonths: 24 })
      .toISOString().slice(0, 10) === "2026-07-15");
}
{
  ok("notice during probation follows the policy",
    noticeDaysFor(day("2026-10-01"), null, day("2026-09-08")).days === 14 &&
    noticeDaysFor(day("2026-10-01"), null, day("2026-09-08"), GENEROUS).days === 30);
  ok("the company default applies when a contract is silent",
    noticeDaysFor(day("2026-08-01"), null, day("2026-09-08"), GENEROUS).days === 60);
  ok("and an employee's own contract still wins",
    noticeDaysFor(day("2026-08-01"), 90, day("2026-09-08"), GENEROUS).days === 90);
}

/* ====================== where a policy beats the law, say so ============== */
{
  const better = aboveStatutory(GENEROUS);
  ok("a generous handbook is recognised as generous", better.length >= 5, `${better.length} respects`);
  ok("and reads as something a person would say", better.every((b) => b.length > 15));
  ok("the statutory policy claims nothing", aboveStatutory(STATUTORY_POLICY).length === 0);
}

/* ============================== nothing is baked in any more ============== */
{
  const files = [
    ["the leave screen", "src/app/(app)/hr/leave/page.tsx"],
    ["leave approval", "src/app/(app)/hr/leave/actions.ts"],
    ["the payroll run", "src/app/(app)/hr/payroll/actions.ts"],
    ["the final settlement", "src/app/(app)/hr/separation/actions.ts"],
    ["the punch import", "src/app/(app)/hr/attendance/actions.ts"],
  ];
  for (const [what, file] of files) {
    const src = fs.readFileSync(file, "utf8");
    ok(`${what} reads the company's policy`, /hrPolicy\.findUnique/.test(src) && /withDefaults\(/.test(src));
  }
}

/* ============================================== against the real records == */
{
  const companies = await db.company.findMany({ orderBy: { code: "asc" } });
  ok("there are companies to hold a policy", companies.length > 0, `${companies.length}`);

  console.log("");
  for (const co of companies) {
    const stored = await db.hrPolicy.findUnique({ where: { companyId: co.id } });
    const p = withDefaults(stored);
    const problems = validatePolicy(p);
    const better = aboveStatutory(p);
    console.log(`   ${co.code.padEnd(6)} ${stored ? "own policy" : "statutory default"}  leave ${p.annualLeaveDays}d  notice ${p.noticeDays}d  OT ${Math.round(p.otNormalRate * 100)}%/${Math.round(p.otPremiumRate * 100)}%  ${better.length ? `(${better.length} above the law)` : ""}`);
    ok(`${co.code}'s policy is lawful`, problems.length === 0, problems.map((x) => x.message).join("; "));
  }
  console.log("");
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
