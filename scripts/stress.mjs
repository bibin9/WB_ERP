/**
 * Stress test, against PostgreSQL.
 *
 *   node --experimental-strip-types scripts/stress.mjs [vouchers]
 *
 * Runs against REHEARSAL_DATABASE_URL — the same throwaway PostgreSQL the
 * deploy rehearsal uses — and never against production. Two reasons it is not
 * the local SQLite: production is PostgreSQL, and SQLite serialises writers, so
 * a write-contention test there measures the wrong engine and would report a
 * clean result that means nothing.
 *
 * Three questions:
 *
 *   1. Does anything degrade non-linearly as the ledger grows?
 *   2. What happens when several people post at the same moment?
 *   3. Does sustained concurrent reading stay stable, or fall over?
 *
 * It refuses to run anywhere that looks live, and it cleans up after itself.
 */
import { readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

/* ----------------------------------------------- pick the target, safely - */
function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const fileEnv = loadEnv(".env");
const target = process.env.REHEARSAL_DATABASE_URL || fileEnv.REHEARSAL_DATABASE_URL || "";
const prod = process.env.PROD_DATABASE_URL || fileEnv.PROD_DATABASE_URL || "";

const redact = (u) => u.replace(/\/\/[^@]*@/, "//***@");
if (!target) {
  console.error("REHEARSAL_DATABASE_URL is not set. See DEPLOY.md — this needs a throwaway database.");
  process.exit(1);
}
if (prod && target === prod) {
  console.error("REHEARSAL_DATABASE_URL and PROD_DATABASE_URL are the same. Refusing to stress production.");
  process.exit(1);
}
if (/railway|rlwy\.net/i.test(target) && !/rehears|stage|test|scratch/i.test(target)) {
  console.error(`That looks like a live Railway database (${redact(target)}). Refusing.`);
  process.exit(1);
}
process.env.DATABASE_URL = target;

const { PrismaClient } = await import("@prisma/client");
const { importLibs } = await import("./lib-shim.mjs");
const { postVoucher } = (await importLibs(["db", "money", "period", "vat", "posting"])).posting;

const db = new PrismaClient();
const VOUCHERS = Number(process.argv[2]) || 50_000;
const ms = (n) => `${n.toFixed(0)} ms`;
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`\nTarget: ${redact(target)}`);
console.log(`Building a company with ${VOUCHERS.toLocaleString()} vouchers…\n`);

