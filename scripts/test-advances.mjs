/**
 * Customer and supplier advances.
 *
 * Two things have to hold. The balance left on an advance has to be derived
 * from its recoveries rather than maintained by hand, because a figure that is
 * maintained by hand drifts and this one is set off in slices over a year. And
 * the posting has to keep an advance out of the profit and loss entirely: it is
 * a liability or an asset until the work is billed, and booking it as income
 * flatters the month it arrived and starves every month after.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";



/**
 * The accounting is driven through lib/advance-posting, not through the
 * screen's server actions. An action needs a request behind it, so a suite
 * that tried to call one could only ever read it as text — and the rules that
 * decide which account is debited are worth more than that.
 */
const libs = await importLibs([
  "advance-posting", "advances", "posting", "accounts", "financepolicy", "money", "db", "period", "vat",
]);
const { db } = libs["db"];
const { recordAdvance, recoverAdvance, closeAdvance } = libs["advance-posting"];
const {
  DIRECTIONS, DIRECTION_HELP, STATUSES, STATUS_HELP,
  recovered, outstanding, advanceState, checkRecovery, recoveryOn,
  summarise, advancesVerdict,
} = libs["advances"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
const adv = (amount, recoveries = [], direction = "Received", status = "Open") =>
  ({ direction, amount, status, recoveries: recoveries.map((a) => ({ amount: a })) });

/* ===================================================== the arithmetic ==== */

ok("both directions exist", DIRECTIONS.length === 2 && DIRECTIONS.includes("Received") && DIRECTIONS.includes("Paid"));
ok("each is explained in plain English",
  DIRECTIONS.every((d) => (DIRECTION_HELP[d] || "").length > 40));
ok("every status is explained too",
  STATUSES.every((s) => (STATUS_HELP[s] || "").length > 30), STATUSES.join(", "));

ok("nothing recovered on a new advance", recovered(adv(100000)) === 0);
ok("the whole amount is outstanding", outstanding(adv(100000)) === 100000);

const part = adv(100000, [15000, 15000, 20000]);
ok("recoveries add up", recovered(part) === 50000);
ok("and what is left is derived, not stored", outstanding(part) === 50000);

ok("a fully recovered advance leaves nothing", outstanding(adv(100000, [100000])) === 0);

/**
 * An over-recovery is refused when it is entered, but if one ever got in, the
 * balance must read nil rather than negative. A negative balance on a customer
 * advance looks exactly like the customer owing us money.
 */
ok("an over-recovered advance reads nil, never negative",
  outstanding(adv(100000, [120000])) === 0);

ok("fils survive the arithmetic", outstanding(adv(1000.55, [333.18])) === 667.37,
  String(outstanding(adv(1000.55, [333.18]))));

/* -------------------------------------------------------------- state --- */
const st = advanceState(part);
ok("state reports both halves", st.recovered === 50000 && st.outstanding === 50000);
ok("and the share recovered", st.share === 0.5);
ok("an untouched advance says so", advanceState(adv(50000)).untouched === true);
ok("one fully set off is flagged even while still marked Open",
  advanceState(adv(100000, [100000])).fullyRecovered === true,
  "an advance sitting Open at nil is what stops a register being trusted");

/* ------------------------------------------------------- the refusals --- */
ok("nothing can be recovered from a closed advance",
  checkRecovery(adv(100000, [], "Received", "Refunded"), 10) .ok === false);
ok("nor from one already fully recovered",
  checkRecovery(adv(100000, [100000]), 10).ok === false);
ok("a nil or negative recovery is refused", checkRecovery(adv(100000), 0).ok === false);

const tooMuch = checkRecovery(adv(100000, [60000]), 50000);
ok("recovering more than is left is refused", tooMuch.ok === false);
ok("and the refusal names what remains", /40,000/.test(tooMuch.error), tooMuch.error);
ok("recovering exactly what is left is allowed", checkRecovery(adv(100000, [60000]), 40000).ok === true);

/* --------------------------------------------------------- percentages -- */
ok("ten per cent of a certificate", recoveryOn(250000, 10) === 25000);
ok("an odd rate still lands on fils", recoveryOn(133333.33, 7.5) === 10000,
  String(recoveryOn(133333.33, 7.5)));
ok("no rate recovers nothing", recoveryOn(250000, 0) === 0);

/* ------------------------------------------------------------ summary --- */
const mixed = [
  adv(200000, [50000], "Received"),
  adv(100000, [100000], "Received", "Recovered"),
  adv(60000, [20000], "Paid"),
];
const sum = summarise(mixed);
ok("customer advances total on their own side",
  sum.Received.advanced === 300000 && sum.Received.recovered === 150000);
ok("a closed advance stops counting as outstanding",
  sum.Received.outstanding === 150000, "only the open 200,000 advance has a balance");
ok("supplier advances are kept separate",
  sum.Paid.advanced === 60000 && sum.Paid.outstanding === 40000);
ok("open advances are counted", sum.openCount === 2);

ok("an empty register says so plainly", /No advances recorded/.test(advancesVerdict([])));
ok("held customer money leads the sentence",
  /Holding 150,000\.00 of customer money/.test(advancesVerdict([mixed[0], mixed[1]])),
  advancesVerdict([mixed[0], mixed[1]]));
ok("both sides are named when both exist",
  /Holding .* and waiting on /.test(advancesVerdict(mixed)), advancesVerdict(mixed));
ok("a fully recovered register says nothing is left",
  /fully recovered/.test(advancesVerdict([mixed[1]])), advancesVerdict([mixed[1]]));

/* ================================================ posting, on real data == */

const co = await db.company.findFirst({ where: { code: "WBE" } });
const party = await db.party.findFirst({ where: { companyId: co.id } });
const bank = await db.chartOfAccount.findFirst({ where: { companyId: co.id, controlType: "Cash" } });
const custAcc = await db.chartOfAccount.findFirst({ where: { companyId: co.id, code: "2300" } });
const suppAcc = await db.chartOfAccount.findFirst({ where: { companyId: co.id, code: "1180" } });
const arAcc = await db.chartOfAccount.findFirst({ where: { companyId: co.id, code: "1100" } });

ok("the chart carries an account for customer advances", !!custAcc, custAcc?.name);
ok("and one for supplier advances", !!suppAcc, suppAcc?.name);
ok("a cash or bank account is marked as such", !!bank, bank?.name);

/** The lines of the voucher a register row posted, by account code. */
async function linesOf(entryId) {
  const e = await db.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { include: { account: { select: { code: true, type: true } } } } },
  });
  return {
    voucherType: e.voucherType,
    lines: e.lines.map((l) => ({ code: l.account.code, type: l.account.type, debit: l.debit, credit: l.credit })),
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const made = [];

/** Record an advance with the everyday fields filled in. */
async function record(fields) {
  const res = await recordAdvance({
    companyId: co.id,
    postedBy: "tester",
    bankAccountId: bank.id,
    partyId: party.id,
    date: today(),
    ...fields,
  });
  if (!res.ok) return { res, row: null };
  made.push(res.advanceId);
  const row = await db.partyAdvance.findUnique({
    where: { id: res.advanceId },
    include: { recoveries: true },
  });
  return { res, row };
}

const tag = `TEST-ADV-${Date.now()}`;

try {
  /* ------------------------------------------- a customer advance posts -- */
  {
    const { res, row } = await record({ direction: "Received", reference: `${tag}-A`, amount: 100000 });
    ok("a customer advance is recorded", res.ok, res.ok ? "" : res.error);
    ok("and it posts", !!row?.entryId);

    const v = await linesOf(row.entryId);
    ok("as a receipt", v.voucherType === "Receipt", v.voucherType);
    const bankLine = v.lines.find((l) => l.code === bank.code);
    const advLine = v.lines.find((l) => l.code === "2300");
    ok("the bank is debited with the money that arrived", bankLine?.debit === 100000);
    ok("and the advance account is credited", advLine?.credit === 100000);
    ok("the voucher balances",
      v.lines.reduce((t, l) => t + l.debit, 0) === v.lines.reduce((t, l) => t + l.credit, 0));

    /**
     * The whole point. An advance in the profit and loss overstates the month
     * it arrived and understates every month after it.
     */
    ok("nothing lands in income or expense",
      v.lines.every((l) => l.type !== "Income" && l.type !== "Expense"),
      "an advance is a liability, not revenue");
    ok("and the advance sits as a liability", advLine && v.lines.find((l) => l.code === "2300"));

    ok("the register opens it", row.status === "Open");
    ok("with the whole amount outstanding", outstanding(row) === 100000);
  }

  /* ------------------------------------------ a supplier advance posts --- */
  {
    const { res, row } = await record({ direction: "Paid", reference: `${tag}-B`, amount: 40000 });
    ok("a supplier advance is recorded", res.ok, res.ok ? "" : res.error);
    const v = await linesOf(row.entryId);
    ok("as a payment", v.voucherType === "Payment", v.voucherType);
    ok("the advance account is debited, because they owe it to us",
      v.lines.find((l) => l.code === "1180")?.debit === 40000);
    ok("and the bank is credited", v.lines.find((l) => l.code === bank.code)?.credit === 40000);
    ok("still nothing in the profit and loss",
      v.lines.every((l) => l.type !== "Income" && l.type !== "Expense"));
  }

  /* --------------------------------------------------------- recovery ---- */
  {
    const { row } = await record({ direction: "Received", reference: `${tag}-C`, amount: 90000, recoveryPercent: 10 });

    const res = await recoverAdvance({ advanceId: row.id, postedBy: "tester", amount: 30000, date: today() });
    ok("an advance can be recovered", res.ok, res.ok ? "" : res.error);

    const after = await db.partyAdvance.findUnique({ where: { id: row.id }, include: { recoveries: true } });
    ok("the recovery is its own row", after.recoveries.length === 1);
    ok("and the balance follows from it", outstanding(after) === 60000);
    ok("the advance is still open", after.status === "Open");

    const v = await linesOf(after.recoveries[0].entryId);
    ok("the recovery posts as a journal", v.voucherType === "Journal", v.voucherType);
    ok("the liability comes down", v.lines.find((l) => l.code === "2300")?.debit === 30000);
    ok("and the customer owes that much less", v.lines.find((l) => l.code === arAcc.code)?.credit === 30000);
    ok("the bank is untouched — the money arrived months ago",
      !v.lines.some((l) => l.code === bank.code));

    /* over-recovery is refused against the real row, not just in the library */
    const bad = await recoverAdvance({ advanceId: row.id, postedBy: "tester", amount: 60000.01, date: today() });
    ok("recovering more than is left is refused on the real record", bad.ok === false, bad.error);

    const before = await db.partyAdvanceRecovery.count({ where: { advanceId: row.id } });
    ok("and the refusal leaves no half-written recovery behind", before === 1);

    /* the last slice closes it by itself */
    const done = await recoverAdvance({ advanceId: row.id, postedBy: "tester", amount: 60000, date: today() });
    ok("the final slice is accepted", done.ok, done.ok ? "" : done.error);

    const closed = await db.partyAdvance.findUnique({ where: { id: row.id }, include: { recoveries: true } });
    ok("and the advance closes itself at nil", closed.status === "Recovered",
      "nobody has to remember to tidy it up");
    ok("with nothing left", outstanding(closed) === 0);

    ok("nothing further can be recovered",
      (await recoverAdvance({ advanceId: row.id, postedBy: "tester", amount: 1, date: today() })).ok === false);
  }

  /* ----------------------------------------------------------- refund ---- */
  {
    const { row } = await record({ direction: "Received", reference: `${tag}-D`, amount: 25000 });
    const res = await closeAdvance({
      advanceId: row.id, postedBy: "tester", status: "Refunded", bankAccountId: bank.id, date: today(),
    });
    ok("an advance can be refunded", res.ok, res.ok ? "" : res.error);

    const after = await db.partyAdvance.findUnique({ where: { id: row.id } });
    ok("and is marked refunded", after.status === "Refunded");

    const voucher = await db.journalEntry.findFirst({
      where: { companyId: co.id, sourceType: "advance-close", sourceId: row.id },
      include: { lines: { include: { account: { select: { code: true, type: true } } } } },
    });
    ok("the refund reverses the original", voucher.lines.find((l) => l.account.code === "2300")?.debit === 25000);
    ok("and money really leaves the bank",
      voucher.lines.find((l) => l.account.code === bank.code)?.credit === 25000,
      "unlike a recovery, a refund moves cash");
  }

  /* -------------------------------------------------------- write-off ---- */
  {
    const { row } = await record({ direction: "Paid", reference: `${tag}-E`, amount: 12000 });
    const expense = await db.chartOfAccount.findFirst({ where: { companyId: co.id, type: "Expense" } });
    const res = await closeAdvance({
      advanceId: row.id, postedBy: "tester", status: "Written off", writeOffAccountId: expense.id, date: today(),
    });
    ok("an advance can be written off", res.ok, res.ok ? "" : res.error);

    const voucher = await db.journalEntry.findFirst({
      where: { companyId: co.id, sourceType: "advance-close", sourceId: row.id },
      include: { lines: { include: { account: { select: { code: true, type: true } } } } },
    });
    ok("the write-off takes the cost", voucher.lines.some((l) => l.account.type === "Expense" && l.debit === 12000),
      "a write-off is a decision, so it reaches the profit and loss where an advance never does");
    ok("and clears the advance account", voucher.lines.find((l) => l.account.code === "1180")?.credit === 12000);
    ok("no cash moves on a write-off", !voucher.lines.some((l) => l.account.code === bank.code));
  }

  /* ------------------------------------------------------- duplicates ---- */
  {
    const first = await record({ direction: "Received", reference: `${tag}-F`, amount: 5000 });
    ok("the first one is accepted", first.res.ok);
    const again = await record({ direction: "Received", reference: `${tag}-F`, amount: 5000 });
    ok("the same reference twice is refused", again.res.ok === false, again.res.error);
    ok("and the refusal says what is already there", /already on the register/.test(again.res.error || ""));
  }

  /* ------------------------------------------------------- validation ---- */
  {
    const res = await recordAdvance({
      companyId: co.id, postedBy: "tester", bankAccountId: bank.id, partyId: "",
      direction: "Received", reference: `${tag}-G`, amount: 1000, date: today(),
    });
    ok("an advance with no party is refused", res.ok === false);
    ok("because it could never be recovered against anything",
      /cannot be recovered/.test(res.error || ""), res.error);

    const noBank = await recordAdvance({
      companyId: co.id, postedBy: "tester", bankAccountId: "", partyId: party.id,
      direction: "Received", reference: `${tag}-H`, amount: 1000, date: today(),
    });
    ok("and one with no bank account is refused too", noBank.ok === false, noBank.error);

    const zero = await record({ direction: "Received", reference: `${tag}-I`, amount: 0 });
    ok("a nil advance is refused", zero.res.ok === false, zero.res.error);
  }

  /* -------------------------------------- editing cannot rewrite the past - */
  {
    /**
     * The amount and the date are on a posted voucher. The edit action must
     * not carry either into the update, or the register silently stops
     * agreeing with the ledger it is supposed to prove.
     */
    const actions = read("src/app/(app)/finance/advances/actions.ts");
    const body = actions.slice(actions.indexOf("export async function updateAdvance"));
    ok("the edit action writes only the descriptive fields",
      /data: \{[\s\S]*?jobId,[\s\S]*?recoveryPercent:[\s\S]*?notes:[\s\S]*?\}/.test(body));
    ok("and never the amount", !/amount/.test(body),
      "it is on a posted voucher; reverse that in the Day Book instead");
    ok("nor the date", !/date/.test(body));
  }
} finally {
  // Everything this suite posted, removed in dependency order.
  for (const id of made) {
    const row = await db.partyAdvance.findUnique({ where: { id }, include: { recoveries: true } });
    if (!row) continue;
    const entryIds = [row.entryId, ...row.recoveries.map((r) => r.entryId)].filter(Boolean);
    const closes = await db.journalEntry.findMany({
      where: { companyId: row.companyId, sourceType: "advance-close", sourceId: row.id },
      select: { id: true },
    });
    await db.partyAdvanceRecovery.deleteMany({ where: { advanceId: id } });
    await db.partyAdvance.delete({ where: { id } });
    for (const eid of [...entryIds, ...closes.map((c) => c.id)]) {
      await db.journalLine.deleteMany({ where: { entryId: eid } });
      await db.journalEntry.delete({ where: { id: eid } }).catch(() => {});
    }
  }
}

/* ==================================================== how it is wired ==== */

const schema = read("prisma/schema.prisma");
ok("the register is its own table", /model PartyAdvance \{/.test(schema));
ok("and recoveries are rows, not a running total",
  /model PartyAdvanceRecovery \{/.test(schema),
  "a balance that is calculated cannot drift; one kept by hand will");
ok("it is not confused with the employee salary advance",
  /model Advance \{[\s\S]*?employeeId/.test(schema), "two different things, two different tables");
ok("the same reference cannot be entered twice on one side",
  /@@unique\(\[companyId, direction, reference\]\)/.test(schema));

const policy = read("src/lib/financepolicy.ts");
ok("both control accounts are roles, not numbers in the code",
  /key: "customerAdvances"/.test(policy) && /key: "supplierAdvances"/.test(policy),
  "a customer with their own chart remaps them on Finance -> Settings");

const seed = read("prisma/seed.mjs");
ok("and the chart carries them", /"2300", "Advances from Customers"/.test(seed) && /"1180", "Advances to Suppliers"/.test(seed));
ok("the finance roles are granted the screen", /"finance\.advances"/.test(seed));

ok("the screen is registered", /key: "finance\.advances"/.test(read("src/lib/rbac.ts")));
ok("it has a tab", /href: "\/finance\/advances"/.test(read("src/lib/moduletabs.ts")));
ok("and a card in the report centre", /key: "advances"/.test(read("src/lib/reports.ts")));

const page = read("src/app/(app)/finance/advances/page.tsx");
ok("the screen renders its tab strip", /<FinanceTabs/.test(page), "otherwise it is a dead end");
ok("it reconciles the register to the ledger", /balanceOf\(/.test(page));
ok("only cash and bank accounts are offered", /controlType: "Cash"/.test(page),
  "offering the whole chart is how an advance ends up credited to revenue");
ok("and only issued invoices can be set against", /status: "Issued"/.test(page));

const helpSrc = read("src/lib/help.ts");
for (const id of [
  "customer-supplier-advances",
  "customer-supplier-advances-vat",
  "customer-supplier-advances-recovering",
]) {
  ok(`there is plain-English help: ${id}`, new RegExp(`id: "${id}"`).test(helpSrc));
}
ok("the VAT position is written down, not left to be discovered",
  /tax point/.test(helpSrc) && /declared twice/i.test(helpSrc));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
