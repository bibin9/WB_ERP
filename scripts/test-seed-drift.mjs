/**
 * The seed must repair an install made by an older version.
 *
 * Four defects came from one line — `if (nothing has been seeded yet)`. It asks
 * whether anything was seeded at all, so an older install is never revisited: a
 * voucher added to the seed later never appears, and a field added later is
 * never filled in. The live site ended up with a VAT return reading nil against
 * a ledger holding six thousand of tax.
 *
 * This deliberately recreates each of those four states and checks that one
 * run of the seed puts them right — and, just as important, that it leaves
 * alone anything already correct.
 */
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const seed = () => execFileSync("node", ["prisma/seed.mjs"], { stdio: "pipe" });

const company = await db.company.findFirst({ where: { code: "WBE" } });
const acc = async (code) => db.chartOfAccount.findFirst({ where: { companyId: company.id, code } });
const voucher = (ref) =>
  db.journalEntry.findFirst({
    where: { companyId: company.id, reference: ref, source: "seed" },
    include: { lines: { include: { account: { select: { code: true } } } } },
  });

/* =============================== 1. a voucher added after the install ==== */
{
  const before = await voucher("SAL/WBE/0002");
  ok("the zero-rated export exists to begin with", !!before);
  await db.journalEntry.delete({ where: { id: before.id } });
  ok("  deleted, standing in for an install made before it was written",
    (await voucher("SAL/WBE/0002")) === null);
  seed();
  const after = await voucher("SAL/WBE/0002");
  ok("  the seed creates the voucher an older install never had", !!after,
    after ? `${after.reference} restored` : "");
  ok("  with its zero-rated treatment",
    after?.lines.some((l) => l.vatTreatment === "Zero-rated"));
}

/* ============================ 2. a field added after the install ========= */
{
  await db.journalLine.updateMany({
    where: { entry: { companyId: company.id, source: "seed" } },
    data: { vatTreatment: null },
  });
  const stripped = await voucher("SAL/WBE/0001");
  ok("treatments stripped, as on an install predating the field",
    stripped.lines.every((l) => l.vatTreatment === null));
  seed();
  const fixed = await voucher("SAL/WBE/0001");
  ok("  the seed fills the treatment back in",
    fixed.lines.some((l) => l.vatTreatment === "Standard"));
  const rc = await voucher("PUR/WBE/0002");
  ok("  including reverse charge", rc.lines.some((l) => l.vatTreatment === "Reverse charge"));
}

/* ======================= 3. an account added after the install =========== */
{
  const wrong = await acc("2100");
  const sale = await voucher("SAL/WBE/0001");
  const vatLine = sale.lines.find((l) => l.credit === 10000);
  await db.journalLine.update({ where: { id: vatLine.id }, data: { accountId: wrong.id } });
  ok("VAT moved onto Accruals, as before the control accounts existed",
    (await db.journalLine.findUnique({ where: { id: vatLine.id }, include: { account: true } })).account.code === "2100");
  seed();
  const moved = await db.journalLine.findUnique({ where: { id: vatLine.id }, include: { account: true } });
  ok("  the seed moves it back to VAT Output", moved.account.code === "2150", moved.account.code);
}

/* ================================ 4. nothing correct is disturbed ======== */
{
  // A treatment somebody chose deliberately must survive a re-seed.
  const sale = await voucher("SAL/WBE/0001");
  const revenue = sale.lines.find((l) => l.account.code === "4000");
  await db.journalLine.update({ where: { id: revenue.id }, data: { vatTreatment: "Exempt" } });
  seed();
  ok("a treatment somebody chose is not overwritten",
    (await db.journalLine.findUnique({ where: { id: revenue.id } })).vatTreatment === "Exempt");
  await db.journalLine.update({ where: { id: revenue.id }, data: { vatTreatment: "Standard" } });

  // And a voucher the user posted is never a candidate at all.
  const cash = await acc("1000");
  const rent = await acc("6100");
  const mine = await db.journalEntry.create({
    data: {
      companyId: company.id, reference: "SAL/WBE/0001-USER", voucherType: "Sales",
      date: new Date("2026-08-01T00:00:00.000Z"), source: "manual", postedBy: "someone",
      memo: "DRIFT-TEST user voucher",
      lines: { create: [{ accountId: rent.id, debit: 100, credit: 0 }, { accountId: cash.id, debit: 0, credit: 100 }] },
    },
    include: { lines: true },
  });
  seed();
  const still = await db.journalEntry.findUnique({ where: { id: mine.id }, include: { lines: true } });
  ok("a voucher the user posted is untouched",
    still.lines.every((l) => l.vatTreatment === null) && still.lines.length === 2);
  await db.journalEntry.delete({ where: { id: mine.id } });
}

