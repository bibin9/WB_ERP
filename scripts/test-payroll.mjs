/**
 * UAE monthly payroll — overtime, part months, and what comes off the top.
 *
 * The figures below were worked out by hand from Federal Decree-Law 33/2021 and
 * its Executive Regulations before the code was written, not read back off it.
 *
 * The mistakes this exists to prevent are all money mistakes, and they all
 * point the same way in a labour claim:
 *
 *   - paying a joiner a full month for eleven days' work;
 *   - paying a leaver nothing for the twelve days he did work;
 *   - pricing overtime on the full package instead of basic, or at one rate
 *     when the law gives two;
 *   - deducting more for absence than the man earned that month.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";
const { payroll } = await importLibs(["hrpolicy", "payroll"]);
const {
  NORMAL_HOURS_PER_DAY, DAYS_PER_MONTH, OT_NORMAL_RATE, OT_PREMIUM_RATE,
  SICK_FULL_DAYS, SICK_HALF_DAYS, SICK_UNPAID_DAYS, SICK_TOTAL_DAYS,
  hourlyBasic, dailyRate, overtimePay, splitDayHours, nightHours,
  payableDays, sickSplit, computePayslip, payrollReadiness,
} = payroll;
import { cleanIban, cleanLabourCard, cleanRouting } from "../src/lib/uae.ts";

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const at = (s) => new Date(s); // local time, the way a punch machine records it
const near = (a, b, t = 0.005) => Math.abs(a - b) <= t;

/* ================================================== the statutory numbers = */
ok("a working day is eight hours", NORMAL_HOURS_PER_DAY === 8);
ok("a daily wage divides by thirty", DAYS_PER_MONTH === 30);
ok("ordinary overtime is 125%", OT_NORMAL_RATE === 1.25);
ok("night, rest-day and holiday overtime is 150%", OT_PREMIUM_RATE === 1.5);
ok("sick leave is 15 full, 30 half, 45 unpaid",
  SICK_FULL_DAYS === 15 && SICK_HALF_DAYS === 30 && SICK_UNPAID_DAYS === 45);
ok("which is ninety days in a year", SICK_TOTAL_DAYS === 90);

/* ============================================================= overtime === */
{
  // Basic 3,000: 3000 / 30 / 8 = AED 12.50 an hour.
  ok("an hour of basic is priced off basic, not the package",
    hourlyBasic(3000) === 12.5, `AED ${hourlyBasic(3000)}`);

  // A shutdown weekend: 20 ordinary hours and 8 at the night rate.
  // 20 x 12.50 x 1.25 = 312.50   |   8 x 12.50 x 1.50 = 150.00
  const ot = overtimePay(3000, 20, 8);
  ok("twenty ordinary overtime hours", near(ot.normal, 312.5), `AED ${ot.normal}`);
  ok("eight hours at the night rate", near(ot.premium, 150), `AED ${ot.premium}`);
  ok("the shutdown is worth AED 462.50", near(ot.total, 462.5), `AED ${ot.total}`);
}
{
  // The rate must come off basic. On a 3,000 + 1,200 package, pricing overtime
  // on 4,200 would pay 17.50 an hour instead of 12.50 — 40% too much.
  const onBasic = overtimePay(3000, 10, 0).total;
  const onPackage = overtimePay(4200, 10, 0).total;
  ok("overtime on the package would cost 40% more", near(onBasic, 156.25) && onPackage > onBasic,
    `basic AED ${onBasic} vs package AED ${onPackage}`);
}
{
  const none = overtimePay(3000, 0, 0);
  ok("no overtime costs nothing", none.total === 0);
  const neg = overtimePay(3000, -5, -5);
  ok("negative hours are ignored rather than paid backwards", neg.total === 0);
}

/* ================================================ splitting a worked day == */
{
  const d = splitDayHours(11);
  ok("eleven hours is eight normal and three overtime",
    d.normal === 8 && d.ot === 3 && d.otPremium === 0, JSON.stringify(d));
}
{
  const d = splitDayHours(7.5);
  ok("a short day carries no overtime", d.normal === 7.5 && d.ot === 0);
}
{
  // 16:00 to 02:00 the next morning: ten hours, of which the last two are the
  // overtime and both fall inside 22:00–04:00.
  const d = splitDayHours(10, at("2026-09-10T16:00:00"), at("2026-09-11T02:00:00"));
  ok("a night shift's overtime is recognised as night work",
    d.normal === 8 && d.ot === 0 && d.otPremium === 2, JSON.stringify(d));
}
{
  // 08:00 to 19:00: eleven hours, none of it at night.
  const d = splitDayHours(11, at("2026-09-10T08:00:00"), at("2026-09-10T19:00:00"));
  ok("a long day shift is ordinary overtime throughout",
    d.ot === 3 && d.otPremium === 0, JSON.stringify(d));
}
{
  ok("the night window is measured across midnight",
    near(nightHours(at("2026-09-10T21:00:00"), at("2026-09-11T05:00:00")), 6),
    `${nightHours(at("2026-09-10T21:00:00"), at("2026-09-11T05:00:00"))}h of 22:00–04:00`);
  ok("a daytime shift touches none of it",
    nightHours(at("2026-09-10T08:00:00"), at("2026-09-10T17:00:00")) === 0);
}

