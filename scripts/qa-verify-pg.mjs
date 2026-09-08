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

/* ------------------------------------------------ retention holds up ----- */
const rets = Number(q(`SELECT COUNT(*) FROM "Retention"`));
ok("retention was seeded", rets > 0, `${rets} rows`);

const badRetAmount = Number(q(`SELECT COUNT(*) FROM "Retention" WHERE "amount" <= 0`));
ok("every retention entry holds a real amount", badRetAmount === 0, `${badRetAmount} at or below nil`);

const retFils = Number(q(`
  SELECT COUNT(*) FROM (SELECT "amount" AS x FROM "Retention") t
  WHERE ABS(x * 100 - ROUND(x * 100)) > 1e-9`));
ok("retention amounts are whole fils", retFils === 0, `${retFils} with more than 2dp`);

const crossRet = Number(q(`
  SELECT COUNT(*) FROM "Retention" r JOIN "Job" j ON j.id = r."jobId"
  WHERE j."companyId" <> r."companyId"`));
ok("no retention points at another company's job", crossRet === 0, `${crossRet} cross-company`);

const orphanRet = Number(q(`
  SELECT COUNT(*) FROM "Retention" r LEFT JOIN "JournalEntry" e ON e.id = r."entryId"
  WHERE r."entryId" IS NOT NULL AND e.id IS NULL`));
ok("every released retention points at a real voucher", orphanRet === 0, `${orphanRet} orphaned`);

const retAccounts = Number(q(`SELECT COUNT(*) FROM "ChartOfAccount" WHERE "code" IN ('1160','2200')`));
ok("both retention accounts exist", retAccounts > 0, `${retAccounts} across all companies`);

// The register and the ledger must agree, or the screen warns on a fresh
// install and everyone learns to ignore it.
{
  const heldRecv = Number(q(`
    SELECT COALESCE(SUM("amount"),0) FROM "Retention"
    WHERE "direction" = 'Receivable' AND "status" = 'Held'`));
  const ledgerRecv = Number(q(`
    SELECT COALESCE(SUM(l."debit" - l."credit"),0)
    FROM "JournalLine" l JOIN "ChartOfAccount" a ON a.id = l."accountId"
    WHERE a."code" = '1160'`));
  ok("the retention register agrees with the ledger",
    Math.abs(heldRecv - ledgerRecv) < 0.005, `register ${heldRecv} vs ledger ${ledgerRecv}`);
}

/* --------------------------------------- bank reconciliation columns ----- */
const recCols = Number(q(`
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'JournalLine'
    AND column_name IN ('clearedOn','statementRef')`));
ok("a journal line can be ticked against a statement", recCols === 2, `${recCols} of 2 columns`);

const halfTicked = Number(q(`
  SELECT COUNT(*) FROM "JournalLine"
  WHERE "statementRef" IS NOT NULL AND "clearedOn" IS NULL`));
ok("nothing carries a statement reference without being cleared", halfTicked === 0, `${halfTicked} half-ticked`);

/* ------------------------------------------------- corporate tax --------- */
const ctReturns = Number(q(`SELECT COUNT(*) FROM "CorporateTaxReturn"`));
ok("a corporate tax period was seeded", ctReturns > 0, `${ctReturns} row(s)`);

const ctBadPeriod = Number(q(`SELECT COUNT(*) FROM "CorporateTaxReturn" WHERE "periodTo" <= "periodFrom"`));
ok("every tax period ends after it starts", ctBadPeriod === 0, `${ctBadPeriod} inverted`);

// A period longer than a year would be two returns filed as one.
const ctLongPeriod = Number(q(`
  SELECT COUNT(*) FROM "CorporateTaxReturn"
  WHERE "periodTo" > "periodFrom" + INTERVAL '12 months'`));
ok("no tax period runs longer than twelve months", ctLongPeriod === 0, `${ctLongPeriod} too long`);

// Two overlapping periods would tax the same profit twice.
const ctOverlap = Number(q(`
  SELECT COUNT(*) FROM "CorporateTaxReturn" a JOIN "CorporateTaxReturn" b
    ON a."companyId" = b."companyId" AND a.id < b.id
  WHERE a."periodFrom" <= b."periodTo" AND b."periodFrom" <= a."periodTo"`));
ok("no two tax periods overlap for one company", ctOverlap === 0, `${ctOverlap} overlapping`);

const ctOrphanCo = Number(q(`
  SELECT COUNT(*) FROM "CorporateTaxReturn" r
  LEFT JOIN "Company" c ON c.id = r."companyId" WHERE c.id IS NULL`));
ok("every return belongs to a real company", ctOrphanCo === 0, `${ctOrphanCo} orphaned`);

const ctStatus = Number(q(`
  SELECT COUNT(*) FROM "CorporateTaxReturn" WHERE "status" NOT IN ('Draft','Filed')`));
ok("every return carries a status the app understands", ctStatus === 0, `${ctStatus} unknown`);

// A return marked filed with no reference cannot be tied to the filing.
const ctFiledNoRef = Number(q(`
  SELECT COUNT(*) FROM "CorporateTaxReturn"
  WHERE "status" = 'Filed' AND (COALESCE("filedRef",'') = '' OR "filedOn" IS NULL)`));
ok("a filed return carries its EmaraTax reference and date", ctFiledNoRef === 0, `${ctFiledNoRef} without`);

const ctNegLoss = Number(q(`SELECT COUNT(*) FROM "CorporateTaxReturn" WHERE "lossesBroughtForward" < 0`));
ok("no return carries a negative loss brought forward", ctNegLoss === 0, `${ctNegLoss} negative`);

