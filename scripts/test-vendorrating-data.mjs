/**
 * Reading a supplier's record out of what actually happened (INV-21).
 *
 * The arithmetic is tested on its own in test-vendorrating.mjs. What matters
 * here is that the queries find the right rows: that a late delivery is read as
 * late, that a rejection is attributed to the supplier who sent it, and that
 * "the lowest quote" means the lowest of everybody who priced that enquiry
 * rather than the lowest of whoever we happen to be rating.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["vendorrating-data", "vendorrating", "rfq-posting", "purchase-posting", "db"]);
const { db } = libs["db"];
const { ratingFor, ratingsFor } = libs["vendorrating-data"];
const { vendorVerdict } = libs["vendorrating"];
const { createRfq, inviteVendors, recordQuotation } = libs["rfq-posting"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");
const today = () => new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const co = await db.company.findFirst({ where: { code: "WBE" } });
const tag = `VR-${Date.now()}`;

/** Build a finished order with its receipts, without going through approval. */
async function orderWith({ partyId, partyName, expectedDate, ordered, received, receiptDate, status }) {
  const order = await db.purchaseOrder.create({
    data: {
      companyId: co.id, number: `${tag}-${Math.random().toString(36).slice(2, 8)}`,
      status, partyId, partyName, date: new Date(), raisedBy: "tester",
      expectedDate: expectedDate ? new Date(expectedDate + "T00:00:00.000Z") : null,
      lines: { create: [{ description: "cable", unitCode: "MTR", quantity: ordered, unitPrice: 10, netAmount: ordered * 10 }] },
    },
    include: { lines: true },
  });
  if (received > 0) {
    await db.stockMovement.create({
      data: {
        companyId: co.id, itemId: item.id, storeId: store.id, kind: "Receipt",
        date: new Date(receiptDate + "T00:00:00.000Z"),
        quantity: received, unitCost: 10, value: received * 10,
        partyId, reference: tag, createdBy: "tester", purchaseOrderLineId: order.lines[0].id,
      },
    });
  }
  return order;
}

const item = await db.item.create({
  data: { companyId: co.id, code: `${tag}-I`, name: "Rating cable", unitCode: "MTR" },
});
const store = await db.store.create({ data: { companyId: co.id, code: `${tag}-S`, name: "Rating store" } });

const vendors = [];
for (const n of ["Punctual", "Late", "Silent", "Partial"]) {
  vendors.push(await db.party.create({
    data: { companyId: co.id, code: `${tag}-${n.slice(0, 4).toUpperCase()}`, name: `${n} Supplies ${tag}`, type: "Supplier" },
  }));
}
const [punctual, late, silent, partial] = vendors;

