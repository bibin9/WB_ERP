/**
 * The documents' loaders, against the local database.
 *
 * test-documents.mjs checks how a document is drawn from data handed to it.
 * This checks the data: that each loader only ever returns a record from a
 * company the reader can see, that a supplier's bill never comes back as our
 * tax invoice, that a lorry of items is one note, that the approver on a
 * request is the person who approved it, and that every document is guarded
 * by a screen that actually exists.
 *
 * Every row it makes carries the tag below and is removed at the end, pass or
 * fail.
 */
import { loadDocuments } from "./lib-documents.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const docs = loadDocuments({ realDb: true });
const { db } = docs.require("@/lib/db");
const { DOCUMENTS } = docs.require("@/documents/registry");
const { SCREENS } = docs.require("@/lib/rbac");

const TAG = "DOCLOAD-TEST";
const co = await db.company.findFirst({ where: { code: "WBE" } });
const other = await db.company.findFirst({ where: { code: { not: "WBE" } } });
const mine = [co.id];
const theirs = other ? [other.id] : [];
const made = [];
const track = (model, row) => (made.push([model, row.id]), row);

try {
  /* ----------------------------------------------------- the registry -- */
  const screenKeys = new Set(SCREENS.map((s) => s.key));
  const unguarded = Object.entries(DOCUMENTS).filter(([, d]) => !screenKeys.has(d.screen)).map(([k, d]) => `${k} → ${d.screen}`);
  ok("every document is guarded by a screen that exists", unguarded.length === 0, unguarded.join(", ") || Object.keys(DOCUMENTS).join(", "));

  /* ------------------------------------------------------------ fixtures -- */
  const party = track("party", await db.party.create({
    data: { companyId: co.id, code: `${TAG}-P`, name: `${TAG} Supplier LLC`, type: "Both", city: "Dubai", trn: "100555666700003", contactPerson: "Sanjay", email: "s@example.test" },
  }));
  const store = track("store", await db.store.create({ data: { companyId: co.id, code: `${TAG}-S`, name: "Test store" } }));
  const store2 = track("store", await db.store.create({ data: { companyId: co.id, code: `${TAG}-S2`, name: "Test site store" } }));
  const item = track("item", await db.item.create({ data: { companyId: co.id, code: `${TAG}-I1`, name: "Test cable", unitCode: "M" } }));
  const item2 = track("item", await db.item.create({ data: { companyId: co.id, code: `${TAG}-I2`, name: "Test gland", unitCode: "EA" } }));
  const job = track("job", await db.job.create({ data: { companyId: co.id, code: `${TAG}-J`, name: "Test job" } }));
  const day = new Date("2026-09-15T00:00:00.000Z");

  /* ---------------------------------------------------------- tax invoice -- */
  const sale = track("invoice", await db.invoice.create({
    data: { companyId: co.id, side: "Sales", number: `${TAG}-INV`, issueDate: day, partyId: party.id, partyName: party.name, status: "Issued", sellerTrn: "100123456700003", netTotal: 100, vatTotal: 5, grossTotal: 105, taxBreakdown: "not json" },
  }));
  const bill = track("invoice", await db.invoice.create({
    data: { companyId: co.id, side: "Purchase", number: `${TAG}-BILL`, issueDate: day, partyId: party.id, partyName: party.name, status: "Issued" },
  }));
  const invDoc = await DOCUMENTS["tax-invoice"].load(sale.id, mine);
  ok("a sales invoice loads", invDoc?.number === `${TAG}-INV`);
  ok("  and a damaged tax breakdown does not stop it printing", Array.isArray(invDoc?.breakdown) && invDoc.breakdown.length === 0);
  ok("  with the TRN it was issued under in the letterhead", invDoc?.lh.trn === "TRN 100123456700003");
  ok("a supplier's bill is never loaded as our tax invoice", (await DOCUMENTS["tax-invoice"].load(bill.id, mine)) === null);
  if (other) ok("an invoice from a company the reader cannot see is not found", (await DOCUMENTS["tax-invoice"].load(sale.id, theirs)) === null);

  /* ---------------------------------------------------------- store notes -- */
  const mv = (data) => db.stockMovement.create({ data: { companyId: co.id, date: day, unitCost: 10, value: 10 * data.quantity, ...data } }).then((r) => track("stockMovement", r));
  const r1 = await mv({ kind: "Receipt", itemId: item.id, storeId: store.id, partyId: party.id, quantity: 100, reference: `${TAG}-DN1`, inspection: "Pending" });
  await mv({ kind: "Receipt", itemId: item2.id, storeId: store.id, partyId: party.id, quantity: 20, reference: `${TAG}-DN1`, inspection: "Accepted" });
  await mv({ kind: "Receipt", itemId: item2.id, storeId: store.id, partyId: party.id, quantity: 5, reference: `${TAG}-DN2` });
  await mv({ kind: "Receipt", itemId: item2.id, storeId: store.id, partyId: party.id, quantity: 7, reference: `${TAG}-DN1`, date: new Date("2026-09-16T00:00:00.000Z") });
  const grn = await DOCUMENTS["store-note"].load(r1.id, mine);
  ok("a delivery of two items is one goods received note with two lines", grn?.title === "GOODS RECEIVED NOTE" && grn?.lines.length === 2, `${grn?.lines.length} lines`);
  ok("  another delivery note is not folded into it", !grn?.lines.some((l) => l.quantity === 5));
  ok("  nor the same note number on another day", !grn?.lines.some((l) => l.quantity === 7));
  ok("  and the supplier is named", grn?.party?.[0] === party.name);

  const tOut = await mv({ kind: "Transfer out", itemId: item.id, storeId: store.id, quantity: 30, reference: `${TAG}-TR` });
  const tIn = await mv({ kind: "Transfer in", itemId: item.id, storeId: store2.id, quantity: 30, reference: `${TAG}-TR` });
  const fromOut = await DOCUMENTS["store-note"].load(tOut.id, mine);
  const fromIn = await DOCUMENTS["store-note"].load(tIn.id, mine);
  ok("a transfer is one note whichever end it is opened from", fromOut?.lines.length === 1 && fromIn?.lines.length === 1 && fromIn?.store === fromOut?.store);
  ok("  naming both stores", fromOut?.store.includes(`${TAG}-S —`) && fromOut?.toStore?.includes(`${TAG}-S2`));
  const adj = await mv({ kind: "Adjustment out", itemId: item.id, storeId: store.id, quantity: 1, reference: `${TAG}-ADJ` });
  ok("an adjustment has no note", (await DOCUMENTS["store-note"].load(adj.id, mine)) === null);
  if (other) ok("a note from a company the reader cannot see is not found", (await DOCUMENTS["store-note"].load(r1.id, theirs)) === null);

  /* ----------------------------------------------------- material request -- */
  const approval = track("approvalRequest", await db.approvalRequest.create({
    data: {
      companyId: co.id, docType: "Material Request", title: TAG, requestedBy: "Site", status: "Approved",
      steps: { create: [
        { order: 1, roleName: "Site in-charge", requiredLevel: 30, status: "Approved", decidedBy: "First Approver", decidedAt: day },
        { order: 2, roleName: "Project Manager", requiredLevel: 50, status: "Approved", decidedBy: "Final Approver", decidedAt: day },
      ] },
    },
  }));
  const mr = track("materialRequest", await db.materialRequest.create({
    data: { companyId: co.id, number: `${TAG}-MR`, status: "Approved", requestedBy: "Foreman", jobId: job.id, storeId: store.id, approvalRequestId: approval.id,
      lines: { create: [{ itemId: item.id, description: "Test cable", unitCode: "M", quantity: 50, order: 1 }] } },
  }));
  const mrDoc = await DOCUMENTS["material-request"].load(mr.id, mine);
  ok("a material request names the person who gave the final approval", mrDoc?.approvedBy === "Final Approver", mrDoc?.approvedBy ?? "none");
  const pending = track("materialRequest", await db.materialRequest.create({
    data: { companyId: co.id, number: `${TAG}-MR2`, status: "Submitted", requestedBy: "Foreman" },
  }));
  ok("  and one not yet approved names nobody", (await DOCUMENTS["material-request"].load(pending.id, mine))?.approvedBy === null);

  /* ----------------------------------------------------------------- rfq -- */
  const rfq = track("rfq", await db.rfq.create({
    data: { companyId: co.id, number: `${TAG}-RFQ`, date: day, raisedBy: "Buyer", status: "Sent",
      lines: { create: [{ itemId: item.id, description: "Test cable", unitCode: "M", quantity: 500, sortOrder: 1 }] },
      quotes: { create: [{ partyId: party.id, partyName: party.name }] } },
    include: { quotes: true },
  }));
  const addressed = await DOCUMENTS.rfq.load(rfq.quotes[0].id, mine);
  const blank = await DOCUMENTS.rfq.load(rfq.id, mine);
  ok("an enquiry printed from a supplier's column is addressed to them", addressed?.supplier?.[0] === party.name && addressed.filename.includes(party.code));
  ok("  and printed from the enquiry itself is addressed to nobody", blank?.number === `${TAG}-RFQ` && blank.supplier === null);
  if (other) ok("an enquiry from a company the reader cannot see is not found, by either id", (await DOCUMENTS.rfq.load(rfq.id, theirs)) === null && (await DOCUMENTS.rfq.load(rfq.quotes[0].id, theirs)) === null);

  /* -------------------------------------------------------- payroll + HR -- */
  const emp = track("employee", await db.employee.create({
    data: { companyId: co.id, empNo: `${TAG}-E1`, name: "Test Employee", designation: "Electrician", bankName: "Emirates NBD", iban: "AE070331234567890123456" },
  }));
  const run = track("payrollRun", await db.payrollRun.create({ data: { companyId: co.id, period: "1999-01", runBy: TAG, status: "Approved" } }));
  const slip = await db.payslip.create({
    data: { runId: run.id, employeeId: emp.id, empNo: emp.empNo, employeeName: emp.name, basic: 3000, allowances: 1000, netPay: 4000, daysPaid: 31, daysInPeriod: 31 },
  });
  const one = await DOCUMENTS.payslip.load(slip.id, mine);
  const all = await DOCUMENTS["payroll-run"].load(run.id, mine);
  ok("a payslip loads with the employee's designation", one?.slips.length === 1 && one.slips[0].designation === "Electrician");
  ok("  and the bank account masked to its last four", one?.slips[0].bank === "Emirates NBD, account ending 3456", one?.slips[0].bank ?? "none");
  ok("a run loads every payslip in it", all?.slips.length === 1 && all.filename.includes("1999-01"));
  if (other) ok("a payslip from a company the reader cannot see is not found", (await DOCUMENTS.payslip.load(slip.id, theirs)) === null && (await DOCUMENTS["payroll-run"].load(run.id, theirs)) === null);

  const sep = track("separation", await db.separation.create({
    data: { companyId: co.id, employeeId: emp.id, type: "Resignation", lastWorkingDay: day, basicSalary: 3000, serviceText: "2y", serviceYears: 2, gratuityDays: 42, gratuityAmount: 4200, noticePay: 0, airTicket: 900, netSettlement: 5100, status: "Draft" },
  }));
  const set = await DOCUMENTS.settlement.load(sep.id, mine);
  ok("a settlement lists only the entitlements that apply", set?.additions.map((a) => a.label).join(", ") === "End-of-service gratuity, Unused leave encashment, Repatriation air ticket", set?.additions.map((a) => a.label).join(", "));
  if (other) ok("a settlement from a company the reader cannot see is not found", (await DOCUMENTS.settlement.load(sep.id, theirs)) === null);

  /* ------------------------------------------------------------ sample -- */
  ok("the letterhead sample is only for a company the reader can see",
    (await DOCUMENTS["letterhead-sample"].load(co.id, mine))?.lh.companyName === co.name && (await DOCUMENTS["letterhead-sample"].load(co.id, theirs)) === null);
} finally {
  // Children first; the payslip and steps go with their parents.
  const order = ["separation", "payslip", "payrollRun", "employee", "rfq", "materialRequest", "approvalRequest", "stockMovement", "invoice", "job", "item", "store", "party"];
  for (const model of order) {
    const ids = made.filter(([m]) => m === model).map(([, id]) => id);
    if (ids.length) await db[model].deleteMany({ where: { id: { in: ids } } }).catch((e) => console.log(`  cleanup ${model}: ${e.message.split("\n")[0]}`));
  }
  await db.$disconnect();
  docs.cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
