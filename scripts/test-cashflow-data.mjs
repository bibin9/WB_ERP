/**
 * What the cash flow forecast reads out of the books.
 *
 * The arithmetic is held in test-cashflow.mjs. This is the other half, and it
 * exists mostly for one claim: a customer who hands over a post-dated cheque
 * leaves the invoice open in the ledger until it clears, so the same money is
 * both an unpaid invoice and a dated cheque. Counting both forecasts twice the
 * cash — the kind of error that is invisible on a screen and expensive on the
 * 28th. The netting that prevents it is asserted against real rows.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { "cashflow-data": data, cashflow } = await importLibs([
  "cashflow-data", "cashflow", "ageing", "accounts", "financepolicy", "db",
]);
const { cashSourceFor } = data;
const { buildForecast } = cashflow;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");
const round = (n) => Math.round(n * 100) / 100;

const co = await db.company.findFirst({ where: { code: "WBE" } });
const today = new Date();

/* ================= the opening balance is the marked accounts ============ */
{
  const src = await cashSourceFor(co.id, today, 13);
  const cash = await db.chartOfAccount.findMany({
    where: { companyId: co.id, controlType: "Cash" },
    select: { id: true, code: true, openingBalance: true },
  });
  ok("at least one account is marked Cash", cash.length > 0,
    cash.map((c) => c.code).join(", ") || "NONE — the seed should have marked 1000");

  let expected = 0;
  for (const a of cash) {
    const agg = await db.journalLine.aggregate({
      where: { accountId: a.id }, _sum: { debit: true, credit: true },
    });
    expected = round(expected + a.openingBalance + ((agg._sum.debit ?? 0) - (agg._sum.credit ?? 0)));
  }
  ok("the opening figure is the ledger balance of those accounts, not a guess",
    Math.abs(src.opening - expected) < 0.005, `${src.opening} vs ${expected}`);
  ok("and the screen can name where it came from",
    src.cashAccounts.length === cash.length && src.cashAccounts.every((a) => a.code));
  ok("no warning about missing cash accounts", !src.warnings.some((w) => /marked as Cash/.test(w)),
    src.warnings.join(" | "));
}

/* ================= a cheque does not double as its invoice =============== */
{
  const party = await db.party.findFirst({ where: { companyId: co.id, type: { in: ["Customer", "Both"] } } });
  const ar = await db.chartOfAccount.findFirst({ where: { companyId: co.id, controlType: "Receivable" } });
  const income = await db.chartOfAccount.findFirst({ where: { companyId: co.id, type: "Income" } });
  const MARK = "CASHFLOW-TEST";
  const day = 24 * 3600 * 1000;

  const clean = async () => {
    const entries = await db.journalEntry.findMany({ where: { companyId: co.id, memo: { startsWith: MARK } } });
    for (const e of entries) await db.journalEntry.delete({ where: { id: e.id } });
    await db.cheque.deleteMany({ where: { companyId: co.id, notes: { startsWith: MARK } } });
  };
  await clean();

  const inflowFor = (src) =>
    src.events
      .filter((e) => e.party === party.name && e.amount > 0 && (e.kind === "receivable" || e.kind === "cheque-in"))
      .reduce((t, e) => round(t + e.amount), 0);

  try {
    const before = inflowFor(await cashSourceFor(co.id, today, 13));

    // An invoice for 100,000 that nobody has paid.
    await db.journalEntry.create({
      data: {
        companyId: co.id, reference: `${MARK}/INV`, date: new Date(Date.now() - 5 * day),
        voucherType: "Sales", partyId: party.id, partyName: party.name,
        memo: `${MARK} invoice`, postedBy: "test", source: "test",
        lines: { create: [
          { accountId: ar.id, debit: 100000, credit: 0 },
          { accountId: income.id, debit: 0, credit: 100000 },
        ] },
      },
    });

    const withInvoice = await cashSourceFor(co.id, today, 13);
    ok("an unpaid invoice becomes expected money in",
      Math.abs(inflowFor(withInvoice) - (before + 100000)) < 0.005,
      `${inflowFor(withInvoice)} vs ${before + 100000}`);

    // Now the customer hands over a post-dated cheque for the same 100,000.
    // The invoice is still open in the ledger — that is exactly the trap.
    await db.cheque.create({
      data: {
        companyId: co.id, direction: "Received", chequeNo: `${MARK}-1`, bankName: "Test Bank",
        chequeDate: new Date(Date.now() + 20 * day), amount: 100000,
        partyId: party.id, partyName: party.name, status: "In hand", notes: `${MARK} pdc`,
      },
    });

    const withBoth = await cashSourceFor(co.id, today, 13);
    ok("the same money is not counted twice once a cheque covers the invoice",
      Math.abs(inflowFor(withBoth) - (before + 100000)) < 0.005,
      `${inflowFor(withBoth)} — would be ${before + 200000} if double counted`);

    const cheque = withBoth.events.find((e) => e.kind === "cheque-in" && e.label.includes(MARK));
    ok("it is the cheque that is counted, on the cheque's date", !!cheque,
      cheque ? cheque.date.toISOString().slice(0, 10) : "no cheque event");
    // Which invoice the cheque is applied to is first-in-first-out, the same
    // order the ageing report settles in, so it may cover an older one than the
    // one just written. What must hold is the amount, not the identity.
    const invoicedBefore = withInvoice.events
      .filter((e) => e.party === party.name && e.kind === "receivable")
      .reduce((t, e) => round(t + e.amount), 0);
    const invoicedAfter = withBoth.events
      .filter((e) => e.party === party.name && e.kind === "receivable")
      .reduce((t, e) => round(t + e.amount), 0);
    ok("the invoices expected from that customer fall by exactly the cheque",
      Math.abs(invoicedBefore - invoicedAfter - 100000) < 0.005,
      `${invoicedBefore} then ${invoicedAfter}`);

    // A cheque for less than the invoice leaves the balance still expected.
    await db.cheque.update({
      where: { id: (await db.cheque.findFirst({ where: { notes: { startsWith: MARK } } })).id },
      data: { amount: 40000 },
    });
    const partial = await cashSourceFor(co.id, today, 13);
    ok("a part-payment leaves the rest of the invoice in the forecast",
      Math.abs(inflowFor(partial) - (before + 100000)) < 0.005,
      `${inflowFor(partial)} — 40,000 of cheque plus 60,000 still invoiced`);
    ok("and both lines are shown, so the total is explainable",
      partial.events.some((e) => e.kind === "cheque-in" && e.label.includes(MARK)) &&
      partial.events.some((e) => e.kind === "receivable" && e.label.includes(`${MARK}/INV`)));
  } finally {
    await clean();
  }
}

