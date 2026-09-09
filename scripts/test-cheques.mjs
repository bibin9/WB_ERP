/**
 * The post-dated cheque register.
 *
 * The rule the whole design rests on: recording a cheque writes nothing to the
 * ledger, and clearing it writes exactly one voucher. Get that wrong in either
 * direction and the register is worse than the spreadsheet it replaces — post
 * on receipt and the bank balance is overstated for months; post twice and the
 * books are wrong.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { chequeState, forecast, canMove, settles, NEXT_STATUS, OPEN_STATUSES } from "../src/lib/cheques.ts";

// postVoucher carries `import "server-only"`; same shim the other suites use.
const SHIM = "src/lib/.posting.chq.ts";
fs.writeFileSync(
  SHIM,
  fs.readFileSync("src/lib/posting.ts", "utf8")
    .replace(/^import "server-only";.*$/m, "")
    .replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let postVoucher;
try { ({ postVoucher } = await import("../src/lib/.posting.chq.ts")); } finally { fs.unlinkSync(SHIM); }

const read = (p) => fs.readFileSync(p, "utf8");
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ============================================== the lifecycle, in the lib = */
ok("a cheque in hand can be deposited", canMove("In hand", "Deposited"));
ok("a deposited cheque can clear", canMove("Deposited", "Cleared"));
ok("a deposited cheque can bounce", canMove("Deposited", "Bounced"));
ok("a bounced cheque can be deposited again", canMove("Bounced", "Deposited"));
ok("a cleared cheque is the end of the road", NEXT_STATUS.Cleared.length === 0);
ok("a cleared cheque cannot go back to in hand", !canMove("Cleared", "In hand"));
ok("an in-hand cheque cannot bounce — it never reached a bank", !canMove("In hand", "Bounced"));
ok("only clearing settles", settles("Cleared") && !settles("Deposited") && !settles("Bounced"));
ok("open means in hand or deposited", OPEN_STATUSES.join(",") === "In hand,Deposited");

/* ================================================== due dates and forecast */
{
  const asAt = new Date("2026-09-10T00:00:00.000Z");
  const on = (iso, status = "In hand", direction = "Received", amount = 100) =>
    ({ direction, chequeDate: new Date(iso + "T00:00:00.000Z"), amount, status });

  ok("a cheque dated last week is overdue to bank", chequeState(on("2026-09-03"), asAt).overdue);
  ok("a cheque dated today is due now, not overdue",
    chequeState(on("2026-09-10"), asAt).dueNow && !chequeState(on("2026-09-10"), asAt).overdue);
  ok("a cheque dated in three days is due this week", chequeState(on("2026-09-13"), asAt).dueThisWeek);
  ok("a cheque dated next month is not", !chequeState(on("2026-10-20"), asAt).dueThisWeek);
  ok("a cleared cheque is never due", !chequeState(on("2026-09-03", "Cleared"), asAt).overdue);

  const f = forecast(
    [
      on("2026-09-01", "In hand", "Received", 5000),
      on("2026-09-12", "In hand", "Received", 3000),
      on("2026-09-25", "In hand", "Received", 2000),
      on("2026-09-14", "In hand", "Issued", 1000),
      on("2026-09-05", "Cleared", "Received", 9999),
    ],
    asAt
  );
  ok("overdue money is counted apart", f.overdue === 5000, String(f.overdue));
  ok("money out nets against money in for the week", f.week === 3000 - 1000, String(f.week));
  ok("the month bucket picks up the rest", f.month === 2000, String(f.month));
  ok("a settled cheque is not in the forecast", f.overdue + f.week + f.month + f.later === 9000);
}

/* ============================================ recording touches no ledger = */
const company = await db.company.findFirst({ where: { code: "WBE" } });
const TAG = "CHQ-TEST";
const clean = async () => {
  const ids = (await db.cheque.findMany({ where: { chequeNo: { startsWith: "ZZ" } }, select: { id: true } })).map((c) => c.id);
  if (ids.length) await db.cheque.deleteMany({ where: { id: { in: ids } } });
  const eids = (await db.journalEntry.findMany({ where: { memo: { contains: "ZZ9" } }, select: { id: true } })).map((e) => e.id);
  if (eids.length) await db.journalEntry.deleteMany({ where: { id: { in: eids } } });
};
await clean();

const customer = await db.party.findFirst({ where: { companyId: company.id, type: { in: ["Customer", "Both"] } } });
const vouchersBefore = await db.journalEntry.count({ where: { companyId: company.id } });

const cheque = await db.cheque.create({
  data: {
    companyId: company.id, direction: "Received", chequeNo: "ZZ9001", bankName: "Test Bank",
    chequeDate: new Date("2026-09-20T00:00:00.000Z"), amount: 25000,
    partyId: customer.id, partyName: customer.name, status: "In hand", heldBy: "Safe",
  },
});
ok("a cheque can be recorded", !!cheque.id);
ok("recording it writes no voucher",
  (await db.journalEntry.count({ where: { companyId: company.id } })) === vouchersBefore,
  "the bank balance must not move on a promise");
ok("it starts in hand and unsettled", cheque.status === "In hand" && cheque.entryId === null);

