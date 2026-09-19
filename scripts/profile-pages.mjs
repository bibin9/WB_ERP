/**
 * What every screen asks of the database, with years of data behind it.
 *
 * The stress test timed a handful of library calls. This looks at the screens
 * themselves: it signs in as the group administrator, opens every screen in
 * the menu one after another, and reads back the queries each one ran (from
 * the file the server writes when QUERY_LOG_FILE is set — see src/lib/db.ts).
 * A screen that runs forty queries where four would do, or one query that
 * takes most of the screen's time, shows up at the top of the report.
 *
 * Two steps, with the server started by hand in between, because the server
 * must be pointed at the same database with the log switched on:
 *
 *   node --experimental-strip-types scripts/profile-pages.mjs --load
 *       Wipes the rehearsal PostgreSQL, seeds it, and loads three years of
 *       vouchers, stock movements, invoices, attendance and audit history into
 *       WBE. Rehearsal only — the same guards as npm run test:pg.
 *
 *   (start the app on the rehearsal database with QUERY_LOG_FILE set)
 *
 *   node --experimental-strip-types scripts/profile-pages.mjs --crawl --log=<file> [--base=http://localhost:3055]
 *       Opens every screen twice (the first warms the server) and reports the
 *       second: queries, database time, and the slowest query on each.
 */
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

function loadEnvFile(file) {
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
const fileEnv = loadEnvFile(".env");
for (const [k, v] of Object.entries(fileEnv)) if (!process.env[k] && k !== "DATABASE_URL") process.env[k] = v;
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const redact = (s) => String(s).replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/gi, "$1***@");

