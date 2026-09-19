/**
 * Totals the database now adds up, checked against the loops they replaced.
 *
 * Profiling every screen with three years of data (scripts/profile-pages.mjs)
 * found screens loading tens of thousands of rows to add them up in Node:
 * every party voucher for Outstanding and the cash-flow forecast, every line
 * charged to a job for Job Costing and WIP, every movement of every store for
 * the Stores screen. Each now asks the database for the totals.
 *
 * A faster wrong answer is worse than a slow right one, so this builds a
 * company with deliberately awkward data — vouchers touching both control
 * accounts, lines on accounts that are neither income nor expense, movements
 * with and without bins, rejected and pending inspection — then works every
 * figure out both ways and requires them to agree to the fil.
 */
import { importLibs } from "./lib-shim.mjs";

const libs = await importLibs(["db", "ledger-query", "stock-totals", "stock", "bins"]);
const { db } = libs.db;
const { partyControlVouchers, incomeAndCostBy } = libs["ledger-query"];
const { totalsByStore, totalsByItemAndStore } = libs["stock-totals"];
const { balanceOf } = libs.stock;
const { binQuantities } = libs.bins;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const same = (a, b) => Math.abs(a - b) < 0.005;
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const template = await db.company.findFirst({ where: { code: "WBE" } });
const code = `QT${String(Date.now()).slice(-5)}`;
let company = null;
try {
  company = await db.company.create({ data: { tenantId: template.tenantId, code, name: `${code} totals test`, fyStartMonth: 1 } });
  const cid = company.id;
  const chart = await db.chartOfAccount.findMany({ where: { companyId: template.id } });
  await db.chartOfAccount.createMany({ data: chart.map((a) => ({ companyId: cid, code: a.code, name: a.name, type: a.type, parentGroup: a.parentGroup, controlType: a.controlType })) });
  const accounts = await db.chartOfAccount.findMany({ where: { companyId: cid } });
  const receivable = accounts.filter((a) => a.controlType === "Receivable");
  const payable = accounts.filter((a) => a.controlType === "Payable");
  ok("the chart has both control accounts to test against", receivable.length > 0 && payable.length > 0);

  await db.party.createMany({ data: Array.from({ length: 8 }, (_, i) => ({ companyId: cid, code: `${code}-P${i}`, name: `P${i}`, type: i % 2 ? "Customer" : "Supplier" })) });
  await db.job.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ companyId: cid, code: `${code}-J${i}`, name: `J${i}` })) });
  await db.costCentre.createMany({ data: Array.from({ length: 4 }, (_, i) => ({ companyId: cid, code: `${code}-C${i}`, name: `C${i}` })) });
  const parties = await db.party.findMany({ where: { companyId: cid } });
  const jobs = await db.job.findMany({ where: { companyId: cid } });
  const centres = await db.costCentre.findMany({ where: { companyId: cid } });

  // 300 vouchers of three to five lines, over two years, on any account.
  for (let v = 0; v < 300; v++) {
    const entry = await db.journalEntry.create({ data: {
      companyId: cid, reference: `${code}/${v}`, postedBy: "t", voucherType: pick(["Sales", "Purchase", "Receipt", "Payment", "Journal"]),
      date: new Date(Date.UTC(2025, 0, 1) + Math.floor(rnd() * 730) * 864e5), partyId: rnd() < 0.7 ? pick(parties).id : null,
    } });
    const n = 3 + Math.floor(rnd() * 3);
    await db.journalLine.createMany({ data: Array.from({ length: n }, () => {
      const amt = Math.round(rnd() * 100000) / 100;
      const acc = rnd() < 0.35 ? pick([...receivable, ...payable]) : pick(accounts);
      return { entryId: entry.id, accountId: acc.id, debit: rnd() < 0.5 ? amt : 0, credit: rnd() < 0.5 ? 0 : amt,
        jobId: rnd() < 0.5 ? pick(jobs).id : null, costCentreId: rnd() < 0.4 ? pick(centres).id : null };
    }) });
  }

  /* ------------------------------------------- party control vouchers -- */
  const controlIds = [...receivable, ...payable].map((a) => a.id);
  const oldEntries = await db.journalEntry.findMany({
    where: { companyId: cid, partyId: { not: null } },
    include: { lines: { select: { debit: true, credit: true, accountId: true } } },
    orderBy: { date: "asc" },
  });
  const netOld = new Map();
  for (const e of oldEntries) {
    const net = e.lines.filter((l) => controlIds.includes(l.accountId)).reduce((s, l) => s + l.debit - l.credit, 0);
    if (Math.abs(net) >= 0.001) netOld.set(e.reference, { net, partyId: e.partyId, date: e.date.getTime() });
  }
  const fresh = await partyControlVouchers(cid, controlIds);
  const netNew = new Map();
  for (const e of fresh) {
    const net = e.lines.reduce((s, l) => s + l.debit - l.credit, 0);
    if (Math.abs(net) >= 0.001) netNew.set(e.reference, { net, partyId: e.partyId, date: e.date.getTime() });
  }
  ok("every party voucher on a control account is found", netOld.size === netNew.size && netOld.size > 20, `${netOld.size} before, ${netNew.size} now`);
  ok("  with the same amount, party and date on each",
    [...netOld].every(([ref, o]) => { const n = netNew.get(ref); return n && same(n.net, o.net) && n.partyId === o.partyId && n.date === o.date; }));
  ok("  and only lines on the control accounts come back", fresh.every((e) => e.lines.every((l) => controlIds.includes(l.accountId))));
  ok("  oldest first, which is the order receipts settle invoices in", fresh.every((e, i) => i === 0 || fresh[i - 1].date <= e.date));
  ok("no control accounts means nothing to read", (await partyControlVouchers(cid, [])).length === 0);

  /* --------------------------------------- income and cost per job etc -- */
  for (const [dimension, list, label] of [["jobId", jobs, "job"], ["costCentreId", centres, "cost centre"]]) {
    for (const period of [undefined, { from: new Date(Date.UTC(2025, 6, 1)), to: new Date(Date.UTC(2026, 2, 31, 23, 59, 59)) }]) {
      const lines = await db.journalLine.findMany({
        where: { [dimension]: { in: list.map((x) => x.id) }, ...(period ? { entry: { date: { gte: period.from, lte: period.to } } } : {}) },
        include: { account: { select: { type: true } } },
      });
      const fresh = await incomeAndCostBy(dimension, list.map((x) => x.id), cid, period);
      let agree = 0;
      for (const x of list) {
        let income = 0, cost = 0;
        for (const l of lines.filter((l) => l[dimension] === x.id)) {
          const net = l.debit - l.credit;
          if (l.account.type === "Income") income += -net;
          else if (l.account.type === "Expense") cost += net;
        }
        const n = fresh.get(x.id) ?? { income: 0, cost: 0 };
        if (same(n.income, income) && same(n.cost, cost)) agree++;
      }
      ok(`income and cost per ${label}${period ? " in a period" : ", all time"} match the old loop`, agree === list.length, `${agree}/${list.length}`);
    }
  }

  /* ----------------------------------------------------- stores & bins -- */
  const stores = [];
  for (let s = 0; s < 3; s++) stores.push(await db.store.create({ data: { companyId: cid, code: `${code}-S${s}`, name: `S${s}` } }));
  const bins = [];
  for (const s of stores.slice(0, 2)) for (let b = 0; b < 3; b++) bins.push(await db.storageBin.create({ data: { storeId: s.id, code: `B${b}` } }));
  await db.item.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ companyId: cid, code: `${code}-I${i}`, name: `I${i}`, unitCode: "EA" })) });
  const items = await db.item.findMany({ where: { companyId: cid } });
  const KINDS = ["Receipt", "Receipt", "Issue", "Return to store", "Return to supplier", "Adjustment in", "Adjustment out"];
  await db.stockMovement.createMany({ data: Array.from({ length: 600 }, (_, i) => {
    const store = pick(stores);
    const storeBins = bins.filter((b) => b.storeId === store.id);
    const q = Math.round(rnd() * 5000) / 100;
    const kind = pick(KINDS);
    return { companyId: cid, itemId: pick(items).id, storeId: store.id, binId: storeBins.length && rnd() < 0.7 ? pick(storeBins).id : null,
      kind, date: new Date(Date.UTC(2026, 0, 1) + i * 36e5), quantity: q, unitCost: 3.5, value: Math.round(q * 350) / 100, reference: `${code}/M${i}`,
      jobId: kind === "Issue" ? pick(jobs).id : null, inspection: kind === "Receipt" ? pick([null, "Pending", "Passed", "Rejected"]) : null };
  }) });

  const byStore = await totalsByStore(cid);
  let storesAgree = 0;
  for (const s of stores) {
    const movements = await db.stockMovement.findMany({ where: { storeId: s.id }, select: { kind: true, quantity: true, value: true, binId: true, inspection: true } });
    const t = byStore.get(s.id) ?? { groups: [], count: 0 };
    const a = balanceOf(movements), b = balanceOf(t.groups);
    const ba = binQuantities(movements), bb = binQuantities(t.groups);
    const binsAgree = Object.keys({ ...ba, ...bb }).every((k) => same(ba[k] ?? 0, bb[k] ?? 0));
    if (same(a.value, b.value) && same(a.quantity, b.quantity) && binsAgree && t.count === movements.length) storesAgree++;
  }
  ok("each store's value held, bin contents and movement count match the old loop", storesAgree === stores.length, `${storesAgree}/${stores.length}`);

  const shelves = await totalsByItemAndStore(cid);
  let shelvesAgree = 0, shelvesTotal = 0;
  for (const s of stores) for (const it of items) {
    const movements = await db.stockMovement.findMany({ where: { storeId: s.id, itemId: it.id }, select: { kind: true, quantity: true, value: true, inspection: true } });
    if (!movements.length) continue;
    shelvesTotal++;
    const a = balanceOf(movements), b = balanceOf(shelves.get(`${it.id}:${s.id}`) ?? []);
    if (same(a.averageCost, b.averageCost) && same(a.usable, b.usable) && same(a.quantity, b.quantity)) shelvesAgree++;
  }
  ok("each shelf's quantity, usable stock and average cost match (Site Returns)", shelvesAgree === shelvesTotal && shelvesTotal > 20, `${shelvesAgree}/${shelvesTotal}`);

  const onJobs = await db.stockMovement.groupBy({ by: ["jobId", "itemId", "kind"], where: { companyId: cid, jobId: { not: null }, kind: { in: ["Issue", "Return to store"] } }, _sum: { quantity: true } });
  const raw = await db.stockMovement.findMany({ where: { companyId: cid, jobId: { not: null }, kind: { in: ["Issue", "Return to store"] } } });
  const issuedRaw = raw.filter((m) => m.kind === "Issue").reduce((s, m) => s + m.quantity, 0);
  const issuedGrouped = onJobs.filter((g) => g.kind === "Issue").reduce((s, g) => s + (g._sum.quantity ?? 0), 0);
  ok("what each job has out adds up the same grouped as row by row", same(issuedRaw, issuedGrouped) && issuedRaw > 0);
} finally {
  if (company) {
    const id = company.id;
    await db.stockMovement.deleteMany({ where: { companyId: id } });
    await db.storageBin.deleteMany({ where: { store: { companyId: id } } });
    await db.store.deleteMany({ where: { companyId: id } });
    await db.item.deleteMany({ where: { companyId: id } });
    await db.journalLine.deleteMany({ where: { entry: { companyId: id } } });
    await db.journalEntry.deleteMany({ where: { companyId: id } });
    await db.costCentre.deleteMany({ where: { companyId: id } });
    await db.job.deleteMany({ where: { companyId: id } });
    await db.party.deleteMany({ where: { companyId: id } });
    await db.chartOfAccount.deleteMany({ where: { companyId: id } });
    await db.company.delete({ where: { id } }).catch((e) => console.log("  cleanup: " + e.message));
  }
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