let company;
try {
  /* --------------------------------------------------------- build volume - */
  const t0 = performance.now();
  const tenant =
    (await db.tenant.findFirst()) ??
    (await db.tenant.create({ data: { key: "stress", name: "Stress Tenant" } }));
  company = await db.company.create({
    data: { tenantId: tenant.id, code: `STR${Date.now() % 100000}`, name: "Stress Contracting", fyStartMonth: 1 },
  });

  const accounts = [];
  for (const [code, name, type] of [
    ["1000", "Cash at Bank", "Asset"], ["1100", "Accounts Receivable", "Asset"],
    ["2000", "Accounts Payable", "Liability"], ["2150", "VAT Output", "Liability"],
    ["1150", "VAT Input", "Asset"], ["4000", "Contract Revenue", "Income"],
    ["5000", "Cost of Sales", "Expense"], ["6000", "Salaries", "Expense"],
  ]) accounts.push(await db.chartOfAccount.create({ data: { companyId: company.id, code, name, type } }));
  const acc = (c) => accounts.find((a) => a.code === c);

  const start = Date.UTC(2023, 0, 1);
  const span = Date.UTC(2026, 0, 1) - start;
  const BATCH = 2500;
  for (let i = 0; i < VOUCHERS; i += BATCH) {
    const chunk = Math.min(BATCH, VOUCHERS - i);
    const entries = Array.from({ length: chunk }, (_, k) => {
      const n = i + k;
      return {
        companyId: company.id,
        date: new Date(start + Math.floor((n / VOUCHERS) * span)),
        voucherType: n % 2 ? "Sales" : "Purchase",
        reference: `${company.code}/SV/${String(n).padStart(7, "0")}`,
        memo: "stress",
        postedBy: "stress",
        vatAmount: 50,
      };
    });
    await db.journalEntry.createMany({ data: entries });
    const made = await db.journalEntry.findMany({
      where: { companyId: company.id, reference: { in: entries.map((e) => e.reference) } },
      select: { id: true, voucherType: true },
    });
    const lines = [];
    for (const e of made) {
      const sale = e.voucherType === "Sales";
      // Both shapes have to balance, or section 4 measures the harness rather
      // than the application:
      //   sale      Dr receivable 1050 / Cr revenue 1000 + Cr VAT out 50
      //   purchase  Dr cost 1000 + Dr VAT in 50 / Cr payable 1050
      if (sale) {
        lines.push({ entryId: e.id, accountId: acc("1100").id, debit: 1050, credit: 0 });
        lines.push({ entryId: e.id, accountId: acc("4000").id, debit: 0, credit: 1000 });
        lines.push({ entryId: e.id, accountId: acc("2150").id, debit: 0, credit: 50 });
      } else {
        lines.push({ entryId: e.id, accountId: acc("5000").id, debit: 1000, credit: 0 });
        lines.push({ entryId: e.id, accountId: acc("1150").id, debit: 50, credit: 0 });
        lines.push({ entryId: e.id, accountId: acc("2000").id, debit: 0, credit: 1050 });
      }
    }
    await db.journalLine.createMany({ data: lines });
    if ((i / BATCH) % 4 === 0) process.stdout.write(`  ${Math.round((i / VOUCHERS) * 100)}%\r`);
  }
  const lineCount = await db.journalLine.count({ where: { entry: { companyId: company.id } } });
  console.log(`  built ${lineCount.toLocaleString()} lines in ${ms(performance.now() - t0)}          \n`);

  /* ------------------------------------------------------- 1. read at scale */
  console.log("1 · READS AT VOLUME");
  const { accountBalances, profitAndLoss } = (await importLibs(["db", "ledger", "ledger-query"]))["ledger-query"];
  const from = new Date(Date.UTC(2025, 0, 1));
  const to = new Date(Date.UTC(2025, 11, 31));

  const timeIt = async (label, fn, runs = 5) => {
    await fn();
    const t = [];
    for (let i = 0; i < runs; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s); }
    console.log(`  ${label.padEnd(44)} p50 ${ms(pct(t, 0.5)).padStart(8)}   p95 ${ms(pct(t, 0.95)).padStart(8)}`);
    return pct(t, 0.5);
  };

  await timeIt("trial balance (one year)", () => accountBalances(company.id, from, to, null));
  await timeIt("trial balance (all time)", () =>
    accountBalances(company.id, new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2100, 0, 1)), null));
  await timeIt("profit and loss", () => profitAndLoss(company.id, from, to, null));
  await timeIt("day book, first page", () =>
    db.journalEntry.findMany({ where: { companyId: company.id }, orderBy: { date: "desc" }, take: 50, include: { lines: true } }));
  await timeIt("day book, deep page (offset 40,000)", () =>
    db.journalEntry.findMany({ where: { companyId: company.id }, orderBy: { date: "desc" }, skip: 40_000, take: 50, include: { lines: true } }));
  await timeIt("VAT lines for a quarter", () =>
    db.journalLine.findMany({
      where: { entry: { companyId: company.id, date: { gte: from, lte: new Date(Date.UTC(2025, 2, 31)) } } },
      include: { entry: { select: { voucherType: true, vatAmount: true } } },
    }), 3);

  /* ------------------------------------------- 2. everybody posts at once - */
  console.log("\n2 · CONCURRENT POSTING  (the reference number is counted, then used)");
  for (const workers of [2, 5, 10, 20]) {
    const before = await db.journalEntry.count({ where: { companyId: company.id, voucherType: "Journal" } });
    const t = performance.now();
    const results = await Promise.all(
      Array.from({ length: workers }, (_, k) =>
        postVoucher({
          companyId: company.id,
          postedBy: `worker-${k}`,
          voucherType: "Journal",
          date: "2025-06-15",
          memo: `concurrent ${k}`,
          lines: [
            { accountId: acc("1000").id, debit: 100, credit: 0 },
            { accountId: acc("4000").id, debit: 0, credit: 100 },
          ],
        }).catch((e) => ({ ok: false, error: e.message || String(e), threw: true }))
      )
    );
    const dt = performance.now() - t;
    const okCount = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    const refs = results.filter((r) => r.ok).map((r) => r.reference);
    const dupes = refs.length - new Set(refs).size;
    const after = await db.journalEntry.count({ where: { companyId: company.id, voucherType: "Journal" } });

    // A sequence with holes in it is an audit finding, so the numbers actually
    // allocated are checked for gaps as well as for duplicates.
    const nums = (await db.journalEntry.findMany({
      where: { companyId: company.id, voucherType: "Journal" },
      select: { reference: true },
    })).map((e) => Number(e.reference.split("/").pop())).sort((a, b) => a - b);
    const gaps = nums.filter((v, i) => i > 0 && v !== nums[i - 1] + 1).length;

    console.log(
      `  ${String(workers).padStart(2)} at once  ${ms(dt).padStart(8)}   ` +
      `${okCount}/${workers} posted   ${dupes} duplicate   ${gaps} gap(s)   ` +
      `${after - before} rows written`
    );
    if (failed.length) {
      const sample = failed[0].error ?? "(no message)";
      console.log(`      ${failed.length} refused: ${String(sample).slice(0, 110)}`);
    }
  }

  /* ------------------------------------------------ 3. sustained reading -- */
  console.log("\n3 · SUSTAINED CONCURRENT READS");
  for (const workers of [5, 20, 50]) {
    const t = performance.now();
    const times = [];
    const errors = [];
    await Promise.all(
      Array.from({ length: workers }, async () => {
        const s = performance.now();
        try { await accountBalances(company.id, from, to, null); }
        catch (e) { errors.push(e.message || String(e)); }
        times.push(performance.now() - s);
      })
    );
    console.log(
      `  ${String(workers).padStart(2)} readers  wall ${ms(performance.now() - t).padStart(8)}   ` +
      `p50 ${ms(pct(times, 0.5)).padStart(8)}   p95 ${ms(pct(times, 0.95)).padStart(8)}   ` +
      `${errors.length} error(s)`
    );
    if (errors.length) console.log(`      ${String(errors[0]).slice(0, 110)}`);
  }

  /* ------------------------------------------------ 4. still consistent? -- */
  console.log("\n4 · IS THE LEDGER STILL SOUND AFTER ALL THAT");
  const agg = await db.journalLine.aggregate({
    where: { entry: { companyId: company.id } }, _sum: { debit: true, credit: true },
  });
  const dr = agg._sum.debit ?? 0, cr = agg._sum.credit ?? 0;
  console.log(`  trial balance      Dr ${dr.toFixed(2)} / Cr ${cr.toFixed(2)}   ${Math.abs(dr - cr) < 0.005 ? "balanced" : "OUT OF BALANCE"}`);

  const dupeRefs = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT "reference" FROM "JournalEntry" WHERE "companyId" = $1
       GROUP BY "reference" HAVING COUNT(*) > 1) t`,
    company.id
  );
  console.log(`  duplicate references  ${dupeRefs[0].n}`);

  const unbalanced = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT l."entryId" FROM "JournalLine" l
       JOIN "JournalEntry" e ON e.id = l."entryId"
       WHERE e."companyId" = $1
       GROUP BY l."entryId" HAVING ABS(SUM(l."debit") - SUM(l."credit")) > 0.005) t`,
    company.id
  );
  console.log(`  unbalanced vouchers   ${unbalanced[0].n}`);
  console.log(`  heap in use           ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB\n`);
} finally {
  if (company) {
    await db.journalLine.deleteMany({ where: { entry: { companyId: company.id } } });
    await db.journalEntry.deleteMany({ where: { companyId: company.id } });
    await db.chartOfAccount.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    console.log("(stress company removed)");
  }
  await db.$disconnect();
}
