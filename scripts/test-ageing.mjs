/**
 * Outstanding and ageing.
 *
 * This is the report the accounts manager acts on — chasing a customer for the
 * wrong amount, or for money they already paid, costs a relationship. So the
 * settlement and bucketing rules are exercised directly.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

if (!process.execArgv.includes("--experimental-strip-types")) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const { ageParty } = await import("../src/lib/ageing.ts");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const D = (s) => new Date(s + "T00:00:00.000Z");
const inv = (ref, date, amount, creditDays) => ({ reference: ref, date: D(date), amount, creditDays });
const rcpt = (ref, date, amount) => ({ reference: ref, date: D(date), amount: -amount });

const ASAT = D("2026-09-04");

/* ------------------------------------------------------------ basics ----- */
let a = ageParty([inv("SI/001", "2026-09-01", 10000)], ASAT);
ok("a single unpaid invoice is the whole outstanding", a.total === 10000 && a.items.length === 1);
ok("a 3-day-old invoice sits in 0–30 days", a.d30 === 10000 && a.d60 === 0, `d30=${a.d30}`);

a = ageParty([inv("SI/001", "2026-09-01", 10000), rcpt("RV/001", "2026-09-03", 10000)], ASAT);
ok("a fully paid invoice leaves nothing outstanding", a.total === 0 && a.items.length === 0);

a = ageParty([inv("SI/001", "2026-09-01", 10000), rcpt("RV/001", "2026-09-03", 4000)], ASAT);
ok("a part payment leaves the balance", a.total === 6000 && a.items[0].outstanding === 6000);

/* -------------------------------------------------------------- FIFO ----- */
// Three invoices, one payment that covers the first and part of the second.
a = ageParty([
  inv("SI/001", "2026-03-01", 10000),
  inv("SI/002", "2026-06-01", 20000),
  inv("SI/003", "2026-08-20", 30000),
  rcpt("RV/001", "2026-08-25", 15000),
], ASAT);
ok("a receipt clears the oldest invoice first", a.items.find((i) => i.reference === "SI/001") === undefined,
  "SI/001 fully settled");
ok("the remainder lands on the next oldest",
  a.items.find((i) => i.reference === "SI/002")?.outstanding === 15000,
  `SI/002 = ${a.items.find((i) => i.reference === "SI/002")?.outstanding}`);
ok("the newest invoice is untouched",
  a.items.find((i) => i.reference === "SI/003")?.outstanding === 30000);
ok("the total ties out", a.total === 45000, String(a.total));

/* ----------------------------------------------------------- buckets ----- */
a = ageParty([
  inv("A", "2026-08-25", 1000),  // 10 days
  inv("B", "2026-07-20", 2000),  // 46 days
  inv("C", "2026-06-20", 4000),  // 76 days
  inv("D", "2026-01-10", 8000),  // 237 days
], ASAT);
ok("0–30 bucket", a.d30 === 1000, String(a.d30));
ok("31–60 bucket", a.d60 === 2000, String(a.d60));
ok("61–90 bucket", a.d90 === 4000, String(a.d90));
ok("over 90 bucket", a.d90plus === 8000, String(a.d90plus));
ok("buckets add up to the total", a.d30 + a.d60 + a.d90 + a.d90plus === a.total, String(a.total));

/* -------------------------------------------------- boundaries ----------- */
a = ageParty([inv("X", "2026-08-05", 100)], ASAT); // exactly 30 days
ok("exactly 30 days stays in the first bucket", a.d30 === 100 && a.d60 === 0);
a = ageParty([inv("X", "2026-08-04", 100)], ASAT); // 31 days
ok("31 days moves to the second bucket", a.d30 === 0 && a.d60 === 100);
a = ageParty([inv("X", "2026-06-06", 100)], ASAT); // 90 days
ok("exactly 90 days stays in the third bucket", a.d90 === 100 && a.d90plus === 0);
a = ageParty([inv("X", "2026-06-05", 100)], ASAT); // 91 days
ok("91 days moves to over-90", a.d90 === 0 && a.d90plus === 100);