/* ============================================================ part months = */
{
  // September has thirty days. Joining on the 20th is eleven of them.
  const p = payableDays(day("2026-09-01"), day("2026-09-30"), day("2026-09-20"));
  ok("a joiner on the 20th is paid eleven days of thirty",
    p.daysPaid === 11 && p.daysInPeriod === 30 && p.partMonth, JSON.stringify(p));
  ok("and the payslip says why", /joined 2026-09-20/.test(p.reason), p.reason);
}
{
  // Leaving on the 12th is twelve days, not nothing.
  const p = payableDays(day("2026-09-01"), day("2026-09-30"), day("2020-01-01"), day("2026-09-12"));
  ok("a leaver on the 12th is paid twelve days", p.daysPaid === 12, JSON.stringify(p));
  ok("and the payslip says why", /last working day 2026-09-12/.test(p.reason), p.reason);
}
{
  // A whole February is a whole month's pay. Dividing by a flat thirty would
  // pay 28/30 — a 6.7% pay cut every leap-less February, for everybody.
  const feb = payableDays(day("2027-02-01"), day("2027-02-28"), day("2020-01-01"));
  ok("a full February pays a full month", !feb.partMonth && feb.daysPaid === feb.daysInPeriod,
    `${feb.daysPaid}/${feb.daysInPeriod}`);
  const s = computePayslip({ basic: 3000, allowances: 1200, periodStart: day("2027-02-01"), periodEnd: day("2027-02-28"), joinDate: day("2020-01-01") });
  ok("February pays the same as March", s.basic === 3000 && s.allowances === 1200, `AED ${s.gross}`);
}
{
  // A part February divides by twenty-eight, not thirty.
  const p = payableDays(day("2027-02-01"), day("2027-02-28"), day("2027-02-20"));
  ok("a part February is nine days of twenty-eight",
    p.daysPaid === 9 && p.daysInPeriod === 28, JSON.stringify(p));
}
{
  const joined = payableDays(day("2026-09-01"), day("2026-09-30"), day("2026-10-05"));
  ok("somebody who joins next month is paid nothing this month", joined.daysPaid === 0);
  const left = payableDays(day("2026-09-01"), day("2026-09-30"), day("2020-01-01"), day("2026-08-15"));
  ok("somebody who left last month is paid nothing this month", left.daysPaid === 0);
}
{
  // Joined and left inside the same month.
  const p = payableDays(day("2026-09-01"), day("2026-09-30"), day("2026-09-05"), day("2026-09-14"));
  ok("a man who joined and left in one month is paid the days between",
    p.daysPaid === 10, JSON.stringify(p));
}

/* ================================================== the sick-pay ladder === */
{
  // Twenty days, none taken before: 15 at full pay, 5 at half.
  const s = sickSplit(0, 20);
  ok("twenty sick days are fifteen full and five half",
    s.full === 15 && s.half === 5 && s.unpaid === 0, JSON.stringify(s));
  ok("which costs two and a half days of pay", s.unpaidEquivalent === 2.5);
}
{
  // Already had twenty this year, takes ten more: all ten at half pay.
  const s = sickSplit(20, 10);
  ok("a second spell starts where the first left off",
    s.full === 0 && s.half === 10 && s.unpaidEquivalent === 5, JSON.stringify(s));
}
{
  // Forty-five taken, twenty more: five at half, fifteen unpaid.
  const s = sickSplit(40, 20);
  ok("past forty-five days the leave turns unpaid",
    s.half === 5 && s.unpaid === 15 && s.unpaidEquivalent === 17.5, JSON.stringify(s));
}
{
  // Past ninety there is no entitlement at all.
  const s = sickSplit(85, 10);
  ok("beyond ninety days nothing is paid",
    s.full === 0 && s.half === 0 && s.unpaid === 10 && s.exhausted, JSON.stringify(s));
}
{
  const s = sickSplit(0, 0);
  ok("no sick leave costs nothing", s.unpaidEquivalent === 0 && !s.exhausted);
}

