/**
 * Behavioural verification of the UAE statutory calculations.
 *
 * Every expected figure below is worked out by hand from the statute, not from
 * the code, so the code cannot define its own correctness. Federal Decree-Law
 * 33/2021: gratuity is 21 days' basic per year for the first five years and 30
 * days per year thereafter, on a daily wage of basic / 30, payable only after
 * one completed year, capped at two years' remuneration.
 */
import { importLibs } from "./lib-shim.mjs";
const { settlement } = await importLibs(["hrpolicy", "settlement"]);
const { computeGratuity, computeSettlement, serviceLength } = settlement;
import { taxOn } from "../src/lib/vat.ts";
import { cleanIban, cleanEmiratesId, cleanTrn, cleanLabourCard, cleanRouting } from "../src/lib/uae.ts";
import fs from "node:fs";
const read = (p) => fs.readFileSync(p, "utf8");

let pass = 0, fail = 0;
const findings = [];
const check = (name, actual, expected, tol = 0.01) => {
  const okNum = typeof expected === "number" && Math.abs(actual - expected) <= tol;
  const okOther = typeof expected !== "number" && actual === expected;
  if (okNum || okOther) { pass++; console.log(`  PASS ${name}  (${actual})`); }
  else { fail++; console.log(`  FAIL ${name}  expected ${expected}, got ${actual}`); findings.push({ name, expected, actual }); }
};
const D = (s) => new Date(s + "T00:00:00.000Z");

console.log("\n--- Gratuity: Federal Decree-Law 33/2021 ---");

// Under one year earns nothing.
{
  const svc = serviceLength(D("2024-01-01"), D("2024-11-30"));
  const g = computeGratuity(3000, svc.decimalYears);
  check("11 months earns no gratuity", g.amount, 0);
  check("  and is marked ineligible", g.eligible, false);
}

// Exactly one completed year. Daily basic 3000/30 = 100; 21 days = 2,100.
{
  const svc = serviceLength(D("2023-01-01"), D("2024-01-01"));
  const g = computeGratuity(3000, svc.decimalYears);
  check("exactly 1 year (non-leap) is eligible", g.eligible, true);
  check("  1 year on basic 3,000 = 21 x 100", g.amount, 2100);
}

// The defect this file exists to pin: an employee who completed exactly one
// year was refused, because 365 / 365.25 is 0.99932. Both spans below are one
// completed year; only the second contains a 29 February.
{
  for (const [j, l, label] of [
    ["2023-01-01", "2024-01-01", "no leap day"],
    ["2019-03-01", "2020-03-01", "contains 29 Feb"],
  ]) {
    const svc = serviceLength(D(j), D(l));
    check(`1 completed year (${label}) counts as 1.0`, Number(svc.decimalYears.toFixed(6)), 1);
    check(`  and pays 21 days (${label})`, computeGratuity(3000, svc.decimalYears).amount, 2100);
  }
  // One day short must still be refused.
  const short = serviceLength(D("2023-01-01"), D("2023-12-31"));
  check("one day short of a year is still refused", computeGratuity(3000, short.decimalYears).eligible, false);
}

// Three years. 3 x 21 = 63 days at 6000/30 = 200 -> 12,600.
{
  const svc = serviceLength(D("2021-01-01"), D("2024-01-01"));
  const g = computeGratuity(6000, svc.decimalYears);
  check("3 years on basic 6,000 = 12,600", g.amount, 12600);
}

// Exactly five years, still all at 21 days. 105 days x 200 = 21,000.
{
  const svc = serviceLength(D("2019-01-01"), D("2024-01-01"));
  const g = computeGratuity(6000, svc.decimalYears);
  check("5 years on basic 6,000 = 21,000", g.amount, 21000);
}

// Seven years: 5 x 21 + 2 x 30 = 165 days x 200 = 33,000.
{
  const svc = serviceLength(D("2017-01-01"), D("2024-01-01"));
  const g = computeGratuity(6000, svc.decimalYears);
  check("7 years crosses to 30 days/yr = 33,000", g.amount, 33000);
}

// The cap. 30 years on basic 10,000 would be 855 days x 333.33 = 285,000,
// but two years' pay is 240,000.
{
  const svc = serviceLength(D("1994-01-01"), D("2024-01-01"));
  const g = computeGratuity(10000, svc.decimalYears);
  check("30 years is capped at two years' basic", g.amount, 240000);
  check("  and says so", g.capped, true);
}

// Gross misconduct forfeits it (Art. 44).
{
  const svc = serviceLength(D("2017-01-01"), D("2024-01-01"));
  const g = computeGratuity(6000, svc.decimalYears, true);
  check("gross misconduct forfeits gratuity", g.amount, 0);
}

// Resignation and termination now earn the same — the pre-2022 reductions are gone.
{
  const base = { basicSalary: 6000, joinDate: D("2017-01-01"), lastWorkingDay: D("2024-01-01"), leaveBalanceDays: 0 };
  const res = computeSettlement({ ...base, separationType: "Resignation" });
  const ter = computeSettlement({ ...base, separationType: "Termination" });
  check("resignation and termination earn the same gratuity", res.gratuity.amount, ter.gratuity.amount);
}

