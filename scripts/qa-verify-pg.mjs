/**
 * Verify the rehearsal's PostgreSQL database, after the fact.
 *
 * The rehearsal proves the deploy path survives: migrations apply, the seed
 * runs, existing rows are intact. It does not prove that this release's
 * application logic behaves the same on PostgreSQL as it does on the SQLite
 * used for local development — and those are different engines with different
 * numeric and date handling.
 *
 * So this reads back what the seed actually wrote to PostgreSQL and checks it
 * against the same rules the app enforces: every identifier valid, every money
 * value a whole number of fils, every voucher balanced.
 *
 *   node --experimental-strip-types scripts/qa-verify-pg.mjs
 *
 * Reads REHEARSAL_DATABASE_URL from .env and never prints it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cleanIban, cleanLabourCard, cleanRouting } from "../src/lib/uae.ts";

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

const env = loadEnv(".env");
const url = process.env.REHEARSAL_DATABASE_URL || env.REHEARSAL_DATABASE_URL || "";
if (!url) {
  console.error("REHEARSAL_DATABASE_URL is not set — run `npm run db:rehearse` first. See DEPLOY.md.");
  process.exit(1);
}

function findPsql() {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return "psql";
  } catch {
    /* fall through to the usual install location */
  }
  for (const root of ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort().reverse()) {
      const p = `${root}/${v}/bin/psql.exe`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const PSQL = findPsql();
if (!PSQL) {
  console.error("psql was not found. Install the PostgreSQL client tools, or add them to PATH.");
  process.exit(1);
}

// The connection string carries a password; never let it reach the log.
const q = (sql) => {
  try {
    return execFileSync(PSQL, [url, "-t", "-A", "-F", "\t", "-c", sql], { encoding: "utf8" }).trim();
  } catch (err) {
    const host = url.replace(/^.*@/, "").replace(/\?.*$/, "");
    console.error(`Query failed against ${host}. Run \`npm run db:rehearse\` first.`);
    process.exit(1);
  }
};
const rows = (sql) => q(sql).split("\n").filter(Boolean).map((r) => r.split("\t"));

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

console.log(`Verifying the rehearsal database (${q("SELECT version()").split(",")[0]})\n`);

/* ------------------------------------------- UAE identifiers on PostgreSQL */
const emps = rows(`SELECT "empNo", COALESCE("iban",''), COALESCE("labourCardNo",''), COALESCE("bankRoutingCode",'') FROM "Employee" ORDER BY "empNo"`);
ok("the seed created employees", emps.length > 0, `${emps.length} rows`);
const badId = emps.filter(([, iban, card, routing]) =>
  cleanIban(iban).error || cleanLabourCard(card).error || cleanRouting(routing).error);
ok("every seeded employee is WPS-ready on PostgreSQL", badId.length === 0,
  badId.length ? badId.map((e) => e[0]).join(", ") : `${emps.length} checked`);

/* -------------------------------------------------- money stored as fils - */
const overTwoDp = `(ABS(x * 100 - ROUND(x * 100)) > 1e-9)`;
const subFils = rows(`
  SELECT 'JournalLine.debit', COUNT(*) FROM (SELECT "debit" AS x FROM "JournalLine") t WHERE ${overTwoDp}
  UNION ALL SELECT 'JournalLine.credit', COUNT(*) FROM (SELECT "credit" AS x FROM "JournalLine") t WHERE ${overTwoDp}
  UNION ALL SELECT 'JournalEntry.vatAmount', COUNT(*) FROM (SELECT "vatAmount" AS x FROM "JournalEntry") t WHERE ${overTwoDp}
  UNION ALL SELECT 'ChartOfAccount.openingBalance', COUNT(*) FROM (SELECT "openingBalance" AS x FROM "ChartOfAccount") t WHERE ${overTwoDp}
  UNION ALL SELECT 'Employee.basicSalary', COUNT(*) FROM (SELECT "basicSalary" AS x FROM "Employee") t WHERE ${overTwoDp}
  UNION ALL SELECT 'Job.contractValue', COUNT(*) FROM (SELECT "contractValue" AS x FROM "Job") t WHERE ${overTwoDp}
`);
for (const [col, n] of subFils) ok(`${col} holds whole fils`, Number(n) === 0, `${n} value(s) with more than 2dp`);

/* ------------------------------------------------- the books still balance */
const [[dr, cr]] = rows(`SELECT COALESCE(SUM("debit"),0)::text, COALESCE(SUM("credit"),0)::text FROM "JournalLine"`);
ok("the trial balance balances on PostgreSQL", Math.abs(Number(dr) - Number(cr)) < 0.005, `Dr ${dr} / Cr ${cr}`);

const unbalanced = q(`
  SELECT COUNT(*) FROM (
    SELECT "entryId" FROM "JournalLine" GROUP BY "entryId"
    HAVING ABS(SUM("debit") - SUM("credit")) > 0.005
  ) t`);
ok("every voucher balances individually", Number(unbalanced) === 0, `${unbalanced} unbalanced`);

/* ----------------------------------------- the costing dimensions landed - */
const centres = q(`SELECT COUNT(*) FROM "CostCentre"`);
ok("cost centres were seeded", Number(centres) > 0, `${centres} rows`);
const tree = q(`SELECT COUNT(*) FROM "Job" WHERE "parentId" IS NOT NULL`);
ok("the job tree was seeded", Number(tree) > 0, `${tree} sub-job(s)`);
const crossCo = q(`
  SELECT COUNT(*) FROM "JournalLine" l
  JOIN "JournalEntry" e ON e.id = l."entryId"
  JOIN "ChartOfAccount" a ON a.id = l."accountId"
  WHERE a."companyId" <> e."companyId"`);
ok("no line posts into another company's account", Number(crossCo) === 0, `${crossCo} cross-company`);

/* --------------------------------------------- labour reaches the jobs --- */
const sheets = Number(q(`SELECT COUNT(*) FROM "Timesheet"`));
ok("timesheets were seeded", sheets > 0, `${sheets} rows`);

const rateless = Number(q(`SELECT COUNT(*) FROM "Timesheet" WHERE "jobId" IS NOT NULL AND "costRate" <= 0`));
ok("every job-tagged timesheet carries a rate", rateless === 0, `${rateless} without one`);

const crossJob = Number(q(`
  SELECT COUNT(*) FROM "Timesheet" t JOIN "Job" j ON j.id = t."jobId"
  WHERE j."companyId" <> t."companyId"`));
ok("no timesheet points at another company's job", crossJob === 0, `${crossJob} cross-company`);

const orphanCharge = Number(q(`
  SELECT COUNT(*) FROM "Timesheet" t LEFT JOIN "JournalEntry" e ON e.id = t."entryId"
  WHERE t."entryId" IS NOT NULL AND e.id IS NULL`));
ok("every charged timesheet points at a real voucher", orphanCharge === 0, `${orphanCharge} orphaned`);

const labourAccts = Number(q(`SELECT COUNT(*) FROM "ChartOfAccount" WHERE "code" IN ('5100','6900')`));
ok("the labour absorption accounts exist", labourAccts > 0, `${labourAccts} across all companies`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
