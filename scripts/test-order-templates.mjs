/**
 * Purchase orders somebody expects to raise again.
 *
 * What a template is for: the monthly PRO package, the consumables run, the
 * hire that comes back every shutdown — the same supplier and the same lines,
 * typed out from scratch each time until somebody gets a quantity wrong.
 *
 * What it must NOT become is a way to skip the parts of an order that belong
 * to one order only. A template carries no date, no job, no store, no
 * approval and no number: what is raised from it is an ordinary order that
 * goes through the route like any other. The rates it carries are the ones
 * last agreed, which is a starting point and not a price — the test below
 * pins the wording that says so, because that sentence is the whole defence
 * against somebody sending last year's prices to a supplier.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const libs = await importLibs([
  "purchase-posting", "purchasing", "posting", "accounts", "financepolicy",
  "money", "db", "period", "vat", "notify", "stock-posting", "stock",
]);
const { createOrder } = libs["purchase-posting"];

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");

const schema = read("prisma/schema.prisma");
const actions = read("src/app/(app)/inventory/actions.ts");
const form = read("src/components/inventory/OrderForm.tsx");

/* ================= what a template holds, and what it must not ========== */

const model = schema.slice(schema.indexOf("model OrderTemplate {"), schema.indexOf("model OrderTemplateLine {"));
for (const field of ["date", "expectedDate", "jobId", "storeId", "status", "approvalRequestId", "number"]) {
  ok(`a template carries no ${field} — that belongs to one order`, !new RegExp(`\\n  ${field}\\s`).test(model));
}
ok("it does carry the supplier, the lines and a name", /partyId/.test(model) && /lines/.test(model) && /name/.test(model));
ok("two templates in one company cannot share a name", /@@unique\(\[companyId, name\]\)/.test(model));
ok("its lines go when it goes", /onDelete: Cascade/.test(schema.slice(schema.indexOf("model OrderTemplateLine {"))));

ok("the rates are described as last agreed, not as prices",
  /last agreed, as a starting point/.test(schema), "a template remembers what was, not what is");
ok("and the form says so where somebody picking one will read it",
  /a template remembers what was, not what is/.test(form));

/* ============================== the guards ============================== */

ok("saving one needs permission to raise orders",
  /saveOrderAsTemplate[\s\S]{0,200}allow\("inventory\.orders", "create"\)/.test(actions));
ok("deleting one needs permission to delete them",
  /deleteOrderTemplate[\s\S]{0,200}allow\("inventory\.orders", "delete"\)/.test(actions));
ok("both check the company as well as the permission",
  (actions.match(/scoped\(/g) || []).length > 2);
ok("an unnamed template is refused, and says why a name matters",
  /Name the template/.test(actions) && /tells the next person what it is/.test(actions));
ok("saving is audited", /entity: "OrderTemplate"/.test(actions));

/* ========================= on the database ============================== */

const co = await db.company.findFirst({ where: { code: "WBE" } });
const supplier = await db.party.findFirst({ where: { companyId: co.id, type: { not: "Customer" } } });
const TAG = `TPL-${Date.now()}`;

const clean = async () => {
  await db.orderTemplate.deleteMany({ where: { name: { startsWith: "TPL-" } } });
  const orders = await db.purchaseOrder.findMany({ where: { notes: { contains: "TPL-" } }, select: { id: true } });
  for (const o of orders) {
    await db.purchaseOrderLine.deleteMany({ where: { orderId: o.id } });
    await db.purchaseOrder.delete({ where: { id: o.id } });
  }
};
await clean();

try {
  const order = await createOrder({
    companyId: co.id, raisedBy: "procurement", partyId: supplier.id,
    date: new Date().toISOString().slice(0, 10), notes: `${TAG} monthly package`,
    lines: [
      { description: "PRO — new employment visa", unitCode: "EA", quantity: 3, unitPrice: 3500 },
      { description: "PRO — labour card renewal", unitCode: "EA", quantity: 2, unitPrice: 850 },
    ],
  });
  ok("an order can be raised to keep", order.ok, order.ok ? "" : order.error);

  const raised = await db.purchaseOrder.findUnique({ where: { id: order.orderId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  const template = await db.orderTemplate.create({
    data: {
      companyId: co.id, name: `${TAG} Monthly PRO package`, partyId: raised.partyId,
      notes: raised.notes, createdBy: "procurement",
      lines: { create: raised.lines.map((l, i) => ({
        itemId: l.itemId, description: l.description, unitCode: l.unitCode,
        quantity: l.quantity, unitPrice: l.unitPrice, sortOrder: i,
      })) },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  ok("it keeps every line, in the order they were typed",
    template.lines.map((l) => l.description).join(" | ") === raised.lines.map((l) => l.description).join(" | "));
  ok("  with their quantities and the rates agreed",
    template.lines[0].quantity === 3 && template.lines[0].unitPrice === 3500);
  ok("  and the supplier", template.partyId === supplier.id);

  let clash = null;
  try {
    await db.orderTemplate.create({ data: { companyId: co.id, name: `${TAG} Monthly PRO package`, createdBy: "someone else" } });
  } catch (e) { clash = e.code; }
  ok("a second template of the same name in the same company is refused", clash === "P2002",
    "otherwise a picker shows two identical names and nobody knows which is current");

  // An order raised from a template is an ordinary order: this is the check
  // that it goes through approval like any other, rather than arriving approved.
  const fromTemplate = await createOrder({
    companyId: co.id, raisedBy: "procurement", partyId: template.partyId,
    date: new Date().toISOString().slice(0, 10), notes: `${TAG} raised from template`,
    lines: template.lines.map((l) => ({
      description: l.description, unitCode: l.unitCode, quantity: l.quantity, unitPrice: l.unitPrice,
    })),
  });
  ok("an order raised from a template is raised", fromTemplate.ok, fromTemplate.ok ? "" : fromTemplate.error);
  const child = await db.purchaseOrder.findUnique({ where: { id: fromTemplate.orderId } });
  ok("  and starts as a draft, not approved", child.status === "Draft");
  ok("  with its own number in the series", child.number !== raised.number, `${child.number} vs ${raised.number}`);

  await db.orderTemplate.delete({ where: { id: template.id } });
  ok("removing a template takes its lines with it",
    (await db.orderTemplateLine.count({ where: { templateId: template.id } })) === 0);
  ok("  and leaves the orders raised from it alone",
    !!(await db.purchaseOrder.findUnique({ where: { id: fromTemplate.orderId } })),
    "they are their own documents");
} finally {
  await clean();
}

console.log("\n" + "=".repeat(50));
console.log(`ORDER TEMPLATES:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
console.log("=".repeat(50));
await db.$disconnect();
if (fail > 0) process.exit(1);
