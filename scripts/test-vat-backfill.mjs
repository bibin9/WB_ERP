/**
 * VAT treatment on data seeded before the field existed.
 *
 * Found from a user asking why two vouchers were missing from the return. The
 * whole return read nil while the ledger plainly held tax, because the sample
 * invoices had been seeded before per-line VAT treatment was added and the seed
 * only asks whether anything was seeded at all — so an older install is never
 * rebuilt and never backfilled.
 *
 * This reproduces that state deliberately, strips the treatments, re-runs the
 * seed, and checks they come back. It is the third defect of this exact shape,
 * after the WPS identifiers and the VAT control accounts.
 */
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { DOCUMENT_VOUCHERS, OUTPUT_VOUCHERS, INPUT_VOUCHERS } from "../src/lib/vat.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const company = await db.company.findFirst({ where: { code: "WBE" } });
const SEEDED = ["SAL/WBE/0001", "PUR/WBE/0001", "SAL/WBE/0002", "PUR/WBE/0002", "CN/WBE/0001"];

const treatmentsOn = async () => {
  const entries = await db.journalEntry.findMany({
    where: { companyId: company.id, reference: { in: SEEDED } },
    include: { lines: true },
  });
  return entries.filter((e) => e.lines.some((l) => l.vatTreatment)).length;
};

ok("the sample vouchers exist", (await db.journalEntry.count({ where: { companyId: company.id, reference: { in: SEEDED } } })) > 0);

/* ---------------------------- reproduce an install seeded before the field */
await db.journalLine.updateMany({
  where: { entry: { companyId: company.id, reference: { in: SEEDED } } },
  data: { vatTreatment: null },
});
ok("with the treatments stripped, no sample voucher carries one", (await treatmentsOn()) === 0);

// That is exactly production's state: the ledger holds tax, the return cannot.
const taxHeld = await db.journalEntry.aggregate({
  where: { companyId: company.id, reference: { in: SEEDED } },
  _sum: { vatAmount: true },
});
ok("but the vouchers still carry VAT amounts, so the return would read nil against a ledger that does not",
  (taxHeld._sum.vatAmount ?? 0) > 0, `${taxHeld._sum.vatAmount} of tax with nowhere to go`);

/* --------------------------------------------------- the seed repairs it - */
execFileSync("node", ["prisma/seed.mjs"], { stdio: "pipe" });
const restored = await treatmentsOn();
ok("re-running the seed restores every treatment", restored === SEEDED.length, `${restored} of ${SEEDED.length}`);

const byRef = new Map(
  (await db.journalEntry.findMany({
    where: { companyId: company.id, reference: { in: SEEDED } },
    include: { lines: { include: { account: { select: { code: true } } } } },
  })).map((e) => [e.reference, e])
);
const treatmentOf = (ref, code) =>
  byRef.get(ref)?.lines.find((l) => l.account.code === code)?.vatTreatment;
ok("the standard-rated sale is standard-rated", treatmentOf("SAL/WBE/0001", "4000") === "Standard");
ok("the export is zero-rated", treatmentOf("SAL/WBE/0002", "4000") === "Zero-rated");
ok("the imported service is reverse charge", treatmentOf("PUR/WBE/0002", "5000") === "Reverse charge");
ok("the credit note is standard-rated, so it reduces what was declared",
  treatmentOf("CN/WBE/0001", "4000") === "Standard");

/* ------------------------------------- a treatment a user chose is kept -- */
const sale = byRef.get("SAL/WBE/0001");
const line = sale.lines.find((l) => l.account.code === "4000");
await db.journalLine.update({ where: { id: line.id }, data: { vatTreatment: "Exempt" } });
execFileSync("node", ["prisma/seed.mjs"], { stdio: "pipe" });
ok("the backfill does not overwrite a treatment somebody chose",
  (await db.journalLine.findUnique({ where: { id: line.id } })).vatTreatment === "Exempt");
await db.journalLine.update({ where: { id: line.id }, data: { vatTreatment: "Standard" } });

/* -------------------------------------- settlements are not "untreated" -- */
ok("a receipt is not a document that needs a treatment", !DOCUMENT_VOUCHERS.has("Receipt"));
ok("nor is a payment", !DOCUMENT_VOUCHERS.has("Payment"));
ok("a sales invoice is", DOCUMENT_VOUCHERS.has("Sales"));
ok("and so is a credit note", DOCUMENT_VOUCHERS.has("Credit Note"));
ok("the VAT screen only flags document types",
  read("src/app/(app)/finance/vat/page.tsx").includes("DOCUMENT_VOUCHERS.has(e.voucherType)"));

/* ------------------------------- a journal carrying VAT is not lost ------ */
ok("a journal is not a VAT voucher type",
  !OUTPUT_VOUCHERS.has("Journal") && !INPUT_VOUCHERS.has("Journal"));
const page = read("src/app/(app)/finance/vat/page.tsx");
ok("so the screen hunts for journals that carry a treatment anyway", page.includes("strayJournals"));
ok("and says the tax is not being declared", page.includes("not being declared"));

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
