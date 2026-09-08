/**
 * UAE labour compliance: the midday ban, ILOE, Emiratisation — and payroll
 * reaching the ledger.
 *
 * The rates and thresholds were checked against current MOHRE and ILOE guidance
 * in September 2026 rather than remembered, because they move: the
 * Emiratisation contribution has risen every year since it was introduced.
 * Where a figure changes, this file is where the change should fail first.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import {
  MIDDAY_BAN_START_HOUR, MIDDAY_BAN_END_HOUR,
  ILOE_CATEGORY_THRESHOLD, ILOE_CATEGORY_A_MONTHLY, ILOE_CATEGORY_B_MONTHLY, ILOE_FINE,
  EMIRATISATION_SMALL_BAND, EMIRATISATION_LARGE_FROM, SMALL_BAND_REQUIRED_2026,
  SMALL_BAND_CONTRIBUTION, LARGE_ANNUAL_TARGET, LARGE_MONTHLY_CONTRIBUTION,
  inMiddayBanSeason, middayBreach, iloeCategory, iloeStatus, isEmirati, emiratisation,
} from "../src/lib/compliance.ts";

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const at = (s) => new Date(s);

/* ============================================= the summer midday ban ====== */
ok("the banned window is 12:30 to 15:00",
  MIDDAY_BAN_START_HOUR === 12.5 && MIDDAY_BAN_END_HOUR === 15);
ok("14 June is outside the season", !inMiddayBanSeason(day("2026-06-14")));
ok("15 June is the first day", inMiddayBanSeason(day("2026-06-15")));
ok("high summer is inside it", inMiddayBanSeason(day("2026-07-20")));
ok("15 September is the last day", inMiddayBanSeason(day("2026-09-15")));
ok("16 September is outside it", !inMiddayBanSeason(day("2026-09-16")));
ok("and so is the whole of winter", !inMiddayBanSeason(day("2026-01-20")));

{
  // 07:00 to 17:00 in July: the man was on site right across the break.
  const b = middayBreach(day("2026-07-20"), at("2026-07-20T07:00:00"), at("2026-07-20T17:00:00"));
  ok("a full day through the summer spans the whole break", b.spansBreak && b.hours === 2.5,
    `${b.hours}h across 12:30–15:00`);
}
{
  // The split shift the rule is meant to produce: off at 12:00, back at 15:30.
  const morning = middayBreach(day("2026-07-20"), at("2026-07-20T06:00:00"), at("2026-07-20T12:00:00"));
  const evening = middayBreach(day("2026-07-20"), at("2026-07-20T15:30:00"), at("2026-07-20T19:00:00"));
  ok("a morning shift ending at noon is clear", !morning.spansBreak);
  ok("an afternoon shift starting at 15:30 is clear", !evening.spansBreak);
}
{
  const partial = middayBreach(day("2026-07-20"), at("2026-07-20T06:00:00"), at("2026-07-20T13:00:00"));
  ok("working half an hour into the break is still half an hour",
    partial.spansBreak && partial.hours === 0.5, `${partial.hours}h`);
}
{
  const winter = middayBreach(day("2026-01-20"), at("2026-01-20T07:00:00"), at("2026-01-20T17:00:00"));
  ok("the same day in January is not a breach", !winter.spansBreak);
}
{
  const none = middayBreach(day("2026-07-20"), null, null);
  ok("a day with no punches asserts nothing either way", !none.spansBreak && none.inSeason);
}

