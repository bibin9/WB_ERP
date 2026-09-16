/**
 * Raising, approving and receiving a purchase order, end to end.
 *
 * The rule the document exists for: nothing may be received against an order
 * nobody has approved. Everything else here is in service of that — the route
 * that decides who signs, the mirroring that keeps the order and the approval
 * inbox from telling different stories, and the status that follows from what
 * actually turned up rather than from somebody remembering to change it.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs([
  "purchase-posting", "purchasing", "stock-posting", "stock", "approval-engine",
  "posting", "accounts", "financepolicy", "money", "db", "period", "vat", "notify",
]);
const { db } = libs["db"];
const {
  createRequest, createOrder, submitOrder, syncOrderApproval,
  cancelOrder, receiveAgainstOrder, openOrders,
} = libs["purchase-posting"];
const { lineProgress } = libs["purchasing"];
const { balanceFor } = libs["stock-posting"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
const today = () => new Date().toISOString().slice(0, 10);

const co = await db.company.findFirst({ where: { code: "WBE" } });
const tenant = await db.tenant.findFirst({ where: { key: "wandb" } });
const job = await db.job.findFirst({ where: { companyId: co.id } });
const supplier = await db.party.findFirst({ where: { companyId: co.id, type: { not: "Customer" } } })
  ?? await db.party.findFirst({ where: { companyId: co.id } });

const tag = `PO-${Date.now()}`;
const orders = [];
const requests = [];

/** Approve or reject the request an order is waiting on, as the inbox would. */
async function decide(orderId, decision) {
  const order = await db.purchaseOrder.findUnique({ where: { id: orderId } });
  await db.approvalStep.updateMany({
    where: { requestId: order.approvalRequestId },
    data: { status: decision, decidedBy: "tester", decidedAt: new Date() },
  });
  await db.approvalRequest.update({ where: { id: order.approvalRequestId }, data: { status: decision } });
}