try {
  /* ============================================================ delivery */
  for (let i = 0; i < 3; i++) {
    await orderWith({
      partyId: punctual.id, partyName: punctual.name, expectedDate: day(-10),
      ordered: 100, received: 100, receiptDate: day(-12), status: "Received",
    });
  }
  for (let i = 0; i < 3; i++) {
    await orderWith({
      partyId: late.id, partyName: late.name, expectedDate: day(-10),
      ordered: 100, received: 100, receiptDate: day(-2), status: "Received",
    });
  }

  {
    const r = await ratingFor(co.id, punctual.id);
    ok("three orders delivered early read as on time", r.delivery.otif === 3, `${r.delivery.otif} of ${r.delivery.considered}`);
    ok("  which is enough history to say so", r.delivery.enough === true);
  }
  {
    const r = await ratingFor(co.id, late.id);
    ok("three orders delivered after the date read as late", r.delivery.otif === 0, `${r.delivery.otif} of ${r.delivery.considered}`);
    ok("  but all in full", r.delivery.inFull === 3,
      "arriving late is a different failure from arriving short");
  }

  /**
   * A short delivery, and an order still running.
   */
  {
    await orderWith({
      partyId: punctual.id, partyName: punctual.name, expectedDate: day(-5),
      ordered: 100, received: 60, receiptDate: day(-6), status: "Received",
    });
    const r = await ratingFor(co.id, punctual.id);
    ok("a short delivery is not in full", r.delivery.inFull === 3 && r.delivery.considered === 4,
      `${r.delivery.inFull} in full of ${r.delivery.considered}`);

    await orderWith({
      partyId: punctual.id, partyName: punctual.name, expectedDate: day(30),
      ordered: 50, received: 0, receiptDate: null, status: "Approved",
    });
    const after = await ratingFor(co.id, punctual.id);
    ok("an order not yet due is not judged at all", after.delivery.considered === 4,
      "a supplier who still has time has done nothing wrong");
  }

  {
    await orderWith({
      partyId: punctual.id, partyName: punctual.name, expectedDate: null,
      ordered: 10, received: 10, receiptDate: day(-1), status: "Received",
    });
    const r = await ratingFor(co.id, punctual.id);
    ok("an order with no promised date is excluded", r.delivery.considered === 4, String(r.delivery.considered));
    ok("  and counted separately so it is visible", r.delivery.undated === 1);
  }

  /**
   * The ordinary way an order finishes late: most of it turns up on time and
   * the tail arrives weeks afterwards.
   *
   * Reading the FIRST receipt would call this on time, which is how a supplier
   * who habitually short-ships their first delivery keeps a clean record.
   */
  {
    const split = await orderWith({
      partyId: partial.id, partyName: partial.name, expectedDate: day(-10),
      ordered: 100, received: 60, receiptDate: day(-14), status: "Received",
    });
    await db.stockMovement.create({
      data: {
        companyId: co.id, itemId: item.id, storeId: store.id, kind: "Receipt",
        date: new Date(day(-2) + "T00:00:00.000Z"),
        quantity: 40, unitCost: 10, value: 400,
        partyId: partial.id, reference: tag, createdBy: "tester",
        purchaseOrderLineId: (await db.purchaseOrderLine.findFirst({ where: { orderId: split.id } })).id,
      },
    });

    const r = await ratingFor(co.id, partial.id);
    ok("an order completed by a second, later receipt is in full", r.delivery.inFull === 1,
      `${r.delivery.inFull} in full`);
    ok("  but not on time", r.delivery.otif === 0,
      "the first sixty arrived early; the last forty did not, and the order is late");
  }

  /* ============================================================= quality */
  {
    for (const outcome of ["Accepted", "Accepted", "Rejected", null]) {
      await db.stockMovement.create({
        data: {
          companyId: co.id, itemId: item.id, storeId: store.id, kind: "Receipt",
          date: new Date(), quantity: 1, unitCost: 1, value: 1,
          partyId: late.id, inspection: outcome, reference: tag, createdBy: "tester",
        },
      });
    }
    const r = await ratingFor(co.id, late.id);
    ok("rejections are attributed to the supplier who sent them", r.quality.rejected === 1, String(r.quality.rejected));
    ok("  over inspected deliveries only", r.quality.inspected === 3, String(r.quality.inspected));

    const other = await ratingFor(co.id, punctual.id);
    ok("  and not to anybody else", other.quality.rejected === 0);
  }

  /* ===================================== responsiveness and price ======= */
  {
    // Three enquiries. Punctual and Late both price all three; Silent is asked
    // every time and never replies.
    for (let i = 0; i < 3; i++) {
      const r = await createRfq({
        companyId: co.id, raisedBy: "buyer", date: today(),
        notes: tag,
        lines: [{ description: "cable", unitCode: "MTR", quantity: 100 }],
      });
      await inviteVendors(r.rfqId, [punctual.id, late.id, silent.id]);
      const line = (await db.rfqLine.findMany({ where: { rfqId: r.rfqId } }))[0];
      await recordQuotation({ rfqId: r.rfqId, partyId: punctual.id, prices: { [line.id]: 10 } });
      await recordQuotation({ rfqId: r.rfqId, partyId: late.id, prices: { [line.id]: 11 } });
    }

    const all = await ratingsFor(co.id, [punctual.id, late.id, silent.id]);

    ok("a supplier who never replies is counted as asked", all[silent.id].response.asked === 3);
    ok("  and as never replying", all[silent.id].response.replied === 0);
    ok("  with no speed to report", all[silent.id].response.medianDays === null);
    ok("  which the sentence says in words, not as 0%",
      !/0%/.test(vendorVerdict(all[silent.id])), vendorVerdict(all[silent.id]));

    ok("a supplier who replies to all three is recorded as such",
      all[punctual.id].response.replied === 3 && all[punctual.id].response.replyRate === 1);

    ok("the cheapest bidder wins on price", all[punctual.id].price.timesLowest === 3,
      `${all[punctual.id].price.timesLowest} of ${all[punctual.id].price.compared}`);
    ok("  and the dearer one does not", all[late.id].price.timesLowest === 0);
    ok("  by ten per cent on average", all[late.id].price.averageAboveLowest === 0.1,
      String(all[late.id].price.averageAboveLowest));

    /**
     * "Lowest" must mean the lowest of everybody who priced the enquiry, not
     * the lowest of the suppliers being rated.
     */
    const onlyLate = await ratingsFor(co.id, [late.id]);
    ok("the lowest quote is the lowest of everybody who priced it",
      onlyLate[late.id].price.timesLowest === 0,
      "rating one supplier alone must not make them the cheapest by default");
    ok("  and still counts the other bidders", onlyLate[late.id].price.compared === 3,
      String(onlyLate[late.id].price.compared));
  }

  /* ============================================== nothing is stored ===== */
  {
    const before = await ratingFor(co.id, punctual.id);
    await orderWith({
      partyId: punctual.id, partyName: punctual.name, expectedDate: day(-20),
      ordered: 100, received: 0, receiptDate: null, status: "Cancelled",
    });
    const after = await ratingFor(co.id, punctual.id);
    ok("the rating moves the moment the facts do",
      after.delivery.considered === before.delivery.considered + 1,
      "a stored rating is a rating that was true once");
  }
} finally {
  /**
   * Swept by the suite's prefix, not this run's tag.
   *
   * A run that dies before its cleanup leaves rows behind under its own
   * timestamp, and a tag-scoped sweep walks straight past them. They then show
   * up on a real screen as a material request for five billion metres of
   * cable, which is how this was found.
   */
  const P = "VR-";
  await db.rfq.deleteMany({ where: { companyId: co.id, notes: { startsWith: P } } });
  await db.stockMovement.deleteMany({ where: { companyId: co.id, reference: { startsWith: P } } });
  await db.purchaseOrderLine.deleteMany({ where: { order: { number: { startsWith: P } } } });
  await db.purchaseOrder.deleteMany({ where: { companyId: co.id, number: { startsWith: P } } });
  await db.materialRequestLine.deleteMany({ where: { item: { code: { startsWith: P } } } });
  await db.item.deleteMany({ where: { companyId: co.id, code: { startsWith: P } } });
  await db.store.deleteMany({ where: { companyId: co.id, code: { startsWith: P } } });
  await db.party.deleteMany({ where: { companyId: co.id, code: { startsWith: P } } });
}

/* ==================================================== how it is wired == */

const src = prose("src/lib/vendorrating-data.ts");
ok("the file says why nothing is stored",
  /a stored rating is a rating that was true once/.test(src));
ok("and why the rules live somewhere else",
  /without a database in the way/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