/* ================================== the same cheque cannot be entered twice */
{
  let clashed = false;
  try {
    await db.cheque.create({
      data: {
        companyId: company.id, direction: "Received", chequeNo: "ZZ9001", bankName: "Test Bank",
        chequeDate: new Date("2026-09-20T00:00:00.000Z"), amount: 25000, status: "In hand",
      },
    });
  } catch {
    clashed = true;
  }
  ok("the same number from the same bank is refused", clashed, "otherwise the forecast doubles");

  // The same number from a different bank is a genuinely different cheque.
  const other = await db.cheque.create({
    data: {
      companyId: company.id, direction: "Received", chequeNo: "ZZ9001", bankName: "Another Bank",
      chequeDate: new Date("2026-09-21T00:00:00.000Z"), amount: 100, status: "In hand",
    },
  });
  ok("the same number from a different bank is allowed", !!other.id);
}

/* ============================ clearing posts once, and only once ========= */
// The action cannot be called from here — it needs a request context — so the
// same posting it performs is run directly, which is where the accounting risk
// actually lives.
{
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId: company.id, code: { in: ["1000", "1100", "2000"] } },
  });
  const bank = accounts.find((a) => a.code === "1000");
  const ar = accounts.find((a) => a.code === "1100");

  const before = await db.journalEntry.count({ where: { companyId: company.id } });
  const cleared = await postVoucher({
    companyId: company.id, postedBy: "test", voucherType: "Receipt", date: "2026-09-20",
    partyId: cheque.partyId, memo: `Cheque ZZ9001 cleared`,
    lines: [
      { accountId: bank.id, debit: cheque.amount, credit: 0 },
      { accountId: ar.id, debit: 0, credit: cheque.amount },
    ],
    sourceType: "cheque", sourceId: cheque.id, source: "cheque",
  });
  ok("clearing posts a voucher", cleared.ok, cleared.ok ? cleared.reference : cleared.error);
  ok("  exactly one", (await db.journalEntry.count({ where: { companyId: company.id } })) === before + 1);

  const posted = await db.journalEntry.findUnique({ where: { id: cleared.entryId }, include: { lines: { include: { account: true } } } });
  ok("  it is a Receipt for a cheque received", posted.voucherType === "Receipt");
  ok("  the bank is debited", posted.lines.some((l) => l.account.code === "1000" && l.debit === 25000));
  ok("  and the customer credited", posted.lines.some((l) => l.account.code === "1100" && l.credit === 25000));
  ok("  it carries the cheque as its source", posted.sourceType === "cheque" && posted.sourceId === cheque.id);

  // The guard that matters: clicking Clear twice must not pay the cheque twice.
  const again = await postVoucher({
    companyId: company.id, postedBy: "test", voucherType: "Receipt", date: "2026-09-20",
    memo: "Cheque ZZ9001 cleared again",
    lines: [
      { accountId: bank.id, debit: cheque.amount, credit: 0 },
      { accountId: ar.id, debit: 0, credit: cheque.amount },
    ],
    sourceType: "cheque", sourceId: cheque.id,
  });
  ok("the same cheque cannot be cleared twice", !again.ok && /already been posted/i.test(again.error), again.error);

  await db.cheque.update({ where: { id: cheque.id }, data: { status: "Cleared", entryId: cleared.entryId } });
  const settled = await db.cheque.findUnique({ where: { id: cheque.id } });
  ok("the register records which voucher settled it", settled.entryId === cleared.entryId);
  ok("and it drops out of the open list", !OPEN_STATUSES.includes(settled.status));

  // Unpick, so re-running the suite starts clean.
  await db.cheque.update({ where: { id: cheque.id }, data: { entryId: null } });
  await db.journalEntry.delete({ where: { id: cleared.entryId } });
}

/* ================================================= the wiring in the action */
const actions = read("src/app/(app)/finance/cheques/actions.ts");
ok("every action checks permission",
  (actions.match(/await allow\("finance\.cheques"/g) || []).length === 4);
ok("clearing posts through the shared service",
  actions.includes("await postVoucher({") && actions.includes('from "@/lib/posting"'));
ok("a cleared cheque carries its source, so it cannot post twice",
  actions.includes('sourceType: "cheque"') && actions.includes("sourceId: cheque.id"));
ok("a received cheque clears as a Receipt and an issued one as a Payment",
  actions.includes('received ? "Receipt" : "Payment"'));
ok("only a legal next status is accepted", actions.includes("canMove(cheque.status, next)"));
ok("a posted cheque cannot be edited", actions.includes("Reverse the voucher in the Day Book to change it"));
ok("nor deleted", actions.includes("Reverse the voucher in the Day Book instead"));
ok("amounts are rounded to fils", actions.includes("toFils("));
ok("a party from another company is refused", actions.includes("not on this company"));

const page = read("src/app/(app)/finance/cheques/page.tsx");
ok("the screen is permission-gated", page.includes('requireAccess("finance.cheques")'));
ok("it warns about cheques past their date", page.includes("still not banked"));
ok("it forecasts what is coming", page.includes("Next 7 days") && page.includes("Next 30 days"));
ok("it says plainly that recording does not touch the accounts",
  page.includes("does not touch the accounts"));
ok("it can be printed and exported", page.includes("PrintReport") && page.includes('dataset="cheques"'));

ok("the screen is registered for access control", read("src/lib/rbac.ts").includes('"finance.cheques"'));
ok("and granted to the finance roles", read("prisma/seed.mjs").includes('"finance.cheques"'));
ok("the tab is wired", read("src/lib/moduletabs.ts").includes("/finance/cheques"));
ok("the export is registered", read("src/app/(app)/export/actions.ts").includes("  cheques,"));

await clean();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