try {
  const item = await db.item.create({
    data: { companyId: co.id, code: `${tag}-CBL`, name: "4-core 16mm cable", unitCode: "MTR" },
  });
  const store = await db.store.create({ data: { companyId: co.id, code: `${tag}-ST`, name: "Main store", isDefault: true } });

  /* ============================================= the request from site == */
  {
    const res = await createRequest({
      companyId: co.id, requestedBy: "storeman", jobId: job.id, storeId: store.id,
      lines: [{ itemId: item.id, description: "4-core 16mm cable", unitCode: "MTR", quantity: 500 }],
    });
    ok("site can raise a material request", res.ok, res.ok ? "" : res.error);
    if (res.ok) requests.push(res.requestId);
    ok("  numbered for the company and the year", /^WBE\/MR\/\d{2}\/\d{4}$/.test(res.number || ""), res.number);

    const empty = await createRequest({ companyId: co.id, requestedBy: "storeman", lines: [] });
    ok("a request with no lines is refused", empty.ok === false, empty.error);
  }

  /* ============================================== the order, unapproved == */
  const made = await createOrder({
    companyId: co.id, raisedBy: "buyer", partyId: supplier.id, jobId: job.id, storeId: store.id,
    requestId: requests[0], date: today(), expectedDate: today(),
    lines: [{ itemId: item.id, description: "4-core 16mm cable", unitCode: "MTR", quantity: 500, unitPrice: 12 }],
  });
  ok("an order can be raised", made.ok, made.ok ? "" : made.error);
  orders.push(made.orderId);
  ok("  numbered in its own series", /^WBE\/PO\/\d{2}\/\d{4}$/.test(made.number || ""), made.number);

  {
    const order = await db.purchaseOrder.findUnique({ where: { id: made.orderId }, include: { lines: true } });
    ok("it starts as a draft", order.status === "Draft");
    ok("  totalled from its lines", order.total === 6000, String(order.total));
    ok("  with the supplier's name snapshotted", order.partyName === supplier.name,
      "a supplier renamed next year must not rewrite this order");
    ok("  and the request it came from is marked ordered",
      (await db.materialRequest.findUnique({ where: { id: requests[0] } })).status === "Ordered");

    const line = order.lines[0];
    ok("the line is priced", line.netAmount === 6000);

    /**
     * The rule the whole document exists for.
     */
    const early = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 100, reference: `${tag}-EARLY`,
    });
    ok("nothing can be received against a draft order", early.ok === false);
    ok("  and it says the order was never sent", /not been sent for approval/.test(early.error || ""), early.error);
  }

  /* ================================================== sent for approval == */
  {
    const sent = await submitOrder(made.orderId, tenant.id, "buyer");
    ok("an order can be sent for approval", sent.ok, sent.ok ? "" : sent.error);

    const order = await db.purchaseOrder.findUnique({ where: { id: made.orderId }, include: { lines: true } });
    ok("  and is then awaiting it", order.status === "Awaiting approval");
    ok("  linked to a real approval request", !!order.approvalRequestId);

    const request = await db.approvalRequest.findUnique({
      where: { id: order.approvalRequestId }, include: { steps: true },
    });
    ok("  raised against the configured route", request.steps.length > 0,
      `${request.steps.length} steps: ${request.steps.map((s) => s.roleName).join(", ")}`);
    ok("  carrying the order's value, which decides who signs", request.amount === 6000);
    ok("  and its number, so an approver knows what they are approving",
      request.title.includes(order.number));

    const again = await submitOrder(made.orderId, tenant.id, "buyer");
    ok("it cannot be sent twice", again.ok === false, again.error);

    const blocked = await receiveAgainstOrder({
      orderLineId: order.lines[0].id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 100, reference: `${tag}-WAIT`,
    });
    ok("still nothing can be received while it waits", blocked.ok === false);
    ok("  and it says what it is waiting for", /waiting for approval/.test(blocked.error || ""), blocked.error);
  }

  /* ========================================================== approved === */
  {
    await decide(made.orderId, "Approved");

    const status = await syncOrderApproval(made.orderId);
    ok("approving in the inbox reaches the order", status === "Approved",
      "the approval is the source of truth and the order follows it");

    const order = await db.purchaseOrder.findUnique({ where: { id: made.orderId } });
    ok("  and the moment is recorded", !!order.approvedAt);
  }

  /* ========================================================= receiving === */
  {
    const order = await db.purchaseOrder.findUnique({ where: { id: made.orderId }, include: { lines: true } });
    const line = order.lines[0];

    const part = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 200, reference: `${tag}-GRN1`,
    });
    ok("material can now be received", part.ok, part.ok ? "" : part.error);

    const movement = await db.stockMovement.findUnique({ where: { id: part.movementId } });
    ok("  priced from the order, not typed again", movement.unitCost === 12,
      "what was agreed is what it is worth until the invoice says otherwise");
    ok("  and tied back to the line it came from", movement.purchaseOrderLineId === line.id);
    ok("  it posts like any other receipt", !!movement.entryId);

    const shelf = await balanceFor(co.id, item.id, store.id);
    ok("  the stock is on the shelf", shelf.quantity === 200 && shelf.value === 2400);

    const after = await db.purchaseOrder.findUnique({ where: { id: made.orderId } });
    ok("the order becomes partly received on its own", after.status === "Partly received",
      "nobody has to remember to change it");

    const fresh = await db.purchaseOrderLine.findUnique({
      where: { id: line.id }, include: { receipts: { select: { quantity: true } } },
    });
    const p = lineProgress(fresh.quantity, fresh.receipts);
    ok("  with 300 still outstanding", p.outstanding === 300, String(p.outstanding));

    /* over-receipt */
    const over = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 400, reference: `${tag}-OVER`,
    });
    ok("receiving more than is outstanding is refused", over.ok === false);
    ok("  naming what is left", /Only 300/.test(over.error || ""), over.error);
    ok("  and leaving the shelf untouched",
      (await balanceFor(co.id, item.id, store.id)).quantity === 200);

    /* the rest */
    const rest = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 300, reference: `${tag}-GRN2`,
    });
    ok("the remainder can be received", rest.ok, rest.ok ? "" : rest.error);

    const done = await db.purchaseOrder.findUnique({ where: { id: made.orderId } });
    ok("the order closes itself when everything has arrived", done.status === "Received");

    const nothing = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 1, reference: `${tag}-AGAIN`,
    });
    ok("and nothing further can be received against it", nothing.ok === false, nothing.error);
  }

  /* ========================================================= rejected ==== */
  {
    const r = await createOrder({
      companyId: co.id, raisedBy: "buyer", partyId: supplier.id, storeId: store.id, date: today(),
      lines: [{ itemId: item.id, description: "Cable", unitCode: "MTR", quantity: 10, unitPrice: 5 }],
    });
    orders.push(r.orderId);
    await submitOrder(r.orderId, tenant.id, "buyer");
    await decide(r.orderId, "Rejected");

    const status = await syncOrderApproval(r.orderId);
    ok("a rejection reaches the order too", status === "Rejected");

    const line = (await db.purchaseOrder.findUnique({ where: { id: r.orderId }, include: { lines: true } })).lines[0];
    const res = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 1, reference: `${tag}-REJ`,
    });
    ok("  and nothing can be received against it", res.ok === false, res.error);
  }

  /* ======================================================= cancelling ==== */
  {
    const c = await createOrder({
      companyId: co.id, raisedBy: "buyer", partyId: supplier.id, storeId: store.id, date: today(),
      lines: [{ itemId: item.id, description: "Cable", unitCode: "MTR", quantity: 10, unitPrice: 5 }],
    });
    orders.push(c.orderId);
    ok("an untouched order can be cancelled", (await cancelOrder(c.orderId, "buyer")).ok);
    ok("  and not twice", (await cancelOrder(c.orderId, "buyer")).ok === false);

    // One that has already had material against it.
    const d = await createOrder({
      companyId: co.id, raisedBy: "buyer", partyId: supplier.id, storeId: store.id, date: today(),
      lines: [{ itemId: item.id, description: "Cable", unitCode: "MTR", quantity: 10, unitPrice: 5 }],
    });
    orders.push(d.orderId);
    await submitOrder(d.orderId, tenant.id, "buyer");
    await decide(d.orderId, "Approved");
    await syncOrderApproval(d.orderId);
    const dline = (await db.purchaseOrder.findUnique({ where: { id: d.orderId }, include: { lines: true } })).lines[0];
    await receiveAgainstOrder({
      orderLineId: dline.id, postedBy: "storeman", storeId: store.id,
      date: today(), quantity: 4, reference: `${tag}-PART`,
    });

    const res = await cancelOrder(d.orderId, "buyer");
    ok("an order with material already delivered cannot be cancelled", res.ok === false);
    ok("  because the paper cannot un-deliver the shelf",
      /already on the shelf/.test(res.error || ""), res.error);
  }

  /*
   * A delivery is received into a store that uses bins.
   *
   * Every store this suite builds has no bins, so the bin requirement never
   * fired and this went unnoticed: receiving against an order passed no bin to
   * the movement, and a binned store refuses one that does not name it. The main
   * store is both the store most likely to be divided into bins and the store
   * orders are received into, so in practice a purchase order could not be
   * received at all.
   */
  {
    const binned = await db.store.create({
      data: { companyId: co.id, code: `${tag}-BINS`, name: "Binned store" },
    });
    const shelf = await db.storageBin.create({
      data: { storeId: binned.id, code: "A-01", zone: "A", materialType: "Cable" },
    });

    const order = await createOrder({
      companyId: co.id, raisedBy: "buyer", partyId: supplier.id, date: today(),
      lines: [{ itemId: item.id, description: item.name, unitCode: "EA", quantity: 20, unitPrice: 10 }],
    });
    await submitOrder(order.orderId, co.tenantId, "buyer");
    await decide(order.orderId, "Approved");
    orders.push(order.orderId);
    const line = await db.purchaseOrderLine.findFirst({ where: { orderId: order.orderId } });

    const withBin = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: binned.id, binId: shelf.id,
      date: today(), quantity: 5, reference: `${tag}-DN1`,
    });
    ok("a delivery is received into a store that uses bins", withBin.ok === true,
      withBin.ok ? "" : withBin.error);

    if (withBin.ok) {
      const m = await db.stockMovement.findUnique({ where: { id: withBin.movementId } });
      ok("  and the movement says which bin it was put away in", m?.binId === shelf.id,
        m?.binId ? "bin recorded" : "no bin on the movement");
      ok("  and it is still tied to the order line it came against",
        m?.purchaseOrderLineId === line.id);
    }

    const noBin = await receiveAgainstOrder({
      orderLineId: line.id, postedBy: "storeman", storeId: binned.id,
      date: today(), quantity: 5, reference: `${tag}-DN2`,
    });
    ok("  and a delivery into a binned store still has to name one", noBin.ok === false,
      noBin.ok ? "it was allowed in with no bin" : noBin.error.slice(0, 60));
  }

  /* ===================================================== what is open ==== */
  {
    const open = await openOrders(co.id);
    ok("the open list holds only what can still be received",
      open.every((o) => o.status === "Approved" || o.status === "Partly received"),
      open.map((o) => o.status).join(", ") || "none");
  }
} finally {
  for (const id of orders) {
    const lines = await db.purchaseOrderLine.findMany({ where: { orderId: id }, select: { id: true } });
    const moves = await db.stockMovement.findMany({
      where: { purchaseOrderLineId: { in: lines.map((l) => l.id) } },
      select: { id: true, entryId: true },
    });
    await db.stockMovement.deleteMany({ where: { id: { in: moves.map((m) => m.id) } } });
    for (const m of moves) {
      if (!m.entryId) continue;
      await db.journalLine.deleteMany({ where: { entryId: m.entryId } });
      await db.journalEntry.delete({ where: { id: m.entryId } }).catch(() => {});
    }
    const order = await db.purchaseOrder.findUnique({ where: { id } });
    await db.purchaseOrder.delete({ where: { id } }).catch(() => {});
    if (order?.approvalRequestId) {
      await db.approvalStep.deleteMany({ where: { requestId: order.approvalRequestId } });
      await db.approvalRequest.delete({ where: { id: order.approvalRequestId } }).catch(() => {});
    }
  }
  for (const id of requests) await db.materialRequest.delete({ where: { id } }).catch(() => {});
  await db.stockMovement.deleteMany({ where: { companyId: co.id, reference: { startsWith: tag } } });
  await db.item.deleteMany({ where: { companyId: co.id, code: { startsWith: tag } } });
  await db.store.deleteMany({ where: { companyId: co.id, code: { startsWith: tag } } });
}

/* ===================================================== how it is wired == */

const src = read("src/lib/purchase-posting.ts");
ok("an order posts nothing to the ledger",
  /An order posts nothing to the ledger/.test(src) && !/postVoucher/.test(src),
  "a commitment is not a transaction");
ok("the approval route comes from the tenant's configuration", /resolveRoute\(/.test(src));
ok("the order mirrors the approval rather than deciding for itself",
  /source of truth and the order follows it/.test(src));
ok("and the receipt checks the live status, not a remembered one",
  /const status = await syncOrderApproval\(line\.orderId\)/.test(src));

const schema = read("prisma/schema.prisma");
ok("a receipt can be tied to the order line it came from", /purchaseOrderLineId String\?/.test(schema));
ok("an order carries no VAT, and the schema says why", /No VAT anywhere on it/.test(schema));



console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