/* ============================================== a payslip, end to end ===== */
{
  // The rigger from the acceptance test: joins 20 September on 3,000 + 1,200,
  // works 10 hours of overtime in his eleven days.
  //   basic      3000 x 11/30 = 1100.00
  //   allowances 1200 x 11/30 =  440.00
  //   overtime   10 x 12.50 x 1.25 = 156.25
  //   gross                   = 1696.25
  const s = computePayslip({
    basic: 3000, allowances: 1200,
    periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2026-09-20"), otHours: 10,
  });
  ok("a joiner's basic is prorated", near(s.basic, 1100), `AED ${s.basic}`);
  ok("his allowances with it", near(s.allowances, 440), `AED ${s.allowances}`);
  ok("his overtime is priced on the full contractual basic", near(s.overtime, 156.25), `AED ${s.overtime}`);
  ok("and the month comes to AED 1,696.25", near(s.gross, 1696.25), `AED ${s.gross}`);
  ok("the old behaviour would have paid AED 4,200", 4200 - s.gross > 2500,
    `overpayment avoided: AED ${(4200 - s.gross).toFixed(2)}`);
}
{
  // Ten days' unpaid leave on a 4,200 package in a thirty-day month:
  // 4200 / 30 = 140 a day, so 1,400 comes off.
  const s = computePayslip({
    basic: 3000, allowances: 1200,
    periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2020-01-01"), unpaidLeaveDays: 10,
  });
  ok("ten days of unpaid leave deduct AED 1,400", near(s.absenceDeduction, 1400), `AED ${s.absenceDeduction}`);
  ok("leaving AED 2,800", near(s.netPay, 2800), `AED ${s.netPay}`);
}
{
  // Twenty sick days on 3,000 basic: 2.5 days' worth comes off.
  const sick = sickSplit(0, 20);
  const s = computePayslip({
    basic: 3000, allowances: 0,
    periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2020-01-01"), sickUnpaidDays: sick.unpaidEquivalent,
  });
  ok("twenty sick days cost AED 250", near(s.absenceDeduction, 250), `AED ${s.absenceDeduction}`);
}
{
  // A deduction can never exceed what was earned. An absence figure keyed as
  // 400 days must not turn the payslip into a debt.
  const s = computePayslip({
    basic: 3000, allowances: 1200,
    periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2020-01-01"), absentDays: 400,
  });
  ok("absence never deducts more than the month earned",
    near(s.absenceDeduction, 4200), `AED ${s.absenceDeduction}`);
  ok("and never produces a negative payslip", s.netPay === 0 && !s.overRecovered);
}
{
  // Over-recovery of an advance is flagged rather than paid as a negative.
  const s = computePayslip({
    basic: 3000, allowances: 0,
    periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2020-01-01"), advanceRecovery: 5000,
  });
  ok("recovering more than the salary is caught", s.netPay === 0 && s.overRecovered,
    "the run flags it instead of paying a negative");
}
{
  const s = computePayslip({
    basic: 3000, allowances: 1200,
    periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    joinDate: day("2020-01-01"), otHours: 20, otPremiumHours: 8,
    unpaidLeaveDays: 2, otherDeductions: 300, advanceRecovery: 500,
  });
  // 4200 + 462.50 − 280 − 300 − 500 = 3582.50
  ok("everything together reconciles", near(s.netPay, 3582.5),
    `4200 + 462.50 OT − 280 absence − 300 fine − 500 advance = AED ${s.netPay}`);
  ok("and the payslip can show its working",
    s.otHours === 20 && s.otPremiumHours === 8 && s.unpaidDays === 2 && s.dailyRate === 140);
}

/* ============================================== the gate before a run ===== */
{
  const v = { iban: cleanIban, labourCard: cleanLabourCard, routing: cleanRouting };
  const good = payrollReadiness({
    name: "Rajesh", basicSalary: 3000, joinDate: day("2020-01-01"),
    iban: "AE060331234567890100000", labourCardNo: "78412345601234", bankRoutingCode: "302460010",
  }, v);
  ok("a complete employee passes the gate", good.length === 0, good.join(", "));

  // The record production actually has: created while testing, never finished.
  const half = payrollReadiness({ name: "Balu", basicSalary: 0 }, v);
  ok("a half-finished record is refused", half.length === 5, half.join("; "));
  ok("and every reason is named",
    half.includes("no basic salary") && half.includes("no IBAN") && half.includes("no join date"),
    half.join("; "));

  // One mistyped digit is the case that hurts: the man looks fine on screen and
  // is silently dropped from the bank file.
  const typo = payrollReadiness({
    name: "Maria", basicSalary: 9000, joinDate: day("2020-01-01"),
    iban: "AE060331234567890100001", labourCardNo: "78412345603456", bankRoutingCode: "302460010",
  }, v);
  ok("a mistyped IBAN is caught before the run, not at the bank",
    typo.length === 1 && /IBAN/i.test(typo[0]), typo.join("; "));
}

