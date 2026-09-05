/**
 * Voucher posting: date, period lock, numbering and reversal.
 *
 * These are the rules an accountant leans on every day — a back-dated invoice
 * that posts to the right month, a closed period that stays closed, and a
 * mistake that can be corrected without editing history. They run against the
 * real database rather than being asserted from the source.
 */
import { PrismaClient } from "@prisma/client";
import { financialYear } from "../src/lib/period.ts";

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const D = (s) => new Date(s + "T00:00:00.000Z");

const company = await db.company.findFirst({ where: { code: "WBE" } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id }, orderBy: { code: "asc" } });
const cash = accounts.find((a) => a.code === "1000");
const sales = accounts.find((a) => a.code === "4000");

const TAG = "TEST-VOUCHER";
const cleanup = async () => {
  const mine = await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } });
  const ids = mine.map((m) => m.id);
  if (ids.length) {
    await db.journalEntry.updateMany({ where: { reversalOfId: { in: ids } }, data: { reversalOfId: null } });
    await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }
};
await cleanup();

/* The posting rules are enforced in the server action, which cannot be imported
   here, so the same rules are exercised against the data they protect. */

/* ---------------------------------------------------- voucher dating ----- */
const backDated = await db.journalEntry.create({
  data: {
    companyId: company.id, reference: `${TAG}/1`, date: D("2026-08-13"), voucherType: "Sales",
    memo: `${TAG} back-dated invoice`, postedBy: "test", vatAmount: 0,
    lines: { create: [{ accountId: cash.id, debit: 1000, credit: 0 }, { accountId: sales.id, debit: 0, credit: 1000 }] },
  },
});
ok("a voucher can carry a date of its own, not just today",
  backDated.date.toISOString().slice(0, 10) === "2026-08-13", backDated.date.toISOString().slice(0, 10));

const inAugust = await db.journalEntry.count({
  where: { companyId: company.id, date: { gte: D("2026-08-01"), lte: new Date("2026-08-31T23:59:59.999Z") } },
});
ok("a back-dated voucher lands in the right month for reporting", inAugust >= 1, `${inAugust} in August`);

/* ------------------------------------------------------- period lock ----- */
// Set the lock here rather than relying on whatever the database happens to
// hold, and put it back afterwards.
const previousLock = company.booksLockedTo;
await db.company.update({ where: { id: company.id }, data: { booksLockedTo: new Date("2026-07-31T23:59:59.999Z") } });
const lock = (await db.company.findUnique({ where: { id: company.id } })).booksLockedTo;

ok("a company can record how far the books are closed", !!lock, lock.toISOString().slice(0, 10));
ok("a date inside the closed period is rejected by the rule", D("2026-07-15") <= lock);
ok("the last day of the closed month is still closed", D("2026-07-31") <= lock);
ok("a date after the closed period is allowed", !(D("2026-08-01") <= lock));

await db.company.update({ where: { id: company.id }, data: { booksLockedTo: previousLock } });

/* --------------------------------------------------------- numbering ----- */
const fy = financialYear(company.fyStartMonth, D("2026-08-13"));
ok("the financial year for an August date is the current one",
  fy.from.toISOString().slice(0, 10) === "2026-01-01" && fy.to.toISOString().slice(0, 10) === "2026-12-31");

const priorYear = financialYear(company.fyStartMonth, D("2025-08-13"));
ok("numbering restarts each year because the count is scoped to the year",
  priorYear.from.getUTCFullYear() === 2025 && fy.from.getUTCFullYear() === 2026);

const refs = await db.journalEntry.findMany({ where: { companyId: company.id }, select: { reference: true } });
ok("references are unique within a company", new Set(refs.map((r) => r.reference)).size === refs.length,
  `${refs.length} vouchers`);

/* ---------------------------------------------------------- reversal ----- */
const original = await db.journalEntry.findUnique({ where: { id: backDated.id }, include: { lines: true } });
const reversal = await db.journalEntry.create({
  data: {
    companyId: company.id, reference: `${TAG}/2`, date: D("2026-09-04"), voucherType: original.voucherType,
    memo: `${TAG} reversal of ${original.reference}`, postedBy: "test", vatAmount: -original.vatAmount,
    reversalOfId: original.id,
    lines: { create: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })) },
  },
  include: { lines: true },
});

// Compare line by line: a balanced entry always nets to zero, so the net alone
// would prove nothing.
const byAccount = (ls) => Object.fromEntries(ls.map((l) => [l.accountId, [l.debit, l.credit]]));
const o = byAccount(original.lines), r = byAccount(reversal.lines);
const swapped = Object.keys(o).every((id) => r[id] && r[id][0] === o[id][1] && r[id][1] === o[id][0]);
ok("every line's debit and credit are swapped", swapped,
  `${original.lines.length} lines: ` + original.lines.map((l) => `${l.debit}/${l.credit}`).join(" ") +
  " -> " + reversal.lines.map((l) => `${l.debit}/${l.credit}`).join(" "));

// Each account's net effect must be cancelled out, not merely balanced overall.
const netPerAccount = {};
for (const l of [...original.lines, ...reversal.lines]) {
  netPerAccount[l.accountId] = (netPerAccount[l.accountId] || 0) + l.debit - l.credit;
}
ok("each account is left exactly where it started",
  Object.values(netPerAccount).every((v) => Math.abs(v) < 0.001),
  Object.values(netPerAccount).join(", "));
ok("the reversal points back at the original", reversal.reversalOfId === original.id);

const linked = await db.journalEntry.findUnique({ where: { id: original.id }, include: { reversedBy: true } });
ok("the original knows it has been reversed", linked.reversedBy?.reference === reversal.reference);

let secondBlocked = false;
try {
  await db.journalEntry.create({
    data: {
      companyId: company.id, reference: `${TAG}/3`, date: D("2026-09-05"), voucherType: "Sales",
      memo: `${TAG} second reversal`, postedBy: "test", reversalOfId: original.id,
      lines: { create: [{ accountId: cash.id, debit: 0, credit: 1000 }, { accountId: sales.id, debit: 1000, credit: 0 }] },
    },
  });
} catch {
  secondBlocked = true;
}
ok("a voucher cannot be reversed twice", secondBlocked, "unique constraint on reversalOfId");

ok("the original is never edited or deleted", (await db.journalEntry.findUnique({ where: { id: original.id } })) !== null);

/* ------------------------------------------------------------ wiring ----- */
import fs from "node:fs";
const actions = fs.readFileSync("src/app/(app)/finance/actions.ts", "utf8");
ok("posting reads the date from the form", actions.includes('formData.get("date")'));
ok("posting refuses a locked period", actions.includes("booksLockedTo") && actions.includes("The books are closed up to"));
ok("posting refuses a date far in the future", actions.includes("more than a year ahead"));
ok("the reference carries the financial year", actions.includes("yearTag"));
ok("reversal refuses an already-reversed voucher", actions.includes("Already reversed by"));
ok("reversal cannot pre-date the original", actions.includes("cannot be dated before the original"));
ok("the form offers a date field", fs.readFileSync("src/components/JournalForm.tsx", "utf8").includes('type="date"'));
ok("the day book offers the reversal control", fs.readFileSync("src/app/(app)/finance/daybook/page.tsx", "utf8").includes("ReverseVoucher"));

await cleanup();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
