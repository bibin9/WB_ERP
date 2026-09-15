/**
 * The quotation end to end, against a real database (CRM-13 to CRM-17).
 *
 * The rules are tested on their own in test-quoting.mjs. What matters here is
 * that the seam keeps them: the price comes from the estimate and cannot be
 * typed, nothing reaches a customer before management has signed it, an issued
 * quotation is revised rather than edited, and the job created from the
 * customer's order carries THEIR figure with a budget from the estimate.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["quote-posting", "quoting", "estimate-posting", "lead-posting", "db"]);
const { db } = libs["db"];
const {
  createQuotation, submitQuotation, syncQuoteApproval, withdrawQuotation,
  issueQuotation, reviseQuotation, acceptQuotation, declineQuotation, QUOTE_DOC_TYPE,
} = libs["quote-posting"];
const { createEstimate, saveLine, setBasis } = libs["estimate-posting"];
const { createLead } = libs["lead-posting"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");
const today = () => new Date().toISOString().slice(0, 10);

const co = await db.company.findFirst({ where: { code: "WBE" } });
const tenant = await db.tenant.findFirst({ where: { key: "wandb" } });
const TAG = "QTN-TEST";

/** Approve or reject whatever a quotation is waiting on, as the inbox would. */
async function decide(quotationId, decision) {
  const q = await db.quotation.findUnique({ where: { id: quotationId } });
  await db.approvalStep.updateMany({
    where: { requestId: q.approvalRequestId },
    data: { status: decision, decidedBy: "Director", decidedAt: new Date() },
  });
  await db.approvalRequest.update({ where: { id: q.approvalRequestId }, data: { status: decision } });
}

/** An estimate that costs 1,000 and quotes at 1,200. */
async function pricedEstimate(title, { quantity = 100, material = 10, markup = 0.2, hours = 0.5 } = {}) {
  const lead = await createLead({
    companyId: co.id, raisedBy: "Sales", title: `${TAG} ${title}`, customerName: "Emirates Steel",
    estimatedValue: 100000,
  });
  const est = await createEstimate({
    companyId: co.id, preparedBy: "Estimator", title: `${TAG} ${title}`,
    leadId: lead.leadId, basisKind: "markup", basisValue: markup,
  });
  await saveLine({
    estimateId: est.estimateId, description: "Priced work", unit: "Metre",
    quantity, materialCost: material, labourHours: hours, labourRate: 0,
  });
  return { leadId: lead.leadId, estimateId: est.estimateId };
}