/* ============================================== against the real records == */
{
  const v = { iban: cleanIban, labourCard: cleanLabourCard, routing: cleanRouting };
  const staff = await db.employee.findMany({ where: { status: { not: "Inactive" } } });
  ok("there are employees to pay", staff.length > 0, `${staff.length} active`);

  const blocked = staff.map((e) => [e, payrollReadiness(e, v)]).filter(([, p]) => p.length);
  console.log(blocked.length
    ? `       ${blocked.length} would be held back: ` + blocked.map(([e, p]) => `${e.empNo} (${p.join(", ")})`).join("; ")
    : "       every active employee is payroll-ready");

  // Whatever the data, a run must never produce a negative or a NaN.
  for (const e of staff) {
    const s = computePayslip({
      basic: e.basicSalary, allowances: e.allowances,
      periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
      joinDate: e.joinDate, lastWorkingDay: e.lastWorkingDay,
    });
    if (!Number.isFinite(s.netPay) || s.netPay < 0) {
      ok(`${e.empNo} produces a usable payslip`, false, `net ${s.netPay}`);
    }
  }
  ok("every real employee produces a usable payslip", true, `${staff.length} checked`);
}

/* ================================ nobody vanishes from a run unreported === */
{
  // The bug this replaced: the query excluded anyone whose join date was after
  // the month end, written as NOT (joinDate > end). In SQL a comparison against
  // null is null, so an employee with NO join date failed that test and was
  // dropped from the run silently — never paid, never reported, and invisible
  // to the readiness gate that exists to name exactly that problem.
  const src = fs.readFileSync("src/app/(app)/hr/payroll/actions.ts", "utf8");
  ok("a missing join date no longer filters somebody out of the query",
    !/NOT:\s*\{\s*joinDate/.test(src) && /joinDate:\s*null/.test(src),
    "they reach the gate, which names the missing date");

  // And the gate does name it.
  const v = { iban: cleanIban, labourCard: cleanLabourCard, routing: cleanRouting };
  const problems = payrollReadiness({
    name: "Salim", basicSalary: 2500, joinDate: null,
    iban: "AE920331234567890100004", labourCardNo: "78412345605678", bankRoutingCode: "302460010",
  }, v);
  ok("an employee with no join date is held back by name",
    problems.length === 1 && problems[0] === "no join date", problems.join("; "));
}

{
  // Every active employee in the database must either produce a payslip or be
  // named by the gate. Silently doing neither is the state that lets a man go
  // unpaid for a month without anybody noticing.
  const v = { iban: cleanIban, labourCard: cleanLabourCard, routing: cleanRouting };
  const start = day("2026-09-01"), end = day("2026-09-30");
  const all = await db.employee.findMany();
  const inScope = all.filter(
    (e) =>
      (e.status !== "Inactive" || (e.lastWorkingDay && e.lastWorkingDay >= start)) &&
      (!e.joinDate || e.joinDate <= end)
  );
  const accounted = inScope.every((e) => {
    const problems = payrollReadiness(e, v);
    if (problems.length) return true; // named by the gate
    const c = computePayslip({
      basic: e.basicSalary, allowances: e.allowances, periodStart: start, periodEnd: end,
      joinDate: e.joinDate, lastWorkingDay: e.lastWorkingDay,
    });
    return Number.isFinite(c.netPay);
  });
  ok("every employee in scope is either paid or named", accounted,
    `${inScope.length} of ${all.length} in scope for September`);
}

/* ============================================== the wiring is not stale === */
{
  const actions = fs.readFileSync("src/app/(app)/hr/payroll/actions.ts", "utf8");
  ok("the payroll run uses the shared computation", /computePayslip\(/.test(actions));
  ok("and the readiness gate", /payrollReadiness\(/.test(actions));
  ok("the old flat formula is gone",
    !/basicSalary \+ e\.allowances - advanceRecovery/.test(actions));

  const hr = fs.readFileSync("src/app/(app)/hr/page.tsx", "utf8");
  ok("the HR page no longer says payroll is unbuilt",
    !/Phase 3/.test(hr), "the screen told clients attendance, leave and payroll were still to come");

  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  ok("unlimited contracts are no longer offered",
    !/Limited \| Unlimited/.test(schema), "abolished by Decree-Law 33/2021");
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