/* ================================ 5. running twice changes nothing ======= */
{
  const snapshot = async () => {
    const rows = await db.journalLine.findMany({
      where: { entry: { companyId: company.id, source: "seed" } },
      select: { id: true, accountId: true, vatTreatment: true, debit: true, credit: true },
      orderBy: { id: "asc" },
    });
    return JSON.stringify(rows);
  };
  seed();
  const a = await snapshot();
  seed();
  ok("a second run is a no-op", a === (await snapshot()));
}

/* ============= 6. a company added through the screen gets a chart ======== */
/**
 * The seed used to build the chart only for the three companies it creates
 * itself, so a company added through the Companies screen had no accounts at
 * all. Every module that asks for a mapped account then refused on it, and the
 * refusal arrived the moment somebody pressed Save. WBM was in that position.
 *
 * The demo opening balances must not follow. Seeding a real company's ledger
 * with 50,000 of invented payables would be worse than leaving it empty.
 */
{
  const tenant = await db.tenant.findFirst({ where: { key: "wandb" } });
  const code = `ZZT${Date.now().toString().slice(-6)}`;
  const made = await db.company.create({
    data: { tenantId: tenant.id, code, name: "Seed Drift Test Co", baseCurrency: "AED", fyStartMonth: 1 },
  });
  try {
    const before = await db.chartOfAccount.count({ where: { companyId: made.id } });
    ok("a company created outside the seed starts with no chart", before === 0, String(before));

    seed();

    const after = await db.chartOfAccount.count({ where: { companyId: made.id } });
    ok("  one run of the seed gives it one", after > 0, `${after} accounts`);

    const advances = await db.chartOfAccount.findMany({
      where: { companyId: made.id, code: { in: ["2300", "1180"] } },
      orderBy: { code: "asc" },
    });
    ok("  including the advance control accounts", advances.length === 2,
      "otherwise the advances register refuses on that company");

    // Accounts Payable carries a demo opening balance on the seeded companies.
    const ap = await db.chartOfAccount.findFirst({ where: { companyId: made.id, code: "2000" } });
    ok("  but none of the demo opening balances", ap?.openingBalance === 0,
      `a real company starts at nil, not ${ap?.openingBalance}`);

    const seeded = await db.chartOfAccount.findFirst({ where: { companyId: company.id, code: "2000" } });
    ok("  which the demo companies still have", seeded?.openingBalance === -50000,
      String(seeded?.openingBalance));
  } finally {
    await db.chartOfAccount.deleteMany({ where: { companyId: made.id } });
    await db.company.delete({ where: { id: made.id } });
  }
}

/* ------------------------------------------------------------- the guard - */
{
  const s = read("prisma/seed.mjs");
  ok("the once-only voucher guard is gone", !s.includes("seededVouchers"));
  ok("the vouchers are declared as data", s.includes("SAMPLE_VOUCHERS"));
  ok("the hand-written repair blocks are gone",
    !s.includes("Repair sample vouchers seeded before") && !s.includes("Backfill VAT treatment on sample"));
  ok("a blank is filled but a value is never overwritten",
    s.includes("line.vatTreatment === null"));
  ok("only seeded vouchers are candidates", s.includes('source: "seed"'));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