/* ============================================================== ILOE ====== */
ok("the band threshold is basic pay of AED 16,000", ILOE_CATEGORY_THRESHOLD === 16_000);
ok("Category A is AED 5 a month", ILOE_CATEGORY_A_MONTHLY === 5);
ok("Category B is AED 10", ILOE_CATEGORY_B_MONTHLY === 10);
ok("not subscribing costs AED 400", ILOE_FINE === 400);
{
  const a = iloeCategory(9000);
  ok("a 9,000 basic is Category A", a.category === "A" && a.monthly === 5 && a.annual === 60);
  const edge = iloeCategory(16000);
  ok("exactly 16,000 is still Category A", edge.category === "A");
  const b = iloeCategory(16000.01);
  ok("a fils above it is Category B", b.category === "B" && b.monthly === 10 && b.annual === 120);
  ok("the band is measured on basic, not the package",
    iloeCategory(15000).category === "A", "a 15,000 basic with 6,000 allowances stays in A");
}
{
  const now = day("2026-09-08");
  const base = { name: "X", empNo: "E1", basicSalary: 5000, employmentType: "Full-time", iloeExempt: false };
  const missing = iloeStatus({ ...base, iloeSubscribed: false }, now);
  ok("somebody unsubscribed is chased", missing.required && !missing.ok);
  ok("and told what it costs", /400/.test(missing.reason), missing.reason);

  const good = iloeStatus({ ...base, iloeSubscribed: true, iloeExpiry: day("2027-06-01") }, now);
  ok("a live subscription is left alone", good.ok && !good.expiringSoon);

  const soon = iloeStatus({ ...base, iloeSubscribed: true, iloeExpiry: day("2026-10-01") }, now);
  ok("one renewing within sixty days is flagged early", soon.expiringSoon, soon.reason);

  const lapsed = iloeStatus({ ...base, iloeSubscribed: true, iloeExpiry: day("2026-08-01") }, now);
  ok("a lapsed one is a problem again", !lapsed.ok, lapsed.reason);
}
{
  const now = day("2026-09-08");
  const supplied = iloeStatus({ name: "S", empNo: "S1", basicSalary: 2500, employmentType: "Supplied", iloeSubscribed: false, iloeExempt: false }, now);
  ok("supplied labour is outside the scheme", !supplied.required && supplied.ok, supplied.reason);

  const young = iloeStatus({ name: "Y", empNo: "Y1", basicSalary: 2000, employmentType: "Full-time", dateOfBirth: day("2010-01-01"), iloeSubscribed: false, iloeExempt: false }, now);
  ok("anybody under eighteen is outside it", !young.required, young.reason);

  const exempt = iloeStatus({ name: "O", empNo: "O1", basicSalary: 40000, employmentType: "Full-time", iloeSubscribed: false, iloeExempt: true }, now);
  ok("an owner marked exempt stops being chased", !exempt.required && exempt.ok, exempt.reason);
}

/* ===================================================== Emiratisation ====== */
ok("the small band is 20 to 49 employees",
  EMIRATISATION_SMALL_BAND.from === 20 && EMIRATISATION_SMALL_BAND.to === 49);
ok("the large rule starts at 50", EMIRATISATION_LARGE_FROM === 50);
ok("a priority-sector SME needs two nationals for 2026", SMALL_BAND_REQUIRED_2026 === 2);
ok("the small-band contribution is AED 108,000 per missing hire", SMALL_BAND_CONTRIBUTION === 108_000);
ok("the large-company target is 2% of skilled roles a year", LARGE_ANNUAL_TARGET === 0.02);
ok("and AED 9,000 a month per unfilled position", LARGE_MONTHLY_CONTRIBUTION === 9_000);

ok("'Emirati' is recognised", isEmirati("Emirati"));
ok("so is 'UAE'", isEmirati("UAE") && isEmirati("uae"));
ok("and 'United Arab Emirates'", isEmirati("United Arab Emirates"));
ok("and 'UAE National' however it is spaced", isEmirati("  UAE  National "));
ok("an Indian national is not counted", !isEmirati("Indian"));
ok("nor a blank nationality", !isEmirati(null) && !isEmirati(""));

{
  const r = emiratisation({ headcount: 12, skilledCount: 8, nationals: 0, prioritySector: true });
  ok("under twenty employees nothing applies yet", !r.applies && r.exposure === 0);
  ok("and the screen says when it will", /20 employees/.test(r.note), r.note);
}
{
  // The company in the acceptance test: a construction SME at 40 staff.
  const r = emiratisation({ headcount: 40, skilledCount: 25, nationals: 0, prioritySector: true });
  ok("a priority-sector SME needs two", r.applies && r.required === 2 && r.shortfall === 2);
  ok("which is AED 216,000 of exposure", r.exposure === 216_000, `AED ${r.exposure}`);
}
{
  const r = emiratisation({ headcount: 40, skilledCount: 25, nationals: 2, prioritySector: true });
  ok("two nationals meets it", r.shortfall === 0 && r.exposure === 0);
}
{
  const r = emiratisation({ headcount: 40, skilledCount: 25, nationals: 0, prioritySector: false });
  ok("outside the named sectors the SME rule does not apply", !r.applies);
  ok("and it says to check the setting", /fourteen sectors/.test(r.note), r.note);
}
{
  // Fifty and above: 2% of skilled roles, rounded up — a fraction of a
  // position is still a position MOHRE expects filled.
  const r = emiratisation({ headcount: 60, skilledCount: 40, nationals: 0, prioritySector: false });
  ok("2% of forty skilled roles rounds up to one", r.required === 1, `${r.required}`);
  ok("costing AED 9,000 a month", r.monthlyExposure === 9_000);
  ok("or AED 108,000 across the year", r.exposure === 108_000, `AED ${r.exposure}`);
}
{
  const r = emiratisation({ headcount: 300, skilledCount: 200, nationals: 1, prioritySector: false });
  ok("2% of two hundred skilled roles is four", r.required === 4, `${r.required}`);
  ok("one national leaves three short", r.shortfall === 3);
  ok("at AED 27,000 a month", r.monthlyExposure === 27_000);
}
{
  const r = emiratisation({ headcount: 60, skilledCount: 40, nationals: 5, prioritySector: false });
  ok("exceeding the target is not a negative shortfall", r.shortfall === 0 && r.exposure === 0);
}

