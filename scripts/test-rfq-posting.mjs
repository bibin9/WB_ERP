/**
 * Running an enquiry end to end: ask, collect prices, compare, award.
 *
 * The rule the document exists for: the purchase order is built FROM the
 * winning quotation. If it were typed in afresh the price on the order would be
 * whatever the buyer remembered, and the comparison would be a piece of paper
 * beside a decision rather than the reason for it.
 *
 * And the two controls an auditor actually asks about: three suppliers asked,
 * and a recorded reason for not taking the cheapest.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["rfq-posting", "rfq", "purchase-posting", "db"]);
const { db } = libs["db"];
const { createRfq, inviteVendors, recordQuotation, quotesFor, awardRfq, cancelRfq, openRfqs } = libs["rfq-posting"];
const { rankQuotes, summariseRfq } = libs["rfq"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");
const today = () => new Date().toISOString().slice(0, 10);

const co = await db.company.findFirst({ where: { code: "WBE" } });
const job = await db.job.findFirst({ where: { companyId: co.id } });

const tag = `RFQ-${Date.now()}`;
const made = [];

/** Three suppliers to ask. Created here so the suite owns them. */
const vendors = [];
for (const name of ["Alpha Trading", "Beta Supplies", "Gamma Electrical"]) {
  vendors.push(await db.party.create({
    data: { companyId: co.id, code: `${tag}-${name.slice(0, 2).toUpperCase()}`, name: `${name} ${tag}`, type: "Supplier" },
  }));
}

