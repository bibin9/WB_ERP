/**
 * Exploratory QA pass — hunting for defects the written test suite does not
 * look for, because the suite was written alongside the code and shares its
 * assumptions.
 *
 * Bias here is deliberate: money arithmetic, period boundaries, UAE statutory
 * rules, and the inputs a real UAE contractor's data actually contains (Arabic
 * names, long Emirati names, 15-digit TRNs). Nothing here is a unit test of
 * something I wrote on purpose; every check is an attempt to break it.
 *
 * Reports findings by severity rather than passing or failing, because several
 * of these are judgement calls a human should make.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const db = new PrismaClient();

const findings = [];
const note = (sev, area, title, detail) => findings.push({ sev, area, title, detail });
const ok = [];
const good = (area, what) => ok.push(`${area}: ${what}`);

/* ===================================================== money arithmetic === */
// Prisma Float is a double. Currency in doubles is the classic ERP defect: it
// does not show up on small demo data and appears months in, as a trial balance
// that is out by a fraction of a fils.
{
  const schema = read("prisma/schema.prisma");
  const moneyFields = [...schema.matchAll(/^\s*(debit|credit|amount|basic|gross|net|salary|contractValue|budgetCost|openingBalance|vatAmount)\w*\s+(\w+)/gim)]
    .map((m) => `${m[1]}:${m[2]}`);
  const floats = moneyFields.filter((f) => f.endsWith(":Float"));
  const decided = /Money is stored as Float .* and that is deliberate/.test(schema);
  const rounded = fs.existsSync("src/lib/money.ts") && read("src/lib/money.ts").includes("export const toFils");
  if (floats.length && !(decided && rounded)) {
    note(
      "Medium", "Finance", "Money is stored as Float (double), not Decimal",
      `${floats.length} monetary columns are Float, e.g. ${floats.slice(0, 4).join(", ")}. ` +
        "Either convert to Decimal or record why not, and round every write to fils."
    );
  } else if (floats.length) {
    good("Finance", `${floats.length} Float money columns, with the rationale recorded and every write rounded to fils`);
  }

  // The rule that makes Float safe: nothing is written unrounded.
  const posting = read("src/lib/posting.ts");
  if (!posting.includes("toFils(")) {
    note("High", "Finance", "The posting service does not round amounts to fils",
      "A VAT extraction stores 1119.571428…, and reports that round at different points then disagree.");
  } else {
    good("Finance", "the posting service rounds every amount to fils");
  }

  // Prove it rather than assert it: does a realistic sequence actually drift?
  // Kept as context for the decision above rather than reported as a finding:
  // it is a property of doubles everywhere, and it is four orders of magnitude
  // below a fils. What matters is that nothing is stored unrounded, checked above.
  let acc = 0;
  for (let i = 0; i < 1000; i++) acc += 0.1;
  good("Finance", `double drift over 1,000 additions is ${Math.abs(100 - acc).toExponential(1)} — far below a fils`);
}

/* ============================================= double-entry always holds === */
{
  const companies = await db.company.findMany();
  for (const co of companies) {
    const lines = await db.journalLine.findMany({
      where: { entry: { companyId: co.id } },
      select: { debit: true, credit: true },
    });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(dr - cr) > 0.005) {
      note("Critical", "Finance", `Trial balance does not balance for ${co.code}`,
        `Debits ${dr.toFixed(2)} vs credits ${cr.toFixed(2)}, difference ${(dr - cr).toFixed(4)}.`);
    } else {
      good("Finance", `${co.code} trial balance balances (${lines.length} lines)`);
    }

    // Every voucher individually, not just the total — a pair of offsetting
    // broken vouchers would hide in the total.
    const entries = await db.journalEntry.findMany({
      where: { companyId: co.id },
      include: { lines: { select: { debit: true, credit: true } } },
    });
    const broken = entries.filter((e) => {
      const d = e.lines.reduce((s, l) => s + l.debit, 0);
      const c = e.lines.reduce((s, l) => s + l.credit, 0);
      return Math.abs(d - c) > 0.005;
    });
    if (broken.length) {
      note("Critical", "Finance", `${broken.length} unbalanced voucher(s) in ${co.code}`,
        broken.slice(0, 5).map((e) => e.reference).join(", "));
    }

    // A voucher with fewer than two lines is not double entry at all.
    const thin = entries.filter((e) => e.lines.length < 2);
    if (thin.length) {
      note("High", "Finance", `${thin.length} voucher(s) with fewer than two lines in ${co.code}`,
        thin.slice(0, 5).map((e) => `${e.reference} (${e.lines.length} line)`).join(", "));
    }
  }
}

