/**
 * Files filed against a bill or an order, and the order that approves a bill.
 *
 * The client's way of working, which this exists to support: a basic order
 * goes to the supplier; the supplier sends their invoice with the government
 * fee receipts behind it; a purchase order carrying the amount actually
 * charged goes for approval with those receipts attached; only then is the
 * bill posted.
 *
 * Two rules hold it together. A file is readable only by somebody who may open
 * the screen it is filed against — attaching the supplier's bill to an order
 * must not show its prices to everyone who can see orders. And a bill against
 * an order cannot be issued until that order is approved, or the approval
 * happens after the money is committed, which is no approval at all.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const libs = await importLibs([
  "attachments", "uploads", "invoice-posting", "purchase-posting", "purchasing",
  "posting", "accounts", "financepolicy", "money", "db", "period", "vat", "notify", "invoice", "rbac",
]);
const { ATTACHABLE, attachableFor, cleanKind, fileSize, DEFAULT_KIND } = libs["attachments"];
const { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES } = libs["uploads"];
const { issueInvoice } = libs["invoice-posting"];
const { createOrder } = libs["purchase-posting"];
const { SCREENS } = libs["rbac"];

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");
const today = () => new Date().toISOString().slice(0, 10);

/* ===================== what may be attached, and who may read it ========= */

ok("a bill and an order can both carry files", ATTACHABLE.length === 2);
ok("each names the screen that governs reading them",
  ATTACHABLE.every((a) => SCREENS.some((s) => s.key === a.screen)),
  ATTACHABLE.map((a) => `${a.entity}→${a.screen}`).join(" "));
ok("  the bill's files follow the invoices screen", attachableFor("Invoice").screen === "finance.invoices");
ok("  the order's follow the orders screen", attachableFor("PurchaseOrder").screen === "inventory.orders");
ok("an unknown thing cannot be attached to", attachableFor("Employee") === undefined);

ok("every kind offered on a bill covers what a PRO invoice arrives with",
  ["Supplier invoice", "Government fee receipt"].every((k) => attachableFor("Invoice").kinds.includes(k)),
  attachableFor("Invoice").kinds.join(", "));
ok("a kind nobody offered becomes Other rather than being stored as typed",
  cleanKind("Invoice", "<script>") === DEFAULT_KIND);
ok("an offered kind is kept", cleanKind("Invoice", "Government fee receipt") === "Government fee receipt");
ok("a kind for the wrong document is refused too", cleanKind("PurchaseOrder", "Payment receipt") === DEFAULT_KIND);

ok("sizes read as somebody would say them",
  fileSize(512) === "512 bytes" && fileSize(2048) === "2 KB" && fileSize(3 * 1024 * 1024) === "3.0 MB");

/* ============================ the upload rules are the HR ones =========== */

const actions = read("src/app/(app)/attachments/actions.ts");
ok("the file is identified by its first bytes, not by its name", /identify\(file\.name, bytes\)/.test(actions));
ok("the name on disk is random, so nothing an uploader wrote reaches it",
  /randomBytes\(16\)/.test(actions) && /kind\.type\.extensions\[0\]/.test(actions));
ok("the size limit is the one the rest of the system uses", MAX_UPLOAD_BYTES === 10 * 1024 * 1024);
ok("nothing executable is on the allow-list",
  !ALLOWED_EXTENSIONS.some((e) => [".exe", ".js", ".svg", ".html", ".sh"].includes(e)),
  ALLOWED_EXTENSIONS.join(" "));