/* ------------------------------------------------------------------ load -- */
if (process.argv.includes("--load")) {
  const url = process.env.REHEARSAL_DATABASE_URL || "";
  const prodUrl = process.env.PROD_DATABASE_URL || "";
  const host = (u) => u.replace(/^.*@/, "").replace(/\?.*$/, "");
  if (!/^postgres(ql)?:\/\//i.test(url)) { console.error("REHEARSAL_DATABASE_URL must be a PostgreSQL database."); process.exit(1); }
  if (prodUrl && host(url) === host(prodUrl)) { console.error("That is the production database — refusing."); process.exit(1); }
  if (/rlwy\.net|railway\.internal/i.test(url)) { console.error("That is a Railway database. This wipes what it is given; it runs on a local rehearsal database only."); process.exit(1); }

  const env = { ...process.env, DATABASE_URL: url, PRISMA_PROVIDER: "postgresql" };
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env });
  console.log(`Loading ${redact(url)}`);
  run("node", ["scripts/set-db-provider.mjs"]);
  run("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate", "--accept-data-loss"]);
  run("npx", ["prisma", "generate"]);
  run("node", ["prisma/seed.mjs"]);
  process.env.DATABASE_URL = url;
  process.env.PRISMA_PROVIDER = "postgresql";

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url } } });
  const company = await db.company.findFirst({ where: { code: "WBE" } });
  const cid = company.id;
  const t0 = Date.now();
  const pick = (arr, n) => arr[n % arr.length];
  const start = Date.UTC(2023, 8, 1), span = Date.UTC(2026, 8, 1) - start;
  const when = (n, total) => new Date(start + Math.floor((n / total) * span));
  const chunks = async (total, size, make) => { for (let i = 0; i < total; i += size) await make(i, Math.min(size, total - i)); };

  // Masters, at the size a contractor of this kind carries.
  await db.party.createMany({ data: Array.from({ length: 400 }, (_, i) => ({ companyId: cid, code: `PF-P${i}`, name: `Profile party ${i}`, type: i % 3 === 0 ? "Supplier" : i % 3 === 1 ? "Customer" : "Both", creditDays: 30, trn: i % 2 ? `1000000000${String(i).padStart(5, "0")}` : null })) });
  await db.item.createMany({ data: Array.from({ length: 1500 }, (_, i) => ({ companyId: cid, code: `PF-I${String(i).padStart(4, "0")}`, name: `Profile item ${i}`, unitCode: "EA", standardCost: 5 + (i % 50), category: `Cat ${i % 12}` })) });
  await db.job.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ companyId: cid, code: `PF-J${i}`, name: `Profile job ${i}` })) });
  await db.store.createMany({ data: Array.from({ length: 4 }, (_, i) => ({ companyId: cid, code: `PF-S${i}`, name: `Profile store ${i}` })) });
  const parties = await db.party.findMany({ where: { companyId: cid } });
  const customers = parties.filter((p) => p.type !== "Supplier");
  const items = await db.item.findMany({ where: { companyId: cid } });
  const jobs = await db.job.findMany({ where: { companyId: cid } });
  const stores = await db.store.findMany({ where: { companyId: cid } });
  const accounts = await db.chartOfAccount.findMany({ where: { companyId: cid } });
  const byType = (t) => accounts.filter((a) => a.type === t);
  const [assets, income, expense, liability] = ["Asset", "Income", "Expense", "Liability"].map(byType);

  // 30,000 vouchers, three lines each, across accounts, parties and jobs.
  const VOUCHERS = 30_000, TYPES = ["Journal", "Payment", "Receipt", "Sales", "Purchase", "Contra"];
  await chunks(VOUCHERS, 2000, async (i, n) => {
    const entries = Array.from({ length: n }, (_, k) => {
      const j = i + k;
      return { companyId: cid, date: when(j, VOUCHERS), voucherType: pick(TYPES, j), reference: `PF/V/${String(j).padStart(6, "0")}`, memo: `profile ${j}`, postedBy: "profile", partyId: j % 2 ? pick(parties, j).id : null, partyName: null };
    });
    await db.journalEntry.createMany({ data: entries });
    const made = await db.journalEntry.findMany({ where: { companyId: cid, reference: { in: entries.map((e) => e.reference) } }, select: { id: true, reference: true } });
    await db.journalLine.createMany({
      data: made.flatMap((e, k) => {
        const j = i + k, amt = 100 + (j % 900);
        return [
          { entryId: e.id, accountId: pick(assets, j).id, debit: amt, credit: 0 },
          { entryId: e.id, accountId: pick(j % 2 ? income : liability, j).id, debit: 0, credit: amt * 0.6, jobId: pick(jobs, j).id },
          { entryId: e.id, accountId: pick(j % 3 ? income : expense, j + 1).id, debit: 0, credit: amt * 0.4 },
        ];
      }),
    });
  });
  console.log(`  ${VOUCHERS.toLocaleString()} vouchers`);

  // 40,000 stock movements: receive, receive, issue, per item and store.
  const MOVES = 40_000;
  await chunks(MOVES, 4000, (i, n) => db.stockMovement.createMany({
    data: Array.from({ length: n }, (_, k) => {
      const j = i + k, inward = Math.floor(j / items.length) % 3 !== 2;
      return { companyId: cid, itemId: pick(items, j).id, storeId: pick(stores, Math.floor(j / items.length)).id, kind: inward ? "Receipt" : "Issue", date: when(j, MOVES), quantity: inward ? 10 : 5, unitCost: 10, value: inward ? 100 : 50, jobId: inward ? null : pick(jobs, j).id, partyId: inward ? pick(parties, j).id : null, reference: `PF/MV/${j}`, createdBy: "profile" };
    }),
  }));
  console.log(`  ${MOVES.toLocaleString()} stock movements`);

  // 4,000 invoices with three lines each, sales and purchase.
  const INVOICES = 4000, STATUSES = ["Issued", "Issued", "Issued", "Draft", "Paid"];
  await chunks(INVOICES, 1000, async (i, n) => {
    const data = Array.from({ length: n }, (_, k) => {
      const j = i + k, p = pick(customers, j);
      return { companyId: cid, side: j % 4 === 3 ? "Purchase" : "Sales", number: `PF-INV-${j}`, status: pick(STATUSES, j), issueDate: when(j, INVOICES), dueDate: new Date(when(j, INVOICES).getTime() + 30 * 864e5), partyId: p.id, partyName: p.name, netTotal: 1000, vatTotal: 50, grossTotal: 1050, jobId: pick(jobs, j).id, createdBy: "profile" };
    });
    await db.invoice.createMany({ data });
    const made = await db.invoice.findMany({ where: { companyId: cid, number: { in: data.map((d) => d.number) } }, select: { id: true } });
    await db.invoiceLine.createMany({ data: made.flatMap((inv, k) => [0, 1, 2].map((o) => ({ invoiceId: inv.id, description: `Line ${o}`, quantity: 1, unitPrice: 333.33, netAmount: 333.33, vatAmount: 16.67, accountId: pick(income, k + o).id, order: o }))) });
  });
  console.log(`  ${INVOICES.toLocaleString()} invoices`);

  // 300 employees with a year of attendance.
  await db.employee.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ companyId: cid, empNo: `PF-E${i}`, name: `Profile employee ${i}`, department: `Dept ${i % 8}`, designation: "Technician", joinDate: new Date(Date.UTC(2022, i % 12, 1)), emiratesIdExpiry: new Date(Date.UTC(2026, i % 12, 15)), passportExpiry: new Date(Date.UTC(2027, i % 12, 15)), visaExpiry: new Date(Date.UTC(2026, (i + 3) % 12, 15)) })) });
  const employees = await db.employee.findMany({ where: { companyId: cid }, select: { id: true } });
  const days = 365;
  await chunks(employees.length, 20, (i, n) => db.attendance.createMany({
    data: employees.slice(i, i + n).flatMap((e) => Array.from({ length: days }, (_, d) => {
      const date = new Date(Date.UTC(2025, 8, 1) + d * 864e5);
      return { companyId: cid, employeeId: e.id, date, firstIn: new Date(date.getTime() + 7 * 36e5), lastOut: new Date(date.getTime() + 17 * 36e5) };
    })),
  }));
  console.log(`  ${employees.length} employees, ${(employees.length * days).toLocaleString()} attendance days`);

  // 60,000 audit entries.
  const admin = await db.user.findFirst({ where: { email: "admin@wandb.ae" } });
  await chunks(60_000, 10_000, (i, n) => db.auditLog.createMany({
    data: Array.from({ length: n }, (_, k) => ({ tenantId: company.tenantId, userId: admin.id, userName: admin.name, action: pick(["Created", "Updated", "Posted", "Signed in"], i + k), entity: pick(["JournalEntry", "Invoice", "Employee", "Session"], i + k), entityId: null, summary: `profile ${i + k}`, createdAt: when(i + k, 60_000) })),
  }));
  console.log("  60,000 audit entries");

  await db.$executeRawUnsafe("ANALYZE");
  console.log(`Loaded in ${Math.round((Date.now() - t0) / 1000)} s. Company ${company.code} id ${cid}`);
  await db.$disconnect();
  process.exit(0);
}