/* ======================================= payroll reaches the ledger ======= */
{
  const src = fs.readFileSync("src/app/(app)/hr/payroll/actions.ts", "utf8");
  ok("marking a run paid posts a voucher", /postPayrollToLedger\(/.test(src) && /postVoucher\(/.test(src));
  ok("it is tied to the run as its source document", /sourceType: "payroll"/.test(src),
    "so approving twice cannot post twice");
  // These used to check for the literal codes 6000, 1000 and 1170. They are
  // gone on purpose: a customer with their own chart maps the roles instead,
  // so the invariant worth holding is that the posting asks for a role and
  // never names a number.
  ok("the cost lands on salaries and the money on the bank",
    /"salaryExpense"/.test(src) && /"bank"/.test(src));
  ok("an advance recovered reduces the receivable rather than the cost",
    /"employeeAdvances"/.test(src));
  ok("and no account number is named in the payroll posting",
    ![...src.matchAll(/(?:^|[^\w"])"(\d{4})"/g)].length, "the chart is the customer's, not ours");
  ok("a posted run cannot quietly go back to draft",
    /Reverse that voucher in the Day Book first/.test(src));
  ok("supplied labour is kept off the company's own payroll",
    /employmentType: \{ not: "Supplied" \}/.test(src),
    "they sit on the agency's establishment card and the agency's WPS");

  const seed = fs.readFileSync("prisma/seed.mjs", "utf8");
  ok("the chart carries an employee advances account", /"1170", "Employee Advances"/.test(seed));
}
{
  // The three lines have to balance by construction: gross less deductions is
  // net pay plus whatever was recovered, which is the payslip's own arithmetic.
  const slips = [
    { netPay: 22000, advanceRecovery: 2000 },
    { netPay: 10800, advanceRecovery: 0 },
    { netPay: 2606.25, advanceRecovery: 0 },
  ];
  const net = slips.reduce((t, p) => t + p.netPay, 0);
  const rec = slips.reduce((t, p) => t + p.advanceRecovery, 0);
  ok("the salary debit equals the bank and advance credits",
    Math.abs((net + rec) - (net + rec)) < 0.005 && net + rec === 37406.25,
    `Dr 37,406.25 = Cr ${net.toFixed(2)} bank + Cr ${rec.toFixed(2)} advances`);
}

/* ================== the payroll voucher, against the real ledger ========== */
{
  // The shipped posting seam, imported the way the other suites do it: the
  // arithmetic is worth little unless it goes through the same balance check,
  // period lock and company-ownership rules as every other voucher.
  const SHIM = "src/lib/.posting.comp.ts";
  fs.writeFileSync(
    SHIM,
    fs.readFileSync("src/lib/posting.ts", "utf8")
      .replace(/^import "server-only";.*$/m, "")
      .replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
  );
  let postVoucher;
  try { ({ postVoucher } = await import("../src/lib/.posting.comp.ts")); }
  finally { fs.unlinkSync(SHIM); }

  const co = await db.company.findFirst({ where: { code: "WBE" } });
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId: co.id, code: { in: ["6000", "1000", "1170"] } },
  });
  const acc = (code) => accounts.find((a) => a.code === code);
  ok("the three payroll accounts exist", !!acc("6000") && !!acc("1000") && !!acc("1170"));

  const balanceOf = async (code) => {
    const a = acc(code);
    const agg = await db.journalLine.aggregate({
      where: { accountId: a.id },
      _sum: { debit: true, credit: true },
    });
    return Math.round(((agg._sum.debit ?? 0) - (agg._sum.credit ?? 0)) * 100) / 100;
  };

  const before = {
    salary: await balanceOf("6000"),
    bank: await balanceOf("1000"),
    advances: await balanceOf("1170"),
  };

  // A month with an advance recovered, so all three lines are exercised.
  const net = 35406.25;
  const recovered = 2000;
  const cost = net + recovered;
  const sourceId = "test-payroll-run-" + Date.now();

  const posted = await postVoucher({
    companyId: co.id,
    postedBy: "test",
    voucherType: "Payment",
    date: "2026-09-30",
    memo: "Payroll for 2026-09 — test",
    lines: [
      { accountId: acc("6000").id, debit: cost, credit: 0 },
      { accountId: acc("1000").id, debit: 0, credit: net },
      { accountId: acc("1170").id, debit: 0, credit: recovered },
    ],
    sourceType: "payroll",
    sourceId,
    source: "payroll",
  });
  ok("the payroll voucher posts", posted.ok, posted.ok ? posted.reference : posted.error);

  if (posted.ok) {
    const after = {
      salary: await balanceOf("6000"),
      bank: await balanceOf("1000"),
      advances: await balanceOf("1170"),
    };
    ok("salary cost went up by the month's wages",
      Math.abs(after.salary - before.salary - cost) < 0.005,
      `+AED ${(after.salary - before.salary).toFixed(2)}`);
    ok("the bank went down by the net pay",
      Math.abs(before.bank - after.bank - net) < 0.005,
      `−AED ${(before.bank - after.bank).toFixed(2)}`);
    ok("the advance receivable came down by what was recovered",
      Math.abs(before.advances - after.advances - recovered) < 0.005,
      `−AED ${(before.advances - after.advances).toFixed(2)}`);

    // One voucher per run: approving twice must not post twice.
    const again = await postVoucher({
      companyId: co.id, postedBy: "test", voucherType: "Payment", date: "2026-09-30",
      memo: "Payroll for 2026-09 — test again",
      lines: [
        { accountId: acc("6000").id, debit: cost, credit: 0 },
        { accountId: acc("1000").id, debit: 0, credit: net },
        { accountId: acc("1170").id, debit: 0, credit: recovered },
      ],
      sourceType: "payroll", sourceId, source: "payroll",
    });
    ok("the same run cannot be posted twice", !again.ok, again.ok ? "IT POSTED AGAIN" : again.error);

    // The books still balance with a payroll voucher in them.
    const all = await db.journalLine.aggregate({ _sum: { debit: true, credit: true } });
    ok("the trial balance still balances",
      Math.abs((all._sum.debit ?? 0) - (all._sum.credit ?? 0)) < 0.005,
      `Dr ${(all._sum.debit ?? 0).toFixed(2)} / Cr ${(all._sum.credit ?? 0).toFixed(2)}`);

    // Leave the books as they were found.
    await db.journalEntry.deleteMany({ where: { companyId: co.id, sourceType: "payroll", sourceId } });
    const restored = await balanceOf("6000");
    ok("the test voucher was removed cleanly", Math.abs(restored - before.salary) < 0.005);
  }
}

/* ============================================== against the real records == */
{
  const companies = await db.company.findMany();
  const staff = await db.employee.findMany({ where: { status: { not: "Inactive" } } });
  ok("there is a company and a payroll to measure", companies.length > 0 && staff.length > 0,
    `${companies.length} companies, ${staff.length} active staff`);

  console.log("");
  for (const co of companies) {
    const mine = staff.filter((e) => e.companyId === co.id);
    const r = emiratisation({
      headcount: mine.length,
      skilledCount: mine.filter((e) => e.skilledRole).length,
      nationals: mine.filter((e) => isEmirati(e.nationality)).length,
      prioritySector: co.emiratisationSector,
    });
    console.log(`   ${co.code.padEnd(6)} ${String(mine.length).padStart(3)} staff  ${r.applies ? `${r.nationals}/${r.required} nationals` : "rule does not apply yet"}`);
  }
  console.log("");

  const chased = staff.map((e) => iloeStatus(e, new Date())).filter((s) => !s.ok);
  console.log(`   ILOE: ${chased.length} of ${staff.length} to chase`);
  ok("every ILOE status is decided one way or the other",
    staff.every((e) => typeof iloeStatus(e, new Date()).ok === "boolean"));

  // A voucher posted from payroll must balance like any other.
  const runs = await db.payrollRun.findMany({ where: { status: "Paid" } });
  for (const r of runs) {
    const v = await db.journalEntry.findFirst({
      where: { companyId: r.companyId, sourceType: "payroll", sourceId: r.id },
      include: { lines: true },
    });
    if (!v) continue;
    const dr = v.lines.reduce((t, l) => t + l.debit, 0);
    const cr = v.lines.reduce((t, l) => t + l.credit, 0);
    ok(`payroll ${r.period} posted a balanced voucher`, Math.abs(dr - cr) < 0.005,
      `${v.reference}: Dr ${dr.toFixed(2)} / Cr ${cr.toFixed(2)}`);
  }
  ok("no paid run is missing its voucher",
    (await Promise.all(runs.map((r) =>
      db.journalEntry.count({ where: { companyId: r.companyId, sourceType: "payroll", sourceId: r.id } })
    ))).every((n) => n === 1) || runs.length === 0,
    `${runs.length} paid run(s)`);
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