ok("uploading is audited", /audit\(\{/.test(actions) && /Attached \$\{file\.name\}/.test(actions));

const route = read("src/app/api/attachments/[id]/route.ts");
ok("downloading checks the screen again, not just the session", /can\(session, a\.screen\)/.test(route));
ok("  and that the file is in a company this person belongs to",
  /session\.companies\.some\(\(c\) => c\.id === row\.companyId\)/.test(route));
ok("  and refuses a stored name that tries to escape the folder",
  /startsWith\(uploads \+ path\.sep\)/.test(route));
ok("  and never serves a type that is not on the list",
  /known \? row\.mimeType : "application\/octet-stream"/.test(route));

/* ============== the order that approves a bill, on the database ========== */

const co = await db.company.findFirst({ where: { code: "WBE" } });
const supplier = await db.party.findFirst({ where: { companyId: co.id, type: { not: "Customer" } } });
const account = await db.chartOfAccount.findFirst({ where: { companyId: co.id, type: "Expense" }, orderBy: { code: "asc" } });
const MARK = "[attachment test]";

const clean = async () => {
  const bills = await db.invoice.findMany({ where: { notes: { contains: MARK } }, select: { id: true, entryId: true } });
  for (const b of bills) {
    await db.attachment.deleteMany({ where: { entity: "Invoice", entityId: b.id } });
    await db.invoiceLine.deleteMany({ where: { invoiceId: b.id } });
    await db.invoice.delete({ where: { id: b.id } });
    if (b.entryId) {
      await db.journalLine.deleteMany({ where: { entryId: b.entryId } });
      await db.journalEntry.delete({ where: { id: b.entryId } }).catch(() => undefined);
    }
  }
  const orders = await db.purchaseOrder.findMany({ where: { notes: { contains: MARK } }, select: { id: true, approvalRequestId: true } });
  for (const o of orders) {
    await db.attachment.deleteMany({ where: { entity: "PurchaseOrder", entityId: o.id } });
    await db.purchaseOrderLine.deleteMany({ where: { orderId: o.id } });
    await db.purchaseOrder.delete({ where: { id: o.id } });
    if (o.approvalRequestId) {
      await db.approvalStep.deleteMany({ where: { requestId: o.approvalRequestId } });
      await db.approvalRequest.delete({ where: { id: o.approvalRequestId } }).catch(() => undefined);
    }
  }
};
await clean();

try {
  const order = await createOrder({
    companyId: co.id, raisedBy: "procurement", partyId: supplier.id, date: today(), notes: MARK,
    lines: [{ description: "PRO — new employment visa, 3 staff", unitCode: "EA", quantity: 3, unitPrice: 3500 }],
  });
  ok("an order can be raised carrying what the supplier actually charged", order.ok, order.ok ? "" : order.error);

  const bill = await db.invoice.create({
    data: {
      companyId: co.id, side: "Purchase", docType: "Invoice", status: "Draft",
      number: `GPS/${Date.now()}`, issueDate: new Date(), dueDate: new Date(),
      partyId: supplier.id, partyName: supplier.name, orderId: order.orderId, notes: MARK, createdBy: "accounts",
      lines: { create: [{ description: "PRO service fee", quantity: 1, unitCode: "EA", unitPrice: 10500, netAmount: 10500, vatTreatment: "Standard", vatRate: 5, vatAmount: 525, accountId: account.id, order: 0 }] },
    },
  });

  // The rule the whole arrangement rests on.
  const early = await issueInvoice(bill.id, "accounts");
  ok("the bill cannot be issued while its order is still a draft", early.ok === false);
  ok("  and it says which order, and why", /nobody has approved|waiting for approval/.test(early.error || ""), early.error);

  await db.purchaseOrder.update({ where: { id: order.orderId }, data: { status: "Awaiting approval" } });
  const waiting = await issueInvoice(bill.id, "accounts");
  ok("nor while it is waiting for approval", waiting.ok === false);
  ok("  and it says the bill can go once the order is approved",
    /once it is approved/.test(waiting.error || ""), waiting.error);

  await db.purchaseOrder.update({ where: { id: order.orderId }, data: { status: "Approved" } });
  const issued = await issueInvoice(bill.id, "accounts");
  ok("once the order is approved the bill posts", issued.ok, issued.ok ? "" : issued.error);

  // A bill with no order at all is unaffected: a small purchase does not need
  // one, and requiring it would push people back into paying off paper.
  const loose = await db.invoice.create({
    data: {
      companyId: co.id, side: "Purchase", docType: "Invoice", status: "Draft",
      number: `MISC/${Date.now()}`, issueDate: new Date(), dueDate: new Date(),
      partyId: supplier.id, partyName: supplier.name, notes: MARK, createdBy: "accounts",
      lines: { create: [{ description: "Courier", quantity: 1, unitCode: "EA", unitPrice: 60, netAmount: 60, vatTreatment: "Standard", vatRate: 5, vatAmount: 3, accountId: account.id, order: 0 }] },
    },
  });
  const free = await issueInvoice(loose.id, "accounts");
  ok("a bill with no order behind it still posts", free.ok, free.ok ? "" : free.error);
} finally {
  await clean();
}

console.log("\n" + "=".repeat(50));
console.log(`ATTACHMENTS:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
console.log("=".repeat(50));
await db.$disconnect();
if (fail > 0) process.exit(1);