const ctAdjKind = Number(q(`
  SELECT COUNT(*) FROM "CorporateTaxAdjustment"
  WHERE "kind" NOT IN ('Add back','Deduct','Exempt income')`));
ok("every adjustment uses a kind the computation understands", ctAdjKind === 0, `${ctAdjKind} unknown`);

// The sign belongs to the kind, never to the amount — a negative add-back is a
// deduction in disguise and makes the return unreadable.
const ctAdjSign = Number(q(`SELECT COUNT(*) FROM "CorporateTaxAdjustment" WHERE "amount" <= 0`));
ok("every adjustment is a positive amount", ctAdjSign === 0, `${ctAdjSign} at or below nil`);

const ctAdjFils = Number(q(`
  SELECT COUNT(*) FROM (SELECT "amount" AS x FROM "CorporateTaxAdjustment") t
  WHERE ABS(x * 100 - ROUND(x * 100)) > 1e-9`));
ok("adjustment amounts are whole fils", ctAdjFils === 0, `${ctAdjFils} with more than 2dp`);

const ctAdjOrphan = Number(q(`
  SELECT COUNT(*) FROM "CorporateTaxAdjustment" a
  LEFT JOIN "CorporateTaxReturn" r ON r.id = a."returnId" WHERE r.id IS NULL`));
ok("every adjustment belongs to a real return", ctAdjOrphan === 0, `${ctAdjOrphan} orphaned`);

const ctTrn = Number(q(`
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Company' AND column_name = 'corporateTaxTRN'`));
ok("a company can hold a corporate tax registration number", ctTrn === 1, `${ctTrn} of 1 column`);

const ctBadTrn = Number(q(`
  SELECT COUNT(*) FROM "Company"
  WHERE "corporateTaxTRN" IS NOT NULL AND "corporateTaxTRN" !~ '^[0-9]{15}$'`));
ok("any recorded corporate tax TRN is 15 digits", ctBadTrn === 0, `${ctBadTrn} malformed`);

/* ------------------------------------------------ payroll ---------------- */
const payCols = Number(q(`
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Payslip'
    AND column_name IN ('overtime','otHours','otPremiumHours','daysPaid','daysInPeriod',
                        'unpaidDays','otherDeductions','deductionNote','contractBasic')`));
ok("a payslip can show its working", payCols === 9, `${payCols} of 9 columns`);

const attCols = Number(q(`
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Attendance'
    AND column_name IN ('otHours','otPremiumHours')`));
ok("the muster records overtime at both rates", attCols === 2, `${attCols} of 2 columns`);

const lwd = Number(q(`
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Employee' AND column_name = 'lastWorkingDay'`));
ok("a leaver can be given a last working day", lwd === 1, `${lwd} of 1 column`);

// A payslip restated by the seed must never read as nil days: "0/30" on screen
// says nobody was paid for anything, which is how the last four column
// additions announced themselves.
const zeroDays = Number(q(`SELECT COUNT(*) FROM "Payslip" WHERE "daysPaid" <= 0`));
ok("no payslip reads as nil days paid", zeroDays === 0, `${zeroDays} at nil`);

const overPaid = Number(q(`SELECT COUNT(*) FROM "Payslip" WHERE "daysPaid" > "daysInPeriod"`));
ok("no payslip pays more days than the month holds", overPaid === 0, `${overPaid} over`);

const negPay = Number(q(`SELECT COUNT(*) FROM "Payslip" WHERE "netPay" < 0`));
ok("no payslip is negative", negPay === 0, `${negPay} below nil`);

// Every money column on a payslip has to land on whole fils, like every other.
const payFils = rows(`
  SELECT 'Payslip.netPay', COUNT(*) FROM (SELECT "netPay" AS x FROM "Payslip") t WHERE ${overTwoDp}
  UNION ALL SELECT 'Payslip.overtime', COUNT(*) FROM (SELECT "overtime" AS x FROM "Payslip") t WHERE ${overTwoDp}
  UNION ALL SELECT 'Payslip.deductions', COUNT(*) FROM (SELECT "deductions" AS x FROM "Payslip") t WHERE ${overTwoDp}
  UNION ALL SELECT 'Payslip.otherDeductions', COUNT(*) FROM (SELECT "otherDeductions" AS x FROM "Payslip") t WHERE ${overTwoDp}
`);
for (const [col, n] of payFils) ok(`${col} holds whole fils`, Number(n) === 0, `${n} with more than 2dp`);

// A deduction that cannot be explained is the one that becomes a labour claim.
const unexplained = Number(q(`
  SELECT COUNT(*) FROM "Payslip"
  WHERE "otherDeductions" > 0 AND COALESCE("deductionNote",'') = ''`));
ok("every manual deduction carries a reason", unexplained === 0, `${unexplained} unexplained`);

// Overtime money and overtime hours have to agree about whether there was any.
const otMismatch = Number(q(`
  SELECT COUNT(*) FROM "Payslip"
  WHERE ("overtime" > 0) <> (("otHours" + "otPremiumHours") > 0)`));
ok("overtime pay and overtime hours agree", otMismatch === 0, `${otMismatch} disagreeing`);

const negOt = Number(q(`SELECT COUNT(*) FROM "Attendance" WHERE "otHours" < 0 OR "otPremiumHours" < 0`));
ok("no attendance row carries negative overtime", negOt === 0, `${negOt} negative`);

// More than sixteen hours of overtime in one day is a keying error, not a shift.
const wildOt = Number(q(`SELECT COUNT(*) FROM "Attendance" WHERE "otHours" + "otPremiumHours" > 16`));
ok("no day carries an impossible amount of overtime", wildOt === 0, `${wildOt} over 16h`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