try {
  /* ====================================== priced from the estimate (13) == */
  const { leadId, estimateId } = await pricedEstimate("Substation");
  const made = await createQuotation({
    companyId: co.id, preparedBy: "Estimator", estimateId, validUntil: today(),
  });
  ok("a quotation can be raised from an estimate", made.ok, made.ok ? "" : made.error);
  ok("  numbered in its own series", /^WBE\/QTN\/\d{2}\/\d{4}$/.test(made.number || ""), made.number);
  ok("  at the estimate's price, not a typed one", made.total === 1200, String(made.total));

  {
    const q = await db.quotation.findUnique({ where: { id: made.quotationId } });
    ok("  starting as a draft", q.status === "Draft");
    ok("  carrying what it cost, so the margin can be checked later", q.costAtQuote === 1000, String(q.costAtQuote));
    ok("  and the hours, so the job has a budget", q.budgetHours === 50, String(q.budgetHours));
    ok("  taking the customer from the enquiry", q.customerName === "Emirates Steel");
    ok("  and linked to both", q.leadId === leadId && q.estimateId === estimateId);
  }

  {
    const bare = await createEstimate({ companyId: co.id, preparedBy: "E", title: `${TAG} uncosted` });
    const r = await createQuotation({ companyId: co.id, preparedBy: "E", estimateId: bare.estimateId, customerName: "X" });
    ok("an uncosted estimate cannot be quoted", r.ok === false);
    ok("  and says why", /has not been costed/.test(r.error), r.error);
  }

  {
    const losing = await pricedEstimate("Losing", { markup: -0.1 });
    const r = await createQuotation({ companyId: co.id, preparedBy: "E", estimateId: losing.estimateId });
    ok("an estimate below cost cannot be quoted by accident", r.ok === false);
    ok("  unless it is a deliberate loss leader", /loss leader/.test(r.error), r.error);

    await setBasis({ estimateId: losing.estimateId, acceptLoss: true });
    const deliberate = await createQuotation({ companyId: co.id, preparedBy: "E", estimateId: losing.estimateId });
    ok("  which it then can be", deliberate.ok, deliberate.ok ? "" : deliberate.error);
  }

  /* ============================ nothing reaches a customer unapproved (14) */
  {
    const early = await issueQuotation({ quotationId: made.quotationId, issuedTo: "them@example.com", by: "E" });
    ok("a draft cannot be issued to a customer", early.ok === false);
    ok("  and says to get it approved first", /Send it for approval first/.test(early.error), early.error);
  }

  {
    const sent = await submitQuotation(made.quotationId, tenant.id, "Estimator");
    ok("a quotation can be sent for approval", sent.ok, sent.ok ? "" : sent.error);

    const q = await db.quotation.findUnique({ where: { id: made.quotationId } });
    ok("  and is then with management", q.status === "Awaiting approval");
    ok("  on a real approval request", !!q.approvalRequestId);

    const request = await db.approvalRequest.findUnique({
      where: { id: q.approvalRequestId }, include: { steps: true },
    });
    ok("  raised against the configured route", request.steps.length > 0,
      `${request.steps.length} steps: ${request.steps.map((s) => s.roleName).join(", ")}`);
    ok("  carrying its value, which decides who signs", request.amount === 1200);
    ok("  under its own document type", request.docType === QUOTE_DOC_TYPE);

    const blocked = await issueQuotation({ quotationId: made.quotationId, issuedTo: "them@example.com", by: "E" });
    ok("still nothing goes out while management has it", blocked.ok === false);
    ok("  and says so", /has not signed this yet/.test(blocked.error), blocked.error);
  }

  /**
   * A rejection has to leave somewhere to go.
   */
  {
    await decide(made.quotationId, "Rejected");
    const status = await syncQuoteApproval(made.quotationId);
    ok("a rejected quotation goes back to draft", status === "Draft",
      "a Rejected state it could not be edited out of would be a dead end");

    const q = await db.quotation.findUnique({ where: { id: made.quotationId } });
    ok("  and lets go of the request it was refused on", q.approvalRequestId === null,
      "or it could never be sent again");

    const again = await submitQuotation(made.quotationId, tenant.id, "Estimator");
    ok("  so it can be sent again", again.ok, again.ok ? "" : again.error);
  }

  {
    await decide(made.quotationId, "Approved");
    const status = await syncQuoteApproval(made.quotationId);
    ok("approving in the inbox reaches the quotation", status === "Approved");

    const q = await db.quotation.findUnique({ where: { id: made.quotationId } });
    ok("  recording who signed it", q.approvedBy === "Director", String(q.approvedBy));
    ok("  and when", !!q.approvedAt);
  }

  /* ======================================================= issuing (15) == */
  {
    const nameless = await issueQuotation({ quotationId: made.quotationId, issuedTo: "  ", by: "E" });
    ok("issuing without saying where it went is refused", nameless.ok === false);
    ok("  because there must be a record of where it was sent",
      /record of where it was sent/.test(nameless.error), nameless.error);
  }

  {
    const res = await issueQuotation({
      quotationId: made.quotationId, issuedTo: "procurement@emiratessteel.ae", by: "Estimator",
    });
    ok("an approved quotation can be issued", res.ok, res.ok ? "" : res.error);

    const q = await db.quotation.findUnique({ where: { id: made.quotationId } });
    ok("  recording when, by whom and to where",
      !!q.issuedAt && q.issuedBy === "Estimator" && q.issuedTo === "procurement@emiratessteel.ae");

    const lead = await db.lead.findUnique({ where: { id: leadId }, include: { interactions: true } });
    ok("  the enquiry moves to Quoted on its own", lead.stage === "Quoted",
      "it demonstrably has been quoted; waiting for somebody to move a card is how a board goes stale");
    ok("  and the history records the sending",
      lead.interactions.some((i) => i.kind === "Quotation sent" && /issued to procurement@/.test(i.summary)));
  }

  ok("an issued quotation cannot be issued again",
    (await issueQuotation({ quotationId: made.quotationId, issuedTo: "x@y.z", by: "E" })).ok === false);

  /* ====================================================== revising (16) == */
  {
    const rev = await reviseQuotation(made.quotationId, "Estimator");
    ok("an issued quotation can be revised", rev.ok, rev.ok ? "" : rev.error);

    const old = await db.quotation.findUnique({ where: { id: made.quotationId } });
    ok("  and the old one is superseded, not deleted", old.status === "Superseded",
      "the customer still has it and the conversation will refer to it");

    const fresh = await db.quotation.findUnique({ where: { id: rev.quotationId } });
    ok("  the revision is numbered two", fresh.revision === 2, String(fresh.revision));
    ok("  and points back at what it replaced", fresh.supersedesId === made.quotationId);
    ok("  starting as a draft of its own", fresh.status === "Draft",
      "a revision has not been approved just because its predecessor was");

    // Take the revision all the way out so the order can be recorded against it.
    await submitQuotation(rev.quotationId, tenant.id, "Estimator");
    await decide(rev.quotationId, "Approved");
    await syncQuoteApproval(rev.quotationId);
    await issueQuotation({ quotationId: rev.quotationId, issuedTo: "procurement@emiratessteel.ae", by: "Estimator" });

    /* ============================== the customer's order, and the job (17) */
    {
      const mismatch = await acceptQuotation({
        quotationId: rev.quotationId, poNumber: "PO-88213", poDate: today(), poValue: 1100, by: "Sales",
      });
      ok("an order for a different figure is refused until acknowledged", mismatch.ok === false);
      ok("  saying by how much", /100\.00 less than the 1,200\.00 quoted/.test(mismatch.error), mismatch.error);
      ok("  and what turns on it",
        /created at their figure, not ours/.test(mismatch.error), mismatch.error);

      const stillOpen = await db.quotation.findUnique({ where: { id: rev.quotationId } });
      ok("  leaving the quotation alone", stillOpen.status === "Issued" && stillOpen.jobId === null,
        "a refused acceptance must not half-create a job");
    }

    {
      const res = await acceptQuotation({
        quotationId: rev.quotationId, poNumber: "PO-88213", poDate: today(),
        poValue: 1100, acknowledged: true, by: "Sales",
      });
      ok("acknowledged, the order is accepted", res.ok, res.ok ? "" : res.error);
      ok("  and a job is created", !!res.jobId);

      const job = await db.job.findUnique({ where: { id: res.jobId } });

      /**
       * The rule this whole slice turns on.
       */
      ok("the job carries what the CUSTOMER ordered", job.contractValue === 1100, String(job.contractValue));
      ok("  not what was quoted", job.contractValue !== 1200,
        "taking the quoted figure makes every margin report on this job wrong from day one");

      ok("  with a budget from the estimate", job.budgetCost === 1000, String(job.budgetCost));
      ok("  in hours as well as money", job.budgetHours === 50, String(job.budgetHours),
      );
      ok("  so job costing has something to compare against from its first day",
        job.budgetCost > 0 && job.budgetHours > 0);
      ok("  and is open", job.status === "Open" && job.type === "Contract");

      const q = await db.quotation.findUnique({ where: { id: rev.quotationId } });
      ok("the quotation records their order", q.poNumber === "PO-88213" && q.poValue === 1100);
      ok("  and that the difference was looked at", q.poAcknowledged === true);
      ok("  and is accepted", q.status === "Accepted" && q.jobId === res.jobId);

      const lead = await db.lead.findUnique({ where: { id: leadId }, include: { interactions: true } });
      ok("the enquiry is won", lead.stage === "Won" && lead.jobId === res.jobId);
      ok("  with the difference in its history",
        lead.interactions.some((i) => /-100 against the quote/.test(i.summary)),
        lead.interactions.map((i) => i.summary).join(" | "));
    }

    ok("an order cannot be recorded twice",
      (await acceptQuotation({
        quotationId: rev.quotationId, poNumber: "PO-2", poDate: today(), poValue: 1100, acknowledged: true, by: "S",
      })).ok === false);
  }

  /* ========================================================== declining == */
  {
    const { estimateId: e2 } = await pricedEstimate("Declined one");
    const q = await createQuotation({ companyId: co.id, preparedBy: "E", estimateId: e2 });
    await submitQuotation(q.quotationId, tenant.id, "E");
    await decide(q.quotationId, "Approved");
    await syncQuoteApproval(q.quotationId);
    await issueQuotation({ quotationId: q.quotationId, issuedTo: "a@b.c", by: "E" });

    const nameless = await declineQuotation({ quotationId: q.quotationId, reason: " ", by: "Sales" });
    ok("declining without a reason is refused", nameless.ok === false);
    ok("  and says what the file would look like", /nobody will be able to tell/.test(nameless.error), nameless.error);

    const res = await declineQuotation({
      quotationId: q.quotationId, reason: "Beaten on price by 9%", by: "Sales",
    });
    ok("declining with a reason is allowed", res.ok, res.ok ? "" : res.error);

    const row = await db.quotation.findUnique({ where: { id: q.quotationId } });
    ok("  the reason is kept", row.declinedReason === "Beaten on price by 9%");

    const lead = await db.lead.findUnique({ where: { id: row.leadId } });
    ok("  and the enquiry is lost with the same reason",
      lead.stage === "Lost" && lead.lostReason === "Beaten on price by 9%");
    ok("  recording how far it got", lead.closedFromStage === "Quoted", String(lead.closedFromStage));
  }

  /* ============ a send that fails does not mark the quotation issued ===== */

  /**
   * The rule that decides whether a company knows what it has sent.
   *
   * Recording a quotation as issued because a button was pressed, when the
   * mail server refused it, is how three weeks pass waiting for an answer to
   * something that never left the building.
   */
  {
    const { estimateId: e3 } = await pricedEstimate("Send failure");
    const q = await createQuotation({ companyId: co.id, preparedBy: "E", estimateId: e3 });
    await submitQuotation(q.quotationId, tenant.id, "E");
    await decide(q.quotationId, "Approved");
    await syncQuoteApproval(q.quotationId);

    // A mail server that refuses everything: a closed port.
    await db.emailSettings.deleteMany({ where: { companyId: co.id } });
    await db.emailSettings.create({
      data: {
        companyId: co.id, host: "127.0.0.1", port: 1, security: "None",
        fromEmail: "quotes@wandb.ae", isActive: true,
      },
    });

    const failed = await issueQuotation({
      quotationId: q.quotationId, issuedTo: "them@example.com", by: "Estimator", send: true,
    });
    ok("a quotation whose email is refused does not go out", failed.ok === false, failed.ok ? "" : failed.error);

    const row = await db.quotation.findUnique({ where: { id: q.quotationId } });
    ok("  and is NOT marked issued", row.status === "Approved" && row.issuedAt === null,
      "otherwise the company waits three weeks for an answer to something that never left the building");

    const logged = await db.emailLog.count({ where: { entity: "quotation", entityId: q.quotationId } });
    ok("  though the attempt is recorded", logged === 1,
      "so somebody can see it was tried and why it failed");

    // Recording a send made by hand still works with no mail server at all.
    await db.emailSettings.deleteMany({ where: { companyId: co.id } });
    const byHand = await issueQuotation({
      quotationId: q.quotationId, issuedTo: "them@example.com", by: "Estimator",
    });
    ok("recording a send made by hand still works", byHand.ok, byHand.ok ? "" : byHand.error,
    );
    const after = await db.quotation.findUnique({ where: { id: q.quotationId } });
    ok("  and marks it issued", after.status === "Issued" && !!after.issuedAt,
      "a client with no mail server still issues quotations");
  }

  /* ====================================================== posts nothing == */
  {
    const vouchers = await db.journalEntry.count({ where: { companyId: co.id, memo: { contains: TAG } } });
    ok("a quotation posts nothing to the ledger", vouchers === 0,
      "the link to the accounts is a job, which is master data");
  }
} finally {
  const quotes = await db.quotation.findMany({
    where: { companyId: co.id, title: { contains: TAG } }, select: { id: true, jobId: true },
  });
  await db.quotation.updateMany({ where: { id: { in: quotes.map((q) => q.id) } }, data: { supersedesId: null } });
  await db.quotation.deleteMany({ where: { id: { in: quotes.map((q) => q.id) } } });
  await db.job.deleteMany({ where: { id: { in: quotes.map((q) => q.jobId).filter(Boolean) } } });
  await db.estimate.deleteMany({ where: { companyId: co.id, title: { startsWith: TAG } } });
  await db.lead.deleteMany({ where: { companyId: co.id, title: { startsWith: TAG } } });
  await db.approvalRequest.deleteMany({ where: { companyId: co.id, docType: QUOTE_DOC_TYPE, title: { contains: "WBE/QTN" } } });
  await db.emailLog.deleteMany({ where: { companyId: co.id, entity: "quotation" } });
  await db.emailSettings.deleteMany({ where: { companyId: co.id } });
}

/* ==================================================== how it is wired == */

const src = prose("src/lib/quote-posting.ts");
ok("the file says why the total IS stored here, unlike the estimate",
  /it must not change under them because somebody carried on editing the estimate/.test(src));
ok("and says why a refused send must not mark it issued",
  /waits three weeks for an answer to something that never left the building/.test(src));
ok("and why the job takes the customer's figure",
  /What they committed to, not what was quoted/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