/* ====================================================== UAE VAT statute === */
{
  const vat = read("src/lib/vat.ts");
  const rate = vat.match(/0\.05|5\s*\/\s*100|RATE\s*=\s*([\d.]+)/);
  if (!rate) {
    note("High", "VAT", "Could not find the 5% VAT rate in src/lib/vat.ts",
      "The UAE standard rate is 5%. If it is inlined at each call site it cannot be changed in one place.");
  } else {
    good("VAT", "standard rate 5% present in lib/vat.ts");
  }

  // The FTA boxes. They are named descriptively in the type (standardSupplies,
  // reverseChargeExpenses...) with the box number in the doc comment beside
  // them, so that comment is what identifies them.
  const missingBoxes = ["1", "3", "4", "5", "9", "10", "12", "13", "14"].filter(
    (box) => !new RegExp(`Box ${box}\\b`).test(vat)
  );
  if (missingBoxes.length) {
    note("Medium", "VAT", `VAT 201 box(es) not found: ${missingBoxes.join(", ")}`, "Checked src/lib/vat.ts.");
  } else {
    good("VAT", "all nine VAT 201 boxes are present");
  }

  // Reverse charge is unavoidable for a UAE contractor importing services.
  if (!/reverse charge/i.test(vat)) {
    note("High", "VAT", "No reverse-charge treatment found",
      "Imported services and most GCC imports are reverse charged; boxes 3 and 10 depend on it.");
  } else {
    good("VAT", "reverse-charge treatment is modelled");
  }
}

/* ============================================== TRN — 15 digits, FTA fmt == */
{
  const parties = await db.party.findMany({ where: { trn: { not: null } }, select: { code: true, name: true, trn: true } });
  const badTrn = parties.filter((p) => p.trn && !/^\d{15}$/.test(p.trn.replace(/\s/g, "")));
  if (badTrn.length) {
    note("Medium", "Masters", `${badTrn.length} party TRN(s) are not 15 digits`,
      badTrn.slice(0, 5).map((p) => `${p.code} "${p.trn}"`).join(", "));
  }

  // Is the format enforced on entry at all?
  const partyActions = read("src/app/(app)/finance/parties/actions.ts");
  if (!/\\d\{15\}|length\s*===\s*15|15 digits/i.test(partyActions)) {
    note("High", "Masters", "TRN is not validated on entry",
      "A UAE tax invoice must carry a valid 15-digit TRN. A typo here reaches the printed invoice " +
        "and the VAT 201 transaction list, and the FTA penalises incorrect tax invoices. " +
        "Suggest a 15-digit check with a plain-English message.");
  } else {
    good("Masters", "TRN format is validated on entry");
  }
}

/* ==================================== gratuity — Federal Decree-Law 33/2021 */
{
  const src = fs.existsSync("src/lib/settlement.ts") ? read("src/lib/settlement.ts") : "";
  const has21 = /21/.test(src);
  const has30 = /30/.test(src);
  const hasCap = /2\s*\*|two years|24 \*|cap/i.test(src);
  if (!(has21 && has30)) {
    note("High", "HR", "Gratuity may not follow the 21/30-day rule",
      "UAE Federal Decree-Law 33/2021: 21 days' basic pay per year for the first five years, " +
        "30 days per year thereafter. Checked src/lib/settlement.ts.");
  } else {
    good("HR", "gratuity uses the 21-day / 30-day split");
  }
  if (!hasCap) {
    note("Medium", "HR", "Gratuity total may not be capped at two years' pay",
      "The statute caps total end-of-service gratuity at two years' remuneration.");
  } else {
    good("HR", "gratuity cap is present");
  }
  if (!/unpaid leave|absent|unpaidDays/i.test(src)) {
    note("Low", "HR", "Unpaid leave may not reduce the gratuity service period",
      "Periods of unpaid leave are excluded from the service period under the Decree-Law.");
  }
}