try {
  /* ============================================== raising the enquiry === */
  const raised = await createRfq({
    companyId: co.id, raisedBy: "buyer", jobId: job.id, date: today(), neededBy: today(),
    lines: [
      { description: "4-core 16mm cable", unitCode: "MTR", quantity: 100 },
      { description: "20mm conduit", unitCode: "MTR", quantity: 200 },
    ],
  });
  ok("an enquiry can be raised", raised.ok, raised.ok ? "" : raised.error);
  made.push(raised.rfqId);
  ok("  numbered in its own series", /^WBE\/RFQ\/\d{2}\/\d{4}$/.test(raised.number || ""), raised.number);

  {
    const rfq = await db.rfq.findUnique({ where: { id: raised.rfqId }, include: { lines: true } });
    ok("  starting as a draft", rfq.status === "Draft");
    ok("  with its lines", rfq.lines.length === 2);
  }

  const empty = await createRfq({ companyId: co.id, raisedBy: "buyer", date: today(), lines: [] });
  ok("an enquiry with no lines is refused", empty.ok === false, empty.error);

  /* ================================================== asking suppliers == */
  {
    const sent = await inviteVendors(raised.rfqId, [vendors[0].id, vendors[1].id], "buyer");
    ok("suppliers can be asked", sent.ok, sent.ok ? "" : sent.error);

    const rfq = await db.rfq.findUnique({ where: { id: raised.rfqId }, include: { quotes: true } });
    ok("  and the enquiry is then out", rfq.status === "Sent");
    ok("  with a row for each supplier asked", rfq.quotes.length === 2);
    ok("  carrying their name as it is today",
      rfq.quotes.every((q) => q.partyName.includes(tag)),
      "a supplier renamed next year must not rewrite this enquiry");
    ok("  and no price yet", rfq.quotes.every((q) => q.receivedAt === null));
  }

  /**
   * The way round the three-supplier rule, if it counted rows.
   */
  {
    await inviteVendors(raised.rfqId, [vendors[0].id], "buyer");
    const rfq = await db.rfq.findUnique({ where: { id: raised.rfqId }, include: { quotes: true } });
    ok("asking the same supplier twice adds nothing", rfq.quotes.length === 2,
      "otherwise three invitations to one supplier would satisfy the rule");
  }

  /* ==================================================== the quotations == */
  const rfqLines = await db.rfqLine.findMany({ where: { rfqId: raised.rfqId }, orderBy: { sortOrder: "asc" } });

  {
    const priced = await recordQuotation({
      rfqId: raised.rfqId, partyId: vendors[0].id,
      prices: { [rfqLines[0].id]: 12, [rfqLines[1].id]: 3 },
      delivery: 200, leadTimeDays: 30,
    });
    ok("a price can be recorded against a supplier", priced.ok, priced.ok ? "" : priced.error);

    const rfq = await db.rfq.findUnique({ where: { id: raised.rfqId } });
    ok("  and the enquiry has prices in it", rfq.status === "Quoted");
  }

  {
    const priced = await recordQuotation({
      rfqId: raised.rfqId, partyId: vendors[1].id,
      prices: { [rfqLines[0].id]: 13, [rfqLines[1].id]: 3 },
      delivery: 0, leadTimeDays: 7,
    });
    ok("a second supplier's price is recorded too", priced.ok, priced.ok ? "" : priced.error);
  }

  {
    const stranger = await recordQuotation({
      rfqId: raised.rfqId, partyId: vendors[2].id, prices: { [rfqLines[0].id]: 1 },
    });
    ok("a price from a supplier who was never asked is refused", stranger.ok === false);
    ok("  and says so", /was not asked/.test(stranger.error || ""), stranger.error);
  }

  const negative = await recordQuotation({
    rfqId: raised.rfqId, partyId: vendors[0].id, prices: { [rfqLines[0].id]: -5 },
  });
  ok("a negative price is refused", negative.ok === false, negative.error);

  /**
   * A supplier revising their quote replaces it rather than adding to it.
   */
  {
    await recordQuotation({
      rfqId: raised.rfqId, partyId: vendors[0].id,
      prices: { [rfqLines[0].id]: 12, [rfqLines[1].id]: 3 },
      delivery: 200, leadTimeDays: 30,
    });
    const quote = await db.rfqQuote.findFirst({
      where: { rfqId: raised.rfqId, partyId: vendors[0].id }, include: { lines: true },
    });
    ok("re-quoting replaces the old prices", quote.lines.length === 2,
      "keeping both would double the total");
  }

  /* ===================================================== the comparison = */
  {
    const quotes = await quotesFor(raised.rfqId);
    const ranked = rankQuotes(quotes);

    // Alpha: 100x12 + 200x3 + 200 delivery = 2000. Beta: 100x13 + 200x3 = 1900.
    ok("the comparison reads the quantities from the enquiry, not the quote",
      ranked.find((r) => r.partyName.startsWith("Alpha")).total === 2000,
      "a supplier cannot quote against a quantity nobody asked for");
    ok("  and delivery decides it", ranked[0].partyName.startsWith("Beta"),
      ranked.map((r) => `${r.partyName.split(" ")[0]} ${r.total}`).join(" | "));

    const t = summariseRfq(quotes);
    ok("two suppliers asked is not enough to award", t.enoughInvited === false, `${t.invited} asked`);
  }

  {
    const early = await awardRfq({
      rfqId: raised.rfqId, partyId: vendors[1].id, awardedBy: "buyer",
    });
    ok("awarding with only two suppliers asked is refused", early.ok === false);
    ok("  and says three are wanted", /at least 3 suppliers/.test(early.error || ""), early.error);
  }

  /* ========================================= the third supplier, and the award */
  await inviteVendors(raised.rfqId, [vendors[2].id], "buyer");
  await recordQuotation({
    rfqId: raised.rfqId, partyId: vendors[2].id,
    prices: { [rfqLines[0].id]: 11, [rfqLines[1].id]: 3 },
    delivery: 0, leadTimeDays: 60,
  });

  {
    const quotes = await quotesFor(raised.rfqId);
    const ranked = rankQuotes(quotes);
    ok("the third quote is the cheapest", ranked[0].partyName.startsWith("Gamma"),
      ranked.map((r) => `${r.partyName.split(" ")[0]} ${r.total}`).join(" | "));
  }

  {
    const dearer = await awardRfq({ rfqId: raised.rfqId, partyId: vendors[1].id, awardedBy: "buyer" });
    ok("awarding to a dearer supplier without a reason is refused", dearer.ok === false);
    ok("  naming what it costs extra", /dearer than/.test(dearer.error || ""), dearer.error);

    const rfq = await db.rfq.findUnique({ where: { id: raised.rfqId } });
    ok("  and nothing is awarded", rfq.status === "Quoted" && rfq.orderId === null,
      "a refused award must not leave a half-made order behind");
  }

  let awarded;
  {
    awarded = await awardRfq({
      rfqId: raised.rfqId, partyId: vendors[1].id, awardedBy: "buyer",
      reason: "Gamma cannot deliver before the shutdown",
    });
    ok("awarding to a dearer supplier with a reason is allowed", awarded.ok, awarded.ok ? "" : awarded.error);
    ok("  and raises a purchase order", /^WBE\/PO\/\d{2}\/\d{4}$/.test(awarded.number || ""), awarded.number);
  }

  {
    const rfq = await db.rfq.findUnique({ where: { id: raised.rfqId } });
    ok("the enquiry is marked awarded", rfq.status === "Awarded");
    ok("  to the supplier chosen", rfq.awardedPartyId === vendors[1].id);
    ok("  keeping the reason", rfq.awardReason === "Gamma cannot deliver before the shutdown",
      "a year from now this is the only record of the decision");
    ok("  and linked to the order it produced", rfq.orderId === awarded.orderId);
  }

  /**
   * The point of the whole document.
   */
  {
    const order = await db.purchaseOrder.findUnique({
      where: { id: awarded.orderId }, include: { lines: true },
    });
    ok("the order carries the price the supplier quoted",
      order.lines.find((l) => l.description.includes("16mm")).unitPrice === 13,
      "not whatever the buyer remembered");
    ok("  for every line", order.lines.find((l) => l.description.includes("conduit")).unitPrice === 3);
    ok("  and totals what the comparison said", order.total === 1900, String(order.total));
    ok("  against the job the enquiry was for", order.jobId === job.id);

    ok("the order is a draft, not approved",
      order.status === "Draft",
      "winning an enquiry is not an approval; the PO route still decides who signs");
  }

  /**
   * Carriage rides as its own line so the unit rates still match the quotation.
   */
  {
    const gammaRfq = await createRfq({
      companyId: co.id, raisedBy: "buyer", date: today(),
      lines: [{ description: "Cable tray", unitCode: "MTR", quantity: 50 }],
    });
    made.push(gammaRfq.rfqId);
    await inviteVendors(gammaRfq.rfqId, vendors.map((v) => v.id), "buyer");
    const line = (await db.rfqLine.findMany({ where: { rfqId: gammaRfq.rfqId } }))[0];
    for (const v of vendors) {
      await recordQuotation({ rfqId: gammaRfq.rfqId, partyId: v.id, prices: { [line.id]: 20 }, delivery: 300 });
    }
    const res = await awardRfq({ rfqId: gammaRfq.rfqId, partyId: vendors[0].id, awardedBy: "buyer" });
    ok("a tie can be awarded to any of them without a reason", res.ok, res.ok ? "" : res.error);

    const order = await db.purchaseOrder.findUnique({
      where: { id: res.orderId }, include: { lines: true },
    });
    ok("  carriage is its own line", order.lines.length === 2 && order.lines.some((l) => l.unitPrice === 300));
    ok("  leaving the unit rate matching the quotation",
      order.lines.find((l) => l.description.includes("tray")).unitPrice === 20,
      "carriage baked into a rate is found by the receiving clerk, months later");
  }

  /* ================================================== what is now shut == */
  {
    const again = await awardRfq({ rfqId: raised.rfqId, partyId: vendors[0].id, awardedBy: "buyer", reason: "changed my mind" });
    ok("an awarded enquiry cannot be awarded again", again.ok === false, again.error);

    const late = await recordQuotation({
      rfqId: raised.rfqId, partyId: vendors[0].id, prices: { [rfqLines[0].id]: 1 },
    });
    ok("and no more prices can be entered against it", late.ok === false);
    ok("  which says why", /has been awarded/.test(late.error || ""), late.error);

    const shut = await inviteVendors(raised.rfqId, [vendors[2].id], "buyer");
    ok("and no more suppliers can be asked", shut.ok === false, shut.error);

    const cancel = await cancelRfq(raised.rfqId);
    ok("an awarded enquiry cannot be cancelled", cancel.ok === false);
    ok("  and points at the order instead", /Cancel the purchase order instead/.test(cancel.error || ""), cancel.error);
  }

  /* ========================================================= what is open */
  {
    const open = await openRfqs(co.id);
    ok("an awarded enquiry is no longer open",
      !open.some((r) => r.id === raised.rfqId));
  }
} finally {
  const ids = (await db.rfq.findMany({
    where: { companyId: co.id, OR: [{ id: { in: made } }, { notes: { contains: tag } }] },
    select: { id: true, orderId: true },
  }));
  for (const r of ids) {
    if (r.orderId) {
      await db.purchaseOrderLine.deleteMany({ where: { orderId: r.orderId } });
      await db.purchaseOrder.delete({ where: { id: r.orderId } }).catch(() => {});
    }
  }
  await db.rfq.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
  await db.purchaseOrder.deleteMany({ where: { companyId: co.id, partyName: { contains: tag } } });
  await db.party.deleteMany({ where: { companyId: co.id, code: { startsWith: "RFQ-" } } });
}

/* ==================================================== how it is wired == */

const src = prose("src/lib/rfq-posting.ts");
ok("the file says why the order is built from the quotation",
  /whatever the buyer remembered/.test(src));
ok("and why winning is not approval",
  /commit the company's money by picking a name off a comparison sheet/.test(src));
ok("and why the rule is applied on the server too",
  /a rule enforced only in a browser is a suggestion/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