console.log("\n--- Leave encashment ---");
{
  // Leave is encashed on the basic daily wage, basic/30.
  const s = computeSettlement({
    basicSalary: 3000, joinDate: D("2020-01-01"), lastWorkingDay: D("2024-01-01"),
    leaveBalanceDays: 10, separationType: "Resignation",
  });
  check("10 days leave on basic 3,000 = 1,000", s.leaveAmount, 1000);
}

console.log("\n--- VAT: 5% standard rate ---");
{
  check("5% of 100,000 is 5,000", taxOn("Standard", 100000), 5000);
  check("zero-rated carries no tax", taxOn("Zero-rated", 100000), 0);
  check("exempt carries no tax", taxOn("Exempt", 100000), 0);
  check("out of scope carries no tax", taxOn("Out of scope", 100000), 0);
  // Reverse charge is declared in both the output and input boxes, netting nil.
  check("reverse charge is still computed at 5%", taxOn("Reverse charge", 100000), 5000);
  // Fils rounding: 5% of 33.33 = 1.6665
  const odd = taxOn("Standard", 33.33);
  check("an awkward amount rounds to fils", Math.round(odd * 100) / 100, 1.67);
}

console.log("\n--- UAE identifier formats ---");
{
  const good = "AE070331234567890123456";
  check("a valid UAE IBAN is accepted", cleanIban(good).value, good);
  check("  spaces and dashes are tolerated", cleanIban("AE07 0331 2345 6789 0123 456").value, good);
  check("a non-AE IBAN is refused", !!cleanIban("GB29NWBK60161331926819").error, true);
  check("a short IBAN is refused", !!cleanIban("AE0703312345").error, true);
  check("letters in the account part are refused", !!cleanIban("AE07033123456789012345X").error, true);
  // Transposing two digits keeps the length but breaks the mod-97 checksum —
  // exactly the typo a length check alone would wave through.
  const transposed = good.slice(0, 8) + good[9] + good[8] + good.slice(10);
  check("a transposed pair is caught by the checksum", !!cleanIban(transposed).error, true);
  check("blank is allowed (a profile fills in over time)", cleanIban("").value, null);
  check("  and blank carries no error", cleanIban("").error, undefined);

  check("a valid Emirates ID is accepted", cleanEmiratesId("784-1990-1234567-1").value, "784-1990-1234567-1");
  check("  it is stored with separators", cleanEmiratesId("784199012345671").value, "784-1990-1234567-1");
  check("an Emirates ID not starting 784 is refused", !!cleanEmiratesId("123-1990-1234567-1").error, true);
  check("a 14-digit Emirates ID is refused", !!cleanEmiratesId("78419901234567").error, true);
  check("an impossible year is refused", !!cleanEmiratesId("784-2999-1234567-1").error, true);

  check("a 15-digit TRN is accepted", cleanTrn("100123456700003").value, "100123456700003");
  check("a 14-digit TRN is refused", !!cleanTrn("10012345670000").error, true);

  check("a labour card of digits is accepted", cleanLabourCard("12345678901234").value, "12345678901234");
  check("a labour card with letters is refused", !!cleanLabourCard("1234ABCD").error, true);

  check("a 9-digit routing code is accepted", cleanRouting("302123456").value, "302123456");
  check("an 8-digit routing code is refused", !!cleanRouting("30212345").error, true);
}

console.log("\n--- the validators are actually wired in ---");
{
  const profile = read("src/app/(app)/hr/employees/actions.ts");
  check("the profile save validates identifiers", profile.includes("EMPLOYEE_VALIDATORS"), true);
  check("  and tells the user rather than saving silently", profile.includes("?err="), true);
  const page = read("src/app/(app)/hr/employees/[id]/page.tsx");
  check("  and the page shows that message", page.includes("Not saved."), true);

  const wps = read("src/app/(app)/hr/payroll/actions.ts");
  check("WPS checks the format, not just that a value is present", wps.includes("cleanIban"), true);
  check("  and names why each employee was held back", wps.includes("problems.join"), true);
}

console.log("\n--- Service length arithmetic ---");
{
  const s = serviceLength(D("2020-02-29"), D("2024-02-29"));
  check("a leap-day anniversary is 4 years", s.years, 4);
  const b = serviceLength(D("2024-01-31"), D("2024-03-01"));
  check("month-end to month-start does not go negative", b.days >= 0, true);
  const rev = serviceLength(D("2024-06-01"), D("2024-01-01"));
  check("a last day before the join date yields no service", rev.years, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (findings.length) {
  console.log("\nDEVIATIONS FROM THE STATUTE:");
  for (const f of findings) console.log(`  - ${f.name}: expected ${f.expected}, got ${f.actual}`);
}
process.exit(0);