/* ----------------------------------------------------------------- crawl -- */
if (process.argv.includes("--crawl")) {
  const logFile = arg("log");
  const base = arg("base") || "http://localhost:3055";
  if (!logFile || !existsSync(logFile)) { console.error("--log=<file> must name the server's QUERY_LOG_FILE."); process.exit(1); }
  const { signSession, SESSION_COOKIE } = await import("../src/lib/session-token.ts");
  const { SCREENS } = await import("../src/lib/rbac.ts");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: process.env.REHEARSAL_DATABASE_URL } } });
  const admin = await db.user.findFirst({ where: { email: "admin@wandb.ae" } });
  const wbe = await db.company.findFirst({ where: { code: "WBE" } });
  const token = await signSession({ uid: admin.id, tid: admin.tenantId, name: admin.name, email: admin.email });
  const cookie = `${SESSION_COOKIE}=${token}`;
  await db.$disconnect();

  const EXTRA = ["/dashboard", "/notifications", "/companies", "/audit", "/settings", "/reports", "/approvals"];
  const only = arg("only");
  const paths = [...new Set([...SCREENS.map((s) => s.href), ...EXTRA])].filter((p) => !only || p.includes(only)).sort();
  const readFrom = (offset) => {
    const buf = readFileSync(logFile);
    return { next: buf.length, lines: buf.subarray(offset).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  for (const p of paths) {
    const url = `${base}${p}${p.includes("?") ? "&" : "?"}c=${wbe.id}`;
    await fetch(url, { headers: { cookie }, redirect: "manual" }).then((r) => r.text()).catch(() => "");
    await sleep(300);
    let offset = statSync(logFile).size;
    const t = Date.now();
    const res = await fetch(url, { headers: { cookie }, redirect: "manual" }).catch((e) => ({ status: 0, text: async () => String(e) }));
    const bytes = (await res.text()).length;
    const wall = Date.now() - t;
    await sleep(300);
    const { lines } = readFrom(offset);
    const dbMs = lines.reduce((a, q) => a + q.ms, 0);
    const slowest = lines.slice().sort((a, b) => b.ms - a.ms)[0];
    // Same statement shape run many times on one screen is the N+1 signature.
    const shapes = new Map();
    for (const q of lines) shapes.set(q.query, (shapes.get(q.query) ?? 0) + 1);
    const repeated = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0];
    rows.push({ path: p, status: res.status, wall, kb: Math.round(bytes / 1024), queries: lines.length, dbMs, slowestMs: slowest?.ms ?? 0, slowest: slowest?.query.slice(0, 400) ?? "", repeatedTimes: repeated?.[1] ?? 0, repeated: repeated?.[0].slice(0, 300) ?? "" });
    console.log(`${p.padEnd(38)} ${String(res.status).padStart(3)}  ${String(wall).padStart(6)} ms  ${String(Math.round(bytes / 1024)).padStart(5)} KB  ${String(lines.length).padStart(4)} q  db ${String(dbMs).padStart(6)} ms  slowest ${String(slowest?.ms ?? 0).padStart(5)} ms  most repeated ×${repeated?.[1] ?? 0}`);
  }
  const out = arg("out") || `perf-results/profile-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base, rows }, null, 2));
  console.log(`\nWritten to ${out}`);
  process.exit(0);
}

console.log("Use --load or --crawl. See the comment at the top of this file.");