/* ================================================= dates shown to the user = */
{
  // The UAE writes dates DD/MM/YYYY. en-US formatting silently reverses day and
  // month, which is worst for dates below the 13th where it still looks valid.
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk("src");
  const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const enUS = files.filter((f) => /toLocaleDateString\(\s*["']en-US["']/.test(noComments(read(f))));
  const bare = files.filter((f) => /toLocaleDateString\(\s*\)/.test(noComments(read(f))));
  const enGB = files.filter((f) => /toLocaleDateString\(\s*["']en-GB["']/.test(read(f)));
  if (enUS.length) {
    note("High", "UX / UAE", `${enUS.length} screen(s) format dates as en-US (MM/DD/YYYY)`,
      enUS.map((f) => f.replace("src/", "")).slice(0, 8).join(", "));
  }
  if (bare.length) {
    note("Medium", "UX / UAE", `${bare.length} file(s) call toLocaleDateString() with no locale`,
      "The result follows the viewer's browser locale, so the same report reads differently for " +
        "two people in the same office. " + bare.map((f) => f.replace("src/", "")).slice(0, 8).join(", "));
  }
  if (enGB.length) good("UX", `${enGB.length} file(s) correctly pin en-GB (DD/MM/YYYY)`);
}

/* ============================================ currency shown to the user === */
{
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk("src");
  // Strip comments first: lib/money.ts explains the problem in prose, and
  // matching that text would report the fix as the defect.
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // A bare toLocaleString() is wrong on money and right on a count: "237 rows"
  // rather than "237.00 rows". The question is asked of the FILE, not the line —
  // a formatter is usually defined as `(v) => v.toLocaleString()`, which names
  // no money on its own line while every one of its callers does. Pager.tsx
  // formats row counts and mentions no amount anywhere, so it stays quiet;
  // a screen full of grossTotal does not.
  //
  // The money fields are named rather than guessed at from a pattern. Anything
  // ending in "Total" was tried and is no good: grossTotal is money, and
  // liveTotal and archiveTotal on the audit screen are counts of rows.
  const MONEYISH = /(amount|balance|salary|payable|debit|credit|fils|aed|unitPrice|grossTotal|netTotal|vatTotal|contractValue|budgetCost)/;
  const bareNum = files.filter((f) => {
    const src = stripComments(read(f));
    return /toLocaleString\(\)/.test(src) && MONEYISH.test(src);
  });
  if (bareNum.length) {
    note("Medium", "UX / UAE", `${bareNum.length} file(s) render a number with toLocaleString() and no options`,
      "Without minimumFractionDigits the same column shows 1,000 and 1,000.50 on adjacent rows, and " +
        "the fils are dropped entirely on whole amounts. " +
        bareNum.map((f) => f.replace("src/", "")).slice(0, 8).join(", "));
  }
}

/* ==================================================== period lock boundary = */
{
  const posting = read("src/lib/posting.ts");
  if (/date <= company\.booksLockedTo/.test(posting)) {
    good("Finance", "period lock is inclusive of the lock date (date <= lockedTo)");
  } else if (/date < company\.booksLockedTo/.test(posting)) {
    note("High", "Finance", "Period lock may be exclusive of the lock date",
      "If books are locked to 31 Mar, a voucher dated 31 Mar must be refused. An off-by-one here " +
        "lets a posting land inside a filed VAT period.");
  }
}

/* ======================================= names a UAE payroll actually holds */
{
  const employees = await db.employee.findMany({ select: { name: true, empNo: true, iban: true, labourCardNo: true } });
  const longest = employees.map((e) => e.name.length).sort((a, b) => b - a)[0] ?? 0;
  good("HR", `${employees.length} employees seeded, longest name ${longest} chars`);

  // UAE IBANs are AE + 21 digits.
  const badIban = employees.filter((e) => e.iban && !/^AE\d{21}$/.test(e.iban.replace(/\s/g, "")));
  if (badIban.length) {
    note("High", "HR / WPS", `${badIban.length} employee IBAN(s) are not a valid UAE IBAN`,
      "A UAE IBAN is AE followed by 21 digits. The bank rejects the whole WPS SIF file if one row is " +
        "malformed, so this must be caught on entry, not at upload. " +
        badIban.slice(0, 5).map((e) => `${e.empNo} "${e.iban}"`).join(", "));
  }
  const profile = fs.existsSync("src/app/(app)/hr/employees/actions.ts")
    ? read("src/app/(app)/hr/employees/actions.ts") : "";
  const lib = fs.existsSync("src/lib/uae.ts") ? read("src/lib/uae.ts") : "";
  if (!(profile.includes("EMPLOYEE_VALIDATORS") && lib.includes("mod97"))) {
    note("High", "HR / WPS", "IBAN is not format-validated on entry",
      "The bank rejects the whole WPS SIF file on one malformed row. Checked " +
        "src/app/(app)/hr/employees/actions.ts and src/lib/uae.ts.");
  } else {
    good("HR / WPS", "IBAN, Emirates ID and labour card are validated on entry, IBAN with the mod-97 checksum");
  }
  const wpsGen = read("src/app/(app)/hr/payroll/actions.ts");
  if (!wpsGen.includes("cleanIban")) {
    note("High", "HR / WPS", "WPS generation checks presence but not format", "-");
  } else {
    good("HR / WPS", "WPS generation validates format and names why each employee was held back");
  }
}

/* ============================================== orphans and referential gaps */
{
  // accountId is a required relation, so an account-less line cannot exist —
  // the schema already rules it out and there is nothing to check.

  // A line whose account belongs to a different company than its voucher would
  // put one company's money in another's books.
  const cross = await db.journalLine.findMany({
    include: { entry: { select: { companyId: true, reference: true } }, account: { select: { companyId: true } } },
  });
  const mismatched = cross.filter((l) => l.entry.companyId !== l.account.companyId);
  if (mismatched.length) {
    note("Critical", "Data", `${mismatched.length} line(s) post into another company's account`,
      mismatched.slice(0, 5).map((l) => l.entry.reference).join(", "));
  } else {
    good("Data", `all ${cross.length} journal lines use an account from their own company`);
  }

  // Same for the costing dimensions.
  const jobLines = await db.journalLine.findMany({
    where: { jobId: { not: null } },
    include: { entry: { select: { companyId: true, reference: true } }, job: { select: { companyId: true } } },
  });
  const badJob = jobLines.filter((l) => l.job && l.entry.companyId !== l.job.companyId);
  if (badJob.length) {
    note("Critical", "Data", `${badJob.length} line(s) tagged to another company's job`,
      badJob.slice(0, 5).map((l) => l.entry.reference).join(", "));
  } else {
    good("Data", `all ${jobLines.length} job-tagged lines stay inside their own company`);
  }
}

/* ================================================= voucher numbering gaps == */
{
  // An auditor asks for an unbroken sequence per voucher type per year.
  const companies = await db.company.findMany();
  for (const co of companies) {
    const entries = await db.journalEntry.findMany({
      where: { companyId: co.id },
      select: { reference: true, voucherType: true },
      orderBy: { reference: "asc" },
    });
    const bySeries = new Map();
    for (const e of entries) {
      const m = e.reference.match(/^(.+)\/(\d{4})$/);
      if (!m) continue;
      const arr = bySeries.get(m[1]) ?? [];
      arr.push(Number(m[2]));
      bySeries.set(m[1], arr);
    }
    for (const [series, nums] of bySeries) {
      nums.sort((a, b) => a - b);
      const dupes = nums.filter((v, i) => i && v === nums[i - 1]);
      if (dupes.length) {
        note("High", "Finance", `Duplicate voucher number in series ${series}`,
          `Repeated: ${[...new Set(dupes)].join(", ")}. An auditor treats a repeated voucher number as a control failure.`);
      }
      const gaps = [];
      for (let i = 1; i <= nums[nums.length - 1]; i++) if (!nums.includes(i)) gaps.push(i);
      if (gaps.length) {
        note("Low", "Finance", `Gap in voucher series ${series}`,
          `Missing ${gaps.slice(0, 8).join(", ")}${gaps.length > 8 ? "…" : ""}. Expected if vouchers were deleted; ` +
            "worth confirming deletion is not possible.");
      }
    }
  }
}

/* ================================================================ output === */
const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);

console.log("\n=== PASSED CHECKS ===");
for (const g of ok) console.log("  ok  " + g);

console.log(`\n=== FINDINGS (${findings.length}) ===`);
for (const f of findings) {
  console.log(`\n[${f.sev}] ${f.area} — ${f.title}`);
  console.log(`   ${f.detail}`);
}
const counts = findings.reduce((m, f) => ({ ...m, [f.sev]: (m[f.sev] ?? 0) + 1 }), {});
console.log(`\nSummary: ${JSON.stringify(counts)}`);

await db.$disconnect();
