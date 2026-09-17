/**
 * Performance and stress test against a PostgreSQL database — run through
 * scripts/perf-uat.mjs, never directly.
 *
 * Everything it writes goes into one scratch company created for the run, and
 * the whole company is removed at the end, pass or fail. Before anything is
 * written every table in the database is counted; after cleanup every table
 * is counted again, and the run fails loudly if a single row is left behind.
 *
 * Four parts:
 *   1. Volume   — reports and stock screens with years of data behind them.
 *   2. Races    — many people doing the same thing at the same instant:
 *                 posting vouchers, issuing the last of the stock, receiving
 *                 against one order line, numbering orders and requests.
 *   3. Soak     — a mixed crowd of readers and writers for a fixed time.
 *   4. Soundness — the ledger and the stock still add up afterwards.
 *
 * Environment (set by the wrapper): DATABASE_URL, PERF_CONFIRM_HOST,
 * PERF_OUT (a JSON results file), PERF_SCALE (small | full).
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { importLibs } from "./lib-shim.mjs";

const url = process.env.DATABASE_URL || "";
const hostPort = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port || "5432"}`.toLowerCase(); } catch { return ""; } };
if (!/^postgres(ql)?:\/\//i.test(url) || !process.env.PERF_CONFIRM_HOST || hostPort(url) !== process.env.PERF_CONFIRM_HOST.toLowerCase()) {
  console.error("Run this through scripts/perf-uat.mjs, which confirms the target first.");
  process.exit(1);
}

const FULL = process.env.PERF_SCALE !== "small";
const VOUCHERS = FULL ? 20_000 : 2_000;
const MOVEMENTS = FULL ? 30_000 : 3_000;
const SOAK_SECONDS = FULL ? 60 : 15;

const libs = await importLibs(["db", "posting", "stock-posting", "purchase-posting", "ledger-query", "stock"]);
const { db } = libs.db;
const { postVoucher } = libs.posting;
const { recordMovement, balanceFor } = libs["stock-posting"];
const { createOrder, createRequest, receiveAgainstOrder } = libs["purchase-posting"];
const { accountBalances, profitAndLoss } = libs["ledger-query"];
const { balanceOf } = libs.stock;

const results = { target: process.env.PERF_CONFIRM_HOST, scale: FULL ? "full" : "small", startedAt: new Date().toISOString(), sections: {} };
const ms = (n) => `${Math.round(n)} ms`;
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const log = (s = "") => console.log(s);
const today = new Date().toISOString().slice(0, 10);

/* --------------------------------------------------- count every table -- */
async function countAll() {
  const tables = await db.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`,
  );
  const out = {};
  for (const { table_name } of tables) {
    const [{ n }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table_name}"`);
    out[table_name] = n;
  }
  return out;
}

async function timeIt(label, fn, runs = 5) {
  await fn();
  const t = [];
  for (let i = 0; i < runs; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s); }
  const r = { p50: Math.round(pct(t, 0.5)), p95: Math.round(pct(t, 0.95)) };
  log(`  ${label.padEnd(52)} p50 ${ms(r.p50).padStart(8)}   p95 ${ms(r.p95).padStart(8)}`);
  return r;
}

log(`\nTarget ${results.target} · ${results.scale} scale\n`);
log("Counting every table before anything is written…");
const before = await countAll();
log(`  ${Object.keys(before).length} tables, ${Object.values(before).reduce((a, b) => a + b, 0).toLocaleString()} rows\n`);

const tenant = (await db.tenant.findFirst({ where: { key: "wandb" } })) ?? (await db.tenant.findFirst());
const template = await db.company.findFirst({ where: { tenantId: tenant.id, code: "WBE" } }) ?? (await db.company.findFirst({ where: { tenantId: tenant.id } }));
const code = `PT${String(Date.now()).slice(-5)}`;
let company = null;
let failure = null;

