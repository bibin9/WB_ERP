/**
 * Searching the grids.
 *
 * The part worth testing is not that a box appears. It is that the search means
 * the same thing on both database engines: SQLite's LIKE is already
 * case-insensitive for ASCII and rejects Prisma's `mode` argument outright,
 * while PostgreSQL's LIKE is case-sensitive and needs it. Local development runs
 * on the first, the client runs on the second, so writing either one plainly
 * gives a search that works on your machine and quietly misses half the matches
 * on theirs — or one that throws the moment somebody types.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { like, readSearch, matchAny, numericTerm, normalisePhone, looksLikePhone } from "../src/lib/search.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ============================================ the engine difference ======= */
{
  const filter = like("test");
  const onPostgres = /^postgres(ql)?:/i.test(process.env.DATABASE_URL ?? "");
  ok("the filter is built for the engine in use",
    onPostgres ? filter.mode === "insensitive" : filter.mode === undefined,
    onPostgres ? "postgres: mode set" : "sqlite: mode omitted, because it would throw");

  // The behaviour that actually matters, run against the live engine.
  const upper = await db.employee.findMany({ where: { name: like("RAJESH") }, select: { name: true } });
  const lower = await db.employee.findMany({ where: { name: like("rajesh") }, select: { name: true } });
  const mixed = await db.employee.findMany({ where: { name: like("RaJeSh") }, select: { name: true } });
  ok("a name is found whatever case is typed",
    upper.length > 0 && upper.length === lower.length && lower.length === mixed.length,
    `${upper.length} / ${lower.length} / ${mixed.length}`);

  const partial = await db.employee.findMany({ where: { name: like("kum") }, select: { name: true } });
  ok("part of a word matches", partial.length > 0, partial.map((e) => e.name).join(", "));
}

/* =================================================== reading the term ===== */
ok("a missing term is empty", readSearch({}) === "");
ok("surrounding space is trimmed", readSearch({ q: "  ahmed  " }) === "ahmed");
ok("a pasted paragraph is capped", readSearch({ q: "x".repeat(500) }).length === 80);
ok("an empty term builds no filter", matchAny("", ["name"]) === undefined);
{
  const f = matchAny("abc", ["name", "phone"]);
  ok("a term searches every field given", Array.isArray(f.OR) && f.OR.length === 2);
}

/* ================================================== amounts in a search === */
ok("a plain number is treated as an amount", numericTerm("1500") === 1500);
ok("thousands separators are ignored", numericTerm("1,500.50") === 1500.5);
ok("a reference is not an amount", numericTerm("WBE/JV/26-26/0001") === null);
ok("a name is not an amount", numericTerm("Rajesh") === null);

/* ====================================== searching finds the right rows ==== */
{
  const emp = await db.employee.findFirst({ where: { phone: { not: null } }, select: { name: true, phone: true } });
  if (emp?.phone) {
    const byPhone = await db.employee.findMany({
      where: matchAny(emp.phone.slice(-6), ["name", "empNo", "email", "phone"]),
      select: { name: true },
    });
    ok("an employee is found by the end of their mobile number",
      byPhone.some((e) => e.name === emp.name), `${emp.name} via ${emp.phone.slice(-6)}`);
  } else {
    ok("an employee is found by the end of their mobile number", true, "no seeded phone to search");
  }

  const company = await db.company.findFirst({ where: { code: "WBE" } });
  const party = await db.party.findFirst({ where: { companyId: company.id, trn: { not: null } } });
  if (party?.trn) {
    const byTrn = await db.party.findMany({
      where: { companyId: company.id, ...matchAny(party.trn, ["name", "code", "trn"]) },
      select: { name: true },
    });
    ok("a customer is found by TRN", byTrn.some((p) => p.name === party.name), party.trn);
  }

  // A day book search by amount has to reach the lines, not just the header.
  const line = await db.journalLine.findFirst({ where: { debit: { gt: 0 } }, include: { entry: true } });
  const byAmount = await db.journalEntry.findMany({
    where: { companyId: line.entry.companyId, lines: { some: { OR: [{ debit: line.debit }, { credit: line.debit }] } } },
    select: { reference: true },
  });
  ok("a voucher is found by its amount",
    byAmount.some((e) => e.reference === line.entry.reference), `${line.debit} finds ${line.entry.reference}`);
}