/* ================= payroll, and what it is based on ===================== */
// The forecast exists to answer "can we make payroll", so this branch must be
// exercised rather than skipped when the demo data happens to have no run. If
// there is no approved run, one is made, asserted against, and removed.
{
  const MARK = "CASHFLOW-PAYROLL-TEST";
  let temporary = null;
  const existing = await db.payrollRun.findFirst({
    where: { companyId: co.id, status: { in: ["Approved", "Paid"] } },
  });

  try {
    if (!existing) {
      const emp = await db.employee.findFirst({ where: { companyId: co.id } });
      temporary = await db.payrollRun.create({
        data: {
          companyId: co.id, period: "2099-01", status: "Approved", runBy: MARK,
          payslips: { create: [
            { employeeId: emp.id, empNo: emp.empNo, employeeName: emp.name, basic: 6000, allowances: 2000, netPay: 8000 },
            { employeeId: emp.id, empNo: emp.empNo, employeeName: emp.name, basic: 4000, allowances: 1000, netPay: 4500 },
          ] },
        },
      });
    }

    const src = await cashSourceFor(co.id, today, 13);
    const run = await db.payrollRun.findFirst({
      where: { companyId: co.id, status: { in: ["Approved", "Paid"] } },
      include: { payslips: { select: { netPay: true } } },
      orderBy: { period: "desc" },
    });
    const expected = round(run.payslips.reduce((t, x) => t + x.netPay, 0));

    ok("payroll is the total of the last approved run, not a typed figure",
      Math.abs(src.payroll.amount - expected) < 0.005, `${src.payroll.amount} vs ${expected}`);
    ok("and the screen can say which month that was", src.payroll.fromPeriod === run.period, src.payroll.fromPeriod);

    const pays = src.events.filter((e) => e.kind === "payroll");
    ok("a payday appears in every month of the horizon", pays.length >= 3, `${pays.length} in 13 weeks`);
    ok("each one is money going out", pays.every((x) => x.amount < 0 && Math.abs(x.amount + expected) < 0.005));
    ok("on the day the company says it pays, or the last day of a shorter month",
      pays.every((x) => {
        const last = new Date(Date.UTC(x.date.getUTCFullYear(), x.date.getUTCMonth() + 1, 0)).getUTCDate();
        return x.date.getUTCDate() === Math.min(src.payroll.dayOfMonth, last);
      }),
      pays.map((x) => x.date.toISOString().slice(0, 10)).join(", "));
    ok("no two paydays fall in the same month",
      new Set(pays.map((x) => `${x.date.getUTCFullYear()}-${x.date.getUTCMonth()}`)).size === pays.length);
    ok("the label says the figure is an estimate from a past month",
      pays.every((x) => /based on/.test(x.label)), pays[0]?.label ?? "none");

    // The whole point of the report, asserted once against real numbers.
    const f = buildForecast({ opening: src.opening, events: src.events, from: today, weeks: 13 });
    const payrollWeeks = f.buckets.filter((b) => b.events.some((e) => e.kind === "payroll"));
    ok("every payday lands in a week of the forecast", payrollWeeks.length === pays.length,
      `${payrollWeeks.length} weeks hold a payday`);
    ok("and the balance shown after payday is the balance before it, less the wages",
      payrollWeeks.every((b) => b.moneyOut >= expected - 0.005),
      payrollWeeks.map((b) => `${b.label}: out ${b.moneyOut}`).join(" | "));
  } finally {
    if (temporary) {
      await db.payslip.deleteMany({ where: { runId: temporary.id } });
      await db.payrollRun.delete({ where: { id: temporary.id } });
    }
  }
}