try {
  /* ------------------------------------------------------------ set up -- */
  company = await db.company.create({
    data: { tenantId: tenant.id, code, name: `${code} performance test — removed automatically`, fyStartMonth: 1, vatTRN: "100000000000003" },
  });
  const chart = await db.chartOfAccount.findMany({ where: { companyId: template.id } });
  await db.chartOfAccount.createMany({
    data: chart.map((a) => ({ companyId: company.id, code: a.code, name: a.name, type: a.type, parentGroup: a.parentGroup, controlType: a.controlType })),
  });
  const acc = async (c) => db.chartOfAccount.findFirst({ where: { companyId: company.id, code: c } });
  const bank = (await db.chartOfAccount.findFirst({ where: { companyId: company.id, controlType: "Cash or bank" } })) ?? (await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Asset" } }));
  const income = await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Income" } });
  const expense = await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Expense" } });
  const liability = await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Liability" } });

  const supplier = await db.party.create({ data: { companyId: company.id, code: `${code}-SUP`, name: "PT Supplier", type: "Supplier" } });
  const job = await db.job.create({ data: { companyId: company.id, code: `${code}-J1`, name: "PT job" } });
  const store = await db.store.create({ data: { companyId: company.id, code: `${code}-S1`, name: "PT main store", isDefault: true } });
  const ITEMS = 60;
  await db.item.createMany({
    data: Array.from({ length: ITEMS }, (_, i) => ({ companyId: company.id, code: `${code}-I${String(i).padStart(3, "0")}`, name: `PT item ${i}`, unitCode: "EA", standardCost: 10 })),
  });
  const items = await db.item.findMany({ where: { companyId: company.id }, orderBy: { code: "asc" } });

  /* ---------------------------------------------------------- 1. volume -- */
  log(`1 · VOLUME — ${VOUCHERS.toLocaleString()} vouchers, ${MOVEMENTS.toLocaleString()} stock movements`);
  const t0 = performance.now();
  const start = Date.UTC(2023, 0, 1), span = Date.UTC(2026, 0, 1) - start, BATCH = 2000;
  for (let i = 0; i < VOUCHERS; i += BATCH) {
    const chunk = Math.min(BATCH, VOUCHERS - i);
    const entries = Array.from({ length: chunk }, (_, k) => ({
      companyId: company.id, date: new Date(start + Math.floor(((i + k) / VOUCHERS) * span)),
      voucherType: "Journal", reference: `${code}/VOL/${String(i + k).padStart(7, "0")}`, memo: "pt volume", postedBy: "pt",
    }));
    await db.journalEntry.createMany({ data: entries });
    const made = await db.journalEntry.findMany({ where: { companyId: company.id, reference: { in: entries.map((e) => e.reference) } }, select: { id: true } });
    await db.journalLine.createMany({
      data: made.flatMap((e) => [
        { entryId: e.id, accountId: bank.id, debit: 1050, credit: 0 },
        { entryId: e.id, accountId: income.id, debit: 0, credit: 1050 },
      ]),
    });
  }
  for (let i = 0; i < MOVEMENTS; i += BATCH) {
    const chunk = Math.min(BATCH, MOVEMENTS - i);
    await db.stockMovement.createMany({
      data: Array.from({ length: chunk }, (_, k) => {
        // Each item's own movements go receive, receive, issue, so no item's
        // running balance ever dips below zero in the loaded history.
        const n = i + k, inward = Math.floor(n / ITEMS) % 3 !== 2;
        return {
          companyId: company.id, itemId: items[n % ITEMS].id, storeId: store.id,
          kind: inward ? "Receipt" : "Issue", date: new Date(start + Math.floor((n / MOVEMENTS) * span)),
          quantity: inward ? 10 : 5, unitCost: 10, value: inward ? 100 : 50,
          jobId: inward ? null : job.id, reference: `${code}/MV/${n}`, createdBy: "pt",
        };
      }),
    });
  }
  const buildMs = performance.now() - t0;
  log(`  built in ${ms(buildMs)}\n`);

  const from = new Date(Date.UTC(2025, 0, 1)), to = new Date(Date.UTC(2025, 11, 31));
  const volume = {};
  volume["Trial balance, one year"] = await timeIt("Trial balance, one year", () => accountBalances(company.id, from, to, null));
  volume["Trial balance, all time"] = await timeIt("Trial balance, all time", () => accountBalances(company.id, new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2100, 0, 1)), null));
  volume["Profit and loss, one year"] = await timeIt("Profit and loss, one year", () => profitAndLoss(company.id, from, to, null));
  volume["Day book, first page"] = await timeIt("Day book, first page", () => db.journalEntry.findMany({ where: { companyId: company.id }, orderBy: { date: "desc" }, take: 50, include: { lines: true } }));
  volume["Day book, page 300"] = await timeIt("Day book, page 300", () => db.journalEntry.findMany({ where: { companyId: company.id }, orderBy: { date: "desc" }, skip: 15_000 > VOUCHERS ? Math.floor(VOUCHERS * 0.75) : 15_000, take: 50, include: { lines: true } }));
  // The Stock on Hand screen: every stocked item with every movement it has had.
  volume["Stock on Hand screen query"] = await timeIt("Stock on Hand screen query (all movements)", async () => {
    const rows = await db.item.findMany({ where: { companyId: company.id, isStocked: true }, include: { movements: { select: { kind: true, quantity: true, value: true, inspection: true } } }, orderBy: { code: "asc" } });
    return rows.map((r) => balanceOf(r.movements));
  }, 3);
  // Receive & Issue: all movements for the company, grouped in memory.
  volume["Receive & Issue balances query"] = await timeIt("Receive & Issue balances query (all movements)", () =>
    db.stockMovement.findMany({ where: { companyId: company.id }, select: { itemId: true, storeId: true, kind: true, quantity: true, value: true, inspection: true } }), 3);
  volume["One item's balance before an issue"] = await timeIt("One item's balance, checked before every issue", () => balanceFor(company.id, items[0].id, store.id));
  results.sections.volume = { vouchers: VOUCHERS, movements: MOVEMENTS, buildMs: Math.round(buildMs), timings: volume };

  /* ----------------------------------------------------------- 2. races -- */
  log("\n2 · RACES — everyone at the same instant");
  const races = {};

  // 2a. Voucher numbering.
  for (const workers of [5, 10, 25, 50]) {
    const t = performance.now();
    const rs = await Promise.all(Array.from({ length: workers }, (_, k) =>
      postVoucher({ companyId: company.id, postedBy: `pt-${k}`, voucherType: "Journal", date: today, memo: `race ${k}`,
        lines: [{ accountId: bank.id, debit: 100, credit: 0 }, { accountId: income.id, debit: 0, credit: 100 }] })
        .catch((e) => ({ ok: false, error: String(e?.message ?? e) }))));
    const refs = rs.filter((r) => r.ok).map((r) => r.reference);
    const dupes = refs.length - new Set(refs).size;
    const refused = rs.filter((r) => !r.ok);
    races[`Post ${workers} vouchers at once`] = { ms: Math.round(performance.now() - t), posted: refs.length, duplicates: dupes, refused: refused.length, sample: refused[0]?.error?.slice(0, 140) ?? null };
    log(`  post ${String(workers).padStart(2)} vouchers at once     ${ms(performance.now() - t).padStart(8)}   ${refs.length}/${workers} posted   ${dupes} duplicate numbers${refused.length ? `   ${refused.length} refused: ${refused[0].error?.slice(0, 90)}` : ""}`);
  }
  const nums = (await db.journalEntry.findMany({ where: { companyId: company.id, memo: { startsWith: "race" } }, select: { reference: true } }))
    .map((e) => Number(e.reference.split("/").pop())).sort((a, b) => a - b);
  const gaps = nums.filter((v, i) => i > 0 && v !== nums[i - 1] + 1).length;
  races["Voucher number gaps across all races"] = { gaps };
  log(`  gaps in the voucher sequence across those races: ${gaps}`);

  // 2b. The last ten on the shelf, twenty-five people issuing one each.
  const raceItem = await db.item.create({ data: { companyId: company.id, code: `${code}-RACE`, name: "PT race item", unitCode: "EA" } });
  const received = await recordMovement({ companyId: company.id, postedBy: "pt", kind: "Receipt", itemId: raceItem.id, storeId: store.id, date: today, quantity: 10, unitCost: 25, reference: `${code}/GRN/RACE` });
  if (!received.ok) throw new Error("Could not receive the race stock: " + received.error);
  const issues = await Promise.all(Array.from({ length: 25 }, (_, k) =>
    recordMovement({ companyId: company.id, postedBy: `pt-${k}`, kind: "Issue", itemId: raceItem.id, storeId: store.id, jobId: job.id, date: today, quantity: 1, reference: `${code}/ISS/${k}` })
      .catch((e) => ({ ok: false, error: String(e?.message ?? e) }))));
  const issued = issues.filter((r) => r.ok).length;
  const raceBalance = await balanceFor(company.id, raceItem.id, store.id);
  races["25 people issue 1 each from a shelf of 10"] = { issued, finalBalance: raceBalance.quantity, negative: raceBalance.quantity < 0 };
  log(`  25 issue 1 each from a shelf of 10   ${issued} issued, balance left ${raceBalance.quantity}${raceBalance.quantity < 0 ? "   ← STOCK WENT NEGATIVE" : ""}`);

  // 2c. One order line for 10, ten deliveries of 5 recorded at once.
  const po = await createOrder({ companyId: company.id, raisedBy: "pt", partyId: supplier.id, storeId: store.id, date: today,
    lines: [{ itemId: raceItem.id, description: "PT race line", unitCode: "EA", quantity: 10, unitPrice: 25 }] });
  if (!po.ok) throw new Error("Could not raise the race order: " + po.error);
  await db.purchaseOrder.update({ where: { id: po.orderId }, data: { status: "Approved", approvedBy: "pt", approvedAt: new Date() } });
  const line = await db.purchaseOrderLine.findFirst({ where: { orderId: po.orderId } });
  const receipts = await Promise.all(Array.from({ length: 10 }, (_, k) =>
    receiveAgainstOrder({ orderLineId: line.id, postedBy: `pt-${k}`, storeId: store.id, date: today, quantity: 5, reference: `${code}/DN/${k}` })
      .catch((e) => ({ ok: false, error: String(e?.message ?? e) }))));
  const accepted = receipts.filter((r) => r.ok).length;
  const receivedQty = (await db.stockMovement.aggregate({ where: { purchaseOrderLineId: line.id }, _sum: { quantity: true } }))._sum.quantity ?? 0;
  races["10 deliveries of 5 against an order line for 10"] = { accepted, receivedQuantity: receivedQty, overReceived: receivedQty > 10 };
  log(`  10 deliveries of 5 against a line of 10   ${accepted} accepted, ${receivedQty} received${receivedQty > 10 ? "   ← OVER-RECEIVED" : ""}`);

  // 2d. Document numbers for purchase orders and material requests.
  for (const [label, make] of [
    ["purchase orders", (k) => createOrder({ companyId: company.id, raisedBy: `pt-${k}`, partyId: supplier.id, date: today, lines: [{ description: `PT ${k}`, unitCode: "EA", quantity: 1, unitPrice: 1 }] })],
    ["material requests", (k) => createRequest({ companyId: company.id, requestedBy: `pt-${k}`, lines: [{ description: `PT ${k}`, unitCode: "EA", quantity: 1 }] })],
  ]) {
    const t = performance.now();
    const rs = await Promise.all(Array.from({ length: 25 }, (_, k) => make(k).catch((e) => ({ ok: false, error: String(e?.message ?? e) }))));
    const numbers = rs.filter((r) => r.ok).map((r) => r.number);
    const refused = rs.filter((r) => !r.ok);
    races[`Raise 25 ${label} at once`] = { ms: Math.round(performance.now() - t), created: numbers.length, duplicates: numbers.length - new Set(numbers).size, refused: refused.length, sample: refused[0]?.error?.slice(0, 140) ?? null };
    log(`  raise 25 ${label.padEnd(17)} at once   ${ms(performance.now() - t).padStart(8)}   ${numbers.length}/25 created   ${numbers.length - new Set(numbers).size} duplicate numbers${refused.length ? `   ${refused.length} refused: ${refused[0].error?.slice(0, 80)}` : ""}`);
  }
  results.sections.races = races;

  /* ------------------------------------------------------------ 3. soak -- */
  log(`\n3 · SOAK — a mixed crowd for ${SOAK_SECONDS}s at each size`);
  const soak = {};
  const soakItem = await db.item.create({ data: { companyId: company.id, code: `${code}-SOAK`, name: "PT soak item", unitCode: "EA" } });
  await recordMovement({ companyId: company.id, postedBy: "pt", kind: "Receipt", itemId: soakItem.id, storeId: store.id, date: today, quantity: 1_000_000, unitCost: 1, reference: `${code}/GRN/SOAK` });
  const ops = {
    "post a voucher": () => postVoucher({ companyId: company.id, postedBy: "pt-soak", voucherType: "Journal", date: today, memo: "soak",
      lines: [{ accountId: bank.id, debit: 10, credit: 0 }, { accountId: income.id, debit: 0, credit: 10 }] }),
    "receive stock": () => recordMovement({ companyId: company.id, postedBy: "pt-soak", kind: "Receipt", itemId: soakItem.id, storeId: store.id, date: today, quantity: 2, unitCost: 1, reference: `${code}/SOAK/R` }),
    "issue stock to a job": () => recordMovement({ companyId: company.id, postedBy: "pt-soak", kind: "Issue", itemId: soakItem.id, storeId: store.id, jobId: job.id, date: today, quantity: 1, reference: `${code}/SOAK/I` }),
    "trial balance (one year)": () => accountBalances(company.id, from, to, null),
    "one item's stock balance": () => balanceFor(company.id, items[1].id, store.id),
  };
  const weights = [["post a voucher", 2], ["receive stock", 1], ["issue stock to a job", 2], ["trial balance (one year)", 1], ["one item's stock balance", 4]];
  const deck = weights.flatMap(([k, w]) => Array(w).fill(k));
  for (const users of [10, 25]) {
    const stats = Object.fromEntries(Object.keys(ops).map((k) => [k, { t: [], errors: 0, sample: null }]));
    const stopAt = performance.now() + SOAK_SECONDS * 1000;
    let done = 0;
    await Promise.all(Array.from({ length: users }, async (_, u) => {
      let i = u;
      while (performance.now() < stopAt) {
        const name = deck[i++ % deck.length];
        const s = performance.now();
        try {
          const r = await ops[name]();
          if (r && r.ok === false) { stats[name].errors++; stats[name].sample ??= r.error; }
        } catch (e) { stats[name].errors++; stats[name].sample ??= String(e?.message ?? e); }
        stats[name].t.push(performance.now() - s);
        done++;
      }
    }));
    const perOp = {};
    log(`  ${users} users · ${done.toLocaleString()} operations · ${(done / SOAK_SECONDS).toFixed(1)} per second`);
    for (const [name, s] of Object.entries(stats)) {
      perOp[name] = { count: s.t.length, p50: Math.round(pct(s.t, 0.5)), p95: Math.round(pct(s.t, 0.95)), p99: Math.round(pct(s.t, 0.99)), errors: s.errors, sample: s.sample?.slice(0, 140) ?? null };
      log(`     ${name.padEnd(28)} ${String(s.t.length).padStart(6)}   p50 ${ms(perOp[name].p50).padStart(7)}   p95 ${ms(perOp[name].p95).padStart(7)}   p99 ${ms(perOp[name].p99).padStart(7)}   ${s.errors} error(s)${s.sample ? `  ${s.sample.slice(0, 70)}` : ""}`);
    }
    soak[`${users} users`] = { operations: done, perSecond: Number((done / SOAK_SECONDS).toFixed(1)), perOp };
  }
  results.sections.soak = soak;

  /* ------------------------------------------------------- 4. soundness -- */
  log("\n4 · SOUNDNESS AFTER ALL THAT");
  const agg = await db.journalLine.aggregate({ where: { entry: { companyId: company.id } }, _sum: { debit: true, credit: true } });
  const dr = agg._sum.debit ?? 0, cr = agg._sum.credit ?? 0;
  const [{ n: dupRefs }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM (SELECT "reference" FROM "JournalEntry" WHERE "companyId" = $1 GROUP BY "reference" HAVING COUNT(*) > 1) t`, company.id);
  const [{ n: unbalanced }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM (SELECT l."entryId" FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" WHERE e."companyId" = $1 GROUP BY l."entryId" HAVING ABS(SUM(l."debit") - SUM(l."credit")) > 0.005) t`, company.id);
  const byItem = await db.item.findMany({ where: { companyId: company.id }, include: { movements: { select: { kind: true, quantity: true, value: true, inspection: true } } } });
  const negatives = byItem.filter((i) => balanceOf(i.movements).quantity < -0.0001).map((i) => i.code);
  const [{ n: postedStockWithoutVoucher }] = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "StockMovement" WHERE "companyId" = $1 AND "reference" LIKE $2 AND "entryId" IS NULL AND "kind" IN ('Receipt','Issue')`, company.id, `${code}/SOAK/%`);
  results.sections.soundness = { trialBalance: { debit: dr, credit: cr, balanced: Math.abs(dr - cr) < 0.005 }, duplicateVoucherReferences: dupRefs, unbalancedVouchers: unbalanced, negativeStockItems: negatives, soakMovementsWithoutVoucher: postedStockWithoutVoucher };
  log(`  trial balance            Dr ${dr.toFixed(2)} / Cr ${cr.toFixed(2)}   ${Math.abs(dr - cr) < 0.005 ? "balanced" : "OUT OF BALANCE"}`);
  log(`  duplicate voucher refs   ${dupRefs}`);
  log(`  unbalanced vouchers      ${unbalanced}`);
  log(`  items with negative stock ${negatives.length ? negatives.join(", ") : "none"}`);
  log(`  soak movements with no voucher ${postedStockWithoutVoucher}`);
} catch (e) {
  failure = e;
  console.error("\nThe run stopped: " + String(e?.message ?? e).replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^\s]+@/gi, "$1:****@"));
} finally {
  /* --------------------------------------------------------- 5. cleanup -- */
  log("\n5 · CLEANUP");
  if (company) {
    const id = company.id;
    const t = performance.now();
    // Children that point at each other inside the company go first, so the
    // company delete is not held up by a restrict on the way down.
    const steps = [
      () => db.purchaseOrderLine.deleteMany({ where: { order: { companyId: id } } }).then(() => db.stockMovement.deleteMany({ where: { companyId: id } })),
      () => db.purchaseOrder.deleteMany({ where: { companyId: id } }),
      () => db.materialRequest.deleteMany({ where: { companyId: id } }),
      () => db.journalLine.deleteMany({ where: { entry: { companyId: id } } }),
      () => db.journalEntry.deleteMany({ where: { companyId: id } }),
      () => db.approvalRequest.deleteMany({ where: { companyId: id } }),
      () => db.company.delete({ where: { id } }),
    ];
    for (const step of steps) {
      try { await step(); } catch (e) { console.error("  cleanup step failed: " + String(e?.message ?? e).slice(0, 300)); }
    }
    // Anything the business functions sent to people about this company.
    await db.notification.deleteMany({ where: { OR: [{ title: { contains: code } }, { body: { contains: code } }] } }).catch(() => {});
    log(`  scratch company ${code} removed in ${ms(performance.now() - t)}`);
  }
  const after = await countAll();
  const diffs = Object.keys({ ...before, ...after }).filter((k) => (before[k] ?? 0) !== (after[k] ?? 0)).map((k) => `${k}: ${before[k] ?? 0} → ${after[k] ?? 0}`);
  results.cleanup = { scratchCompany: code, tablesChecked: Object.keys(after).length, rowsBefore: Object.values(before).reduce((a, b) => a + b, 0), rowsAfter: Object.values(after).reduce((a, b) => a + b, 0), differences: diffs };
  if (diffs.length) log(`  TABLES THAT DO NOT MATCH THEIR COUNT BEFORE THE RUN:\n    ${diffs.join("\n    ")}`);
  else log(`  every table matches its count before the run (${Object.keys(after).length} tables, ${results.cleanup.rowsAfter.toLocaleString()} rows)`);
  results.finishedAt = new Date().toISOString();
  results.failed = failure ? String(failure?.message ?? failure) : null;
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
  await db.$disconnect();
  process.exit(failure || diffs.length ? 1 : 0);
}