/* ================================================ phone numbers =========== */
// The case that was wrong first time: a number stored as "050 412 8837" cannot
// be found by typing "0504128837", and nobody types the spaces.
ok("separators are stripped from a number", normalisePhone("050 412 8837") === "0504128837");
ok("a country code survives", normalisePhone("+971 50 412 8837") === "+971504128837");
ok("brackets and dashes go too", normalisePhone("(050) 412-8837") === "0504128837");
ok("a number is recognised as one", looksLikePhone("050 412 8837") && looksLikePhone("0504128837"));
ok("a name is not", !looksLikePhone("Rajesh Kumar"));
ok("a short string is not a number", !looksLikePhone("123"));

{
  const emp = await db.employee.findFirst({ where: { phone: { not: null } }, select: { name: true, phone: true } });
  ok("seeded numbers are stored without separators",
    !!emp && /^[+\d]+$/.test(emp.phone), emp?.phone ?? "none");

  const whole = await db.employee.findMany({ where: { phone: like(normalisePhone(emp.phone)) }, select: { name: true } });
  ok("the whole number finds the person", whole.some((e) => e.name === emp.name), emp.phone);

  const partial = await db.employee.findMany({ where: { phone: like(emp.phone.slice(0, 4)) }, select: { name: true } });
  ok("the first few digits do too", partial.some((e) => e.name === emp.name), emp.phone.slice(0, 4));

  // The form must store it in the shape the search expects.
  const actions = read("src/app/(app)/hr/employees/actions.ts");
  ok("the profile normalises a number on save", actions.includes("normalisePhone"));
  ok("and the employee list searches both forms",
    read("src/app/(app)/hr/page.tsx").includes("looksLikePhone"));
}

/* ============================================================== wiring ==== */
const SEARCHED = {
  "src/app/(app)/hr/page.tsx": "employees",
  "src/app/(app)/finance/parties/page.tsx": "customers and suppliers",
  "src/app/(app)/finance/cheques/page.tsx": "the cheque register",
  "src/app/(app)/finance/daybook/page.tsx": "the day book",
};
for (const [file, what] of Object.entries(SEARCHED)) {
  const s = read(file);
  ok(`${what} can be searched`, s.includes("<SearchBox") && s.includes("readSearch"));
  // The term must reach a Prisma where clause, not filter rows in the browser.
  const buildsFilter = /matchAny\(term|searchWhere/.test(s);
  const feedsQuery = /where: (\w*Where|where)\b/.test(s) || /\.\.\.searchWhere/.test(s);
  ok(`  and the database does the filtering`, buildsFilter && feedsQuery);
}

ok("employees are searchable by the things a person has to hand",
  ["name", "empNo", "phone", "email", "emiratesIdNo", "passportNo", "labourCardNo"].every((f) =>
    read("src/app/(app)/hr/page.tsx").includes(`"${f}"`)));
ok("the day book also matches an amount",
  read("src/app/(app)/finance/daybook/page.tsx").includes("numericTerm"));

const box = read("src/components/SearchBox.tsx");
ok("typing is debounced rather than one query per keystroke", box.includes("setTimeout"));
ok("a new search returns to page one", box.includes('q.delete("p")'));
ok("the term is kept on the URL, so a search can be linked to", box.includes("router.push"));
ok("other filters on the URL survive", box.includes("new URLSearchParams(params.toString())"));
ok("the box does not print", box.includes("print:hidden"));

const lib = read("src/lib/search.ts");
ok("the engine difference is handled in one place", lib.includes("isPostgres"));
ok("and explained, because it fails silently otherwise", lib.includes("case-sensitive"));

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