/* ------------------------------------------------------ credit terms ----- */
a = ageParty([inv("SI/001", "2026-08-20", 5000, 30)], ASAT); // 15 days old, 30-day terms
ok("an invoice inside its credit period is not overdue", a.overdue === 0 && a.total === 5000);
a = ageParty([inv("SI/001", "2026-07-01", 5000, 30)], ASAT); // 65 days old, 30-day terms
ok("an invoice past its credit period is overdue", a.overdue === 5000, String(a.overdue));
ok("overdue days are counted from the due date, not the invoice date",
  a.items[0].overdueDays === 35, String(a.items[0].overdueDays));

/* ------------------------------------------------- payments on account --- */
a = ageParty([inv("SI/001", "2026-08-01", 5000), rcpt("RV/001", "2026-08-10", 8000)], ASAT);
ok("an overpayment leaves nothing outstanding", a.items.length === 0);
ok("the excess is reported as unapplied, not hidden", a.unapplied === 3000, String(a.unapplied));
ok("the total goes negative — we owe them", a.total === -3000, String(a.total));

a = ageParty([rcpt("RV/001", "2026-08-10", 5000)], ASAT);
ok("an advance with no invoice is fully unapplied", a.unapplied === 5000 && a.total === -5000);

/* -------------------------------------------------------- edge cases ----- */
ok("no documents means nothing outstanding", ageParty([], ASAT).total === 0);
a = ageParty([inv("B", "2026-08-01", 1000), inv("A", "2026-03-01", 2000), rcpt("R", "2026-08-15", 2000)], ASAT);
ok("documents are settled in date order however they arrive",
  a.items.length === 1 && a.items[0].reference === "B", a.items.map((i) => i.reference).join(","));

a = ageParty([inv("SI/001", "2026-08-01", 1000.555), rcpt("RV/001", "2026-08-02", 0.555)], ASAT);
ok("amounts are rounded to fils, not left with float dust", a.total === 1000, String(a.total));

/* ------------------------------------------------------------ wiring ----- */
const read = (f) => fs.readFileSync(f, "utf8");

const partyActions = read("src/app/(app)/finance/parties/actions.ts");
ok("a duplicate party name is refused", partyActions.includes("already exists as"));
ok("a TRN must be 15 digits", partyActions.includes("A TRN is 15 digits"));
ok("a party with vouchers cannot be deleted, only deactivated", partyActions.includes("Deactivate it instead of deleting"));
ok("party screens are permission-gated", partyActions.includes('allow("finance.parties"'));

const outstanding = read("src/app/(app)/finance/outstanding/page.tsx");
ok("outstanding is measured against control accounts", outstanding.includes("controlType"));
ok("supplier balances are flipped so what we owe reads positive", outstanding.includes('side === "receivable" ? net : -net'));
ok("the report is permission-gated", outstanding.includes('requireAccess("finance.outstanding")'));
ok("dates use the UAE DD/MM/YYYY convention", outstanding.includes("getUTCDate()).padStart(2"));

const voucher = read("src/components/JournalForm.tsx");
ok("the voucher picks a party rather than free text",
  voucher.includes("partyId") && !voucher.includes('placeholder="Customer / supplier"'));

const finActions = read("src/app/(app)/finance/actions.ts");
ok("the voucher snapshots the party name for the printed document", finActions.includes("partyName = party.name"));
ok("a party from another company is refused", finActions.includes("not on this company"));
ok("control accounts are set on the account form", read("src/components/AccountForm.tsx").includes("controlType"));

const screens = read("src/lib/rbac.ts");
ok("both new screens are in the access-control list", screens.includes("finance.parties") && screens.includes("finance.outstanding"));
ok("both appear as finance tabs", read("src/components/FinanceTabsClient.tsx").includes("finance.outstanding"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