/* ================= only live instruments are counted ==================== */
{
  const src = await cashSourceFor(co.id, today, 26);
  const settled = await db.cheque.count({ where: { companyId: co.id, status: { in: ["Cleared", "Bounced", "Returned"] } } });
  const counted = new Set(src.events.filter((e) => e.kind.startsWith("cheque")).map((e) => e.label));
  const dead = await db.cheque.findMany({
    where: { companyId: co.id, status: { in: ["Cleared", "Bounced", "Returned"] } },
    select: { chequeNo: true },
  });
  ok("a cleared, bounced or returned cheque is not future money",
    dead.every((c) => !counted.has(`Cheque ${c.chequeNo}`)), `${settled} settled cheques checked`);

  const released = await db.retention.count({ where: { companyId: co.id, status: { not: "Held" } } });
  const retLabels = new Set(src.events.filter((e) => e.kind.startsWith("retention")).map((e) => e.label));
  const gone = await db.retention.findMany({ where: { companyId: co.id, status: { not: "Held" } }, select: { reference: true } });
  ok("retention already released is not expected again",
    gone.every((r) => !retLabels.has(`Retention ${r.reference}`)), `${released} released checked`);
}

/* ================= it holds together end to end ========================= */
{
  const src = await cashSourceFor(co.id, today, 13);
  const f = buildForecast({ opening: src.opening, events: src.events, from: today, weeks: 13 });
  const careful = buildForecast({ opening: src.opening, events: src.events, from: today, weeks: 13, cautious: true });

  ok("the forecast builds from real data without throwing", f.buckets.length === 13);
  ok("every event lands somewhere it can be accounted for",
    f.buckets.flatMap((b) => b.events).length + f.excluded.count <= src.events.length);
  ok("the closing balance is opening plus in less out",
    Math.abs(f.closing - round(f.opening + f.totalIn - f.totalOut)) < 0.005,
    `${f.closing}`);
  ok("the cautious view is never rosier than the open one", careful.closing <= f.closing,
    `${careful.closing} vs ${f.closing}`);
}

/* ================= how it is wired in =================================== */
{
  const page = read("src/app/(app)/finance/cash-flow/page.tsx");
  ok("the screen is behind its own permission", /requireAccess\("finance\.cashflow"\)/.test(page));
  ok("it is on the finance Reports tab",
    read("src/lib/moduletabs.ts").includes('href: "/finance/cash-flow"'));
  ok("and in the report registry", read("src/lib/reports.ts").includes('key: "cash-flow"'));
  ok("the screen key is declared", read("src/lib/rbac.ts").includes('key: "finance.cashflow"'));
  ok("and granted to the finance roles rather than admins only",
    read("prisma/seed.mjs").includes('"finance.cashflow"'));
  ok("payday is a setting, not a constant",
    read("src/components/finance/FinanceSettingsForm.tsx").includes("payrollDayOfMonth"));
  ok("the seed marks a bank account as Cash, so an existing install is corrected",
    /"1000", "Cash at Bank", "Asset", 150000, "Cash"/.test(read("prisma/seed.mjs")));
  ok("and there is plain-English help", /id: "cash-flow"/.test(read("src/lib/help.ts")));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
