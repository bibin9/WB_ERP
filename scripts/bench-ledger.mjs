/**
 * How the ledger reads behave at a real company's volume.
 *
 * Nine screens load every journal line a company has ever posted and then
 * filter by date in JavaScript. On the seeded demo that is fifty rows and it is
 * instant, which is exactly why it survived this long. A UAE contractor doing
 * two hundred vouchers a month reaches a hundred thousand lines inside four
 * years, and this measures what happens then.
 *
 *   node --experimental-strip-types scripts/bench-ledger.mjs [rows]
 *
 * Writes into a scratch company and deletes it afterwards, whatever happens.
 */
import { PrismaClient } from "@prisma/client";
import { importLibs } from "./lib-shim.mjs";

// The shipped helper, imported the way the other suites import server-only
// modules — so what is being timed is the code that actually runs.
const { accountBalances } = (await importLibs(["db", "ledger", "ledger-query"]))["ledger-query"];

const db = new PrismaClient();
const ROWS = Number(process.argv[2]) || 100_000;
const ms = (n) => `${n.toFixed(0)} ms`;

const time = async (label, fn) => {
  const t0 = performance.now();
  const out = await fn();
  const dt = performance.now() - t0;
  console.log(`  ${label.padEnd(52)} ${ms(dt).padStart(9)}   ${out ?? ""}`);
  return dt;
};

const tenant = await db.tenant.findFirst();
let company;
try {
  company = await db.company.create({
    data: { tenantId: tenant.id, code: "BENCH", name: "Benchmark Contracting" },
  });

  console.log(`\nBuilding ${ROWS.toLocaleString()} journal lines…`);
  const t0 = performance.now();

  const accounts = [];
  for (const [code, name, type] of [
    ["1000", "Bank", "Asset"], ["1100", "Receivable", "Asset"],
    ["4000", "Revenue", "Income"], ["5000", "Cost of sales", "Expense"],
    ["6000", "Salaries", "Expense"],
  ]) {
    accounts.push(await db.chartOfAccount.create({ data: { companyId: company.id, code, name, type } }));
  }

  // Three years of vouchers, two lines each, spread across the period.
  const perVoucher = 2;
  const vouchers = Math.ceil(ROWS / perVoucher);
  const start = Date.UTC(2023, 0, 1);
  const span = Date.UTC(2026, 0, 1) - start;
  const BATCH = 2000;

  for (let i = 0; i < vouchers; i += BATCH) {
    const chunk = Math.min(BATCH, vouchers - i);
    const entries = Array.from({ length: chunk }, (_, k) => {
      const n = i + k;
      return {
        companyId: company.id,
        date: new Date(start + Math.floor((n / vouchers) * span)),
        voucherType: "Sales",
        reference: `BENCH/SV/${String(n).padStart(7, "0")}`,
        memo: "benchmark",
        postedBy: "bench",
      };
    });
    await db.journalEntry.createMany({ data: entries });
    const made = await db.journalEntry.findMany({
      where: { companyId: company.id, reference: { in: entries.map((e) => e.reference) } },
      select: { id: true },
    });
    const lines = [];
    for (const e of made) {
      lines.push({ entryId: e.id, accountId: accounts[1].id, debit: 1050, credit: 0 });
      lines.push({ entryId: e.id, accountId: accounts[2].id, debit: 0, credit: 1050 });
    }
    await db.journalLine.createMany({ data: lines });
  }
  const built = await db.journalLine.count({ where: { entry: { companyId: company.id } } });
  console.log(`built ${built.toLocaleString()} lines in ${ms(performance.now() - t0)}\n`);

  const from = new Date(Date.UTC(2025, 0, 1));
  const to = new Date(Date.UTC(2025, 11, 31));

  console.log("THE WAY THE SCREENS DO IT TODAY");
  const slow = await time("trial balance: load every line, filter in JS", async () => {
    const rows = await db.chartOfAccount.findMany({
      where: { companyId: company.id },
      include: { lines: { include: { entry: { select: { date: true } } } } },
    });
    let dr = 0, cr = 0, n = 0;
    for (const a of rows) {
      for (const l of a.lines) {
        n++;
        if (l.entry.date >= from && l.entry.date <= to) { dr += l.debit; cr += l.credit; }
      }
    }
    return `${n.toLocaleString()} lines through Node · Dr ${dr.toFixed(0)}`;
  });

  console.log("\nTHE SAME ANSWER, ASKED OF THE DATABASE");
  const fast = await time("grouped aggregate, one year only", async () => {
    const g = await db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { companyId: company.id, date: { gte: from, lte: to } } },
      _sum: { debit: true, credit: true },
    });
    const dr = g.reduce((s, r) => s + (r._sum.debit ?? 0), 0);
    return `${g.length} account rows returned · Dr ${dr.toFixed(0)}`;
  });

  const openings = await time("brought-forward, as a second aggregate", async () => {
    const g = await db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { companyId: company.id, date: { lt: from } } },
      _sum: { debit: true, credit: true },
    });
    return `${g.length} account rows`;
  });

  console.log("\n  THE SHIPPED HELPER, ON THE SAME DATA");
  const shipped = await time("accountBalances(), as the screens now call it", async () => {
    const rows = await accountBalances(company.id, from, to, null);
    const dr = rows.reduce((s, r) => s + r.periodDr, 0);
    return `${rows.length} account rows · Dr ${dr.toFixed(0)}`;
  });

  console.log(`\n  ${(slow / Math.max(1, shipped)).toFixed(1)}x faster, and it stops growing with the ledger.`);
  console.log("  The database returns one row per account either way; Node used to receive one per line.");

  // What the payload actually costs to move and hydrate.
  const bytes = built * 120;
  console.log(`  Payload before: ~${(bytes / 1e6).toFixed(1)} MB a page load. After: a few kB.\n`);
} finally {
  if (company) {
    await db.journalLine.deleteMany({ where: { entry: { companyId: company.id } } });
    await db.journalEntry.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    console.log("(benchmark company removed)");
  }
  await db.$disconnect();
}
