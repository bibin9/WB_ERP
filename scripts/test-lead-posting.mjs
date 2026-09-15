/**
 * Enquiries against a real database (CRM-01, CRM-11, CRM-12).
 *
 * The rules are tested on their own in test-leads.mjs. What matters here is
 * that the seam applies them, that the history is written whichever way a
 * lead moves, and above all that "Site Report Submitted" is derived from a
 * report existing rather than from anybody saying it does.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["lead-posting", "leads", "db"]);
const { db } = libs["db"];
const {
  createLead, moveStage, logInteraction, recordVisit, submitReport, openLeads, toLeadLike,
  INTERACTION_KINDS,
} = libs["lead-posting"];
const { qualify, siteReportSubmitted, summarisePipeline } = libs["leads"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");
const today = () => new Date().toISOString().slice(0, 10);

const co = await db.company.findFirst({ where: { code: "WBE" } });
const TAG = "LEAD-TEST";

const full = (id) => db.lead.findUnique({ where: { id }, include: { visits: true, interactions: true } });

try {
  /* ============================================================ raising == */
  const raised = await createLead({
    companyId: co.id, raisedBy: "salesman", title: `${TAG} Substation fit-out`,
    customerName: "Emirates Steel", estimatedValue: 400000, source: "Referral",
  });
  ok("an enquiry can be logged", raised.ok, raised.ok ? "" : raised.error);
  ok("  numbered in its own series", /^WBE\/ENQ\/\d{2}\/\d{4}$/.test(raised.number || ""), raised.number);

  {
    const l = await full(raised.leadId);
    ok("  starting as new", l.stage === "New");
    ok("  with the customer's name even though they are not a party", l.customerName === "Emirates Steel" && l.partyId === null,
      "forcing a name onto the customer master before the work is real fills it with nothing");
    ok("  and a history from the first moment", l.interactions.length === 1,
      "a pipeline says where things are; only the history says why");
  }

  ok("an enquiry with no title is refused",
    (await createLead({ companyId: co.id, raisedBy: "s", title: "  ", customerName: "X" })).ok === false);
  ok("an enquiry from nobody is refused",
    (await createLead({ companyId: co.id, raisedBy: "s", title: `${TAG} x`, customerName: "" })).ok === false);
  ok("a negative value is refused",
    (await createLead({ companyId: co.id, raisedBy: "s", title: `${TAG} y`, customerName: "X", estimatedValue: -1 })).ok === false);

  /* ======================================================= qualification == */
  {
    const l = await full(raised.leadId);
    const q = qualify(toLeadLike(l));
    ok("a fresh enquiry has answered nothing", q.answered === 0, String(q.answered));
    ok("  and says nobody has been to site", /nobody has been to site/.test(q.missing.join("; ")));
  }

  /* ========================================================= site visits == */
  let visitId;
  {
    const res = await recordVisit({
      leadId: raised.leadId, visitedOn: today(), visitedBy: "Ahmed", by: "salesman",
    });
    ok("a visit can be recorded before the report exists", res.ok, res.ok ? "" : res.error);
    visitId = res.visitId;

    const l = await full(raised.leadId);
    ok("  and the report is NOT counted as submitted", siteReportSubmitted(toLeadLike(l)) === false,
      "booking Tuesday's visit on Monday must not claim a report exists");
    ok("  which qualification agrees with", qualify(toLeadLike(l)).answered === 0);
    ok("  though the history records that somebody is going",
      l.interactions.some((i) => /report still to come/.test(i.summary)));
  }

  {
    const empty = await submitReport({ visitId, findings: "   ", by: "Ahmed" });
    ok("a report with nothing in it is refused", empty.ok === false);
    ok("  and says what the report is for",
      /what the estimate gets built on/.test(empty.error || ""), empty.error);

    const l = await full(raised.leadId);
    ok("  leaving the status alone", siteReportSubmitted(toLeadLike(l)) === false,
      "an empty report would mark the enquiry as reported when nothing was");
  }

  {
    const res = await submitReport({
      visitId, findings: "Three transformer bays, access from the north gate only.", by: "Ahmed",
    });
    ok("a real report can be filed", res.ok, res.ok ? "" : res.error);

    const l = await full(raised.leadId);
    ok("  and the status follows from it existing", siteReportSubmitted(toLeadLike(l)) === true,
      "derived, never a box anybody ticks");
    ok("  which qualification counts", qualify(toLeadLike(l)).answered === 1);
    ok("  and the history records the filing",
      l.interactions.some((i) => /Site report filed/.test(i.summary)));
  }

  /* ============================================================ history == */
  {
    const res = await logInteraction({
      leadId: raised.leadId, kind: "Call", summary: "Chased the drawings", by: "salesman",
    });
    ok("a call can be logged", res.ok, res.ok ? "" : res.error);

    const blank = await logInteraction({ leadId: raised.leadId, kind: "Call", summary: "  ", by: "s" });
    ok("an entry with no words is refused", blank.ok === false);
    ok("  and says why", /not a history/.test(blank.error || ""), blank.error);

    const odd = await logInteraction({ leadId: raised.leadId, kind: "Telepathy", summary: "x", by: "s" });
    ok("a kind of contact nobody recognises is refused", odd.ok === false);
    ok("  from a fixed list", INTERACTION_KINDS.includes("Call") && INTERACTION_KINDS.includes("Email"));
  }

  /* ============================================================= moving == */
  {
    const res = await moveStage({ leadId: raised.leadId, to: "Qualifying", by: "salesman" });
    ok("an enquiry can move stage", res.ok, res.ok ? "" : res.error);

    const l = await full(raised.leadId);
    ok("  and the move is in the history", l.interactions.some((i) => /Moved from New to Qualifying/.test(i.summary)),
      "a stage on its own says where it is, not why it got there");
  }

  {
    const same = await moveStage({ leadId: raised.leadId, to: "Qualifying", by: "s" });
    ok("moving to the stage it is already at is refused", same.ok === false, same.error);
  }

  /**
   * The reason that only exists if it is captured now.
   */
  {
    const nameless = await moveStage({ leadId: raised.leadId, to: "Lost", by: "salesman" });
    ok("losing without a reason is refused", nameless.ok === false);
    ok("  and says what the file would look like",
      /nobody will be able to tell/.test(nameless.error || ""), nameless.error);

    const l = await full(raised.leadId);
    ok("  leaving the stage where it was", l.stage === "Qualifying",
      "a refused move must not half-close the enquiry");
  }

  /* ===================================================== losing and won == */
  const lost = await createLead({
    companyId: co.id, raisedBy: "salesman", title: `${TAG} Lost one`,
    customerName: "Someone Else", estimatedValue: 250000,
  });
  {
    const res = await moveStage({
      leadId: lost.leadId, to: "Lost", by: "manager",
      lostReason: "Beaten on price by 8%", lostTo: "Gulf Contracting",
    });
    ok("losing with a reason is allowed", res.ok, res.ok ? "" : res.error);

    const l = await full(lost.leadId);
    ok("  the reason is kept", l.lostReason === "Beaten on price by 8%");
    ok("  and who won it", l.lostTo === "Gulf Contracting");
    ok("  with the moment recorded", !!l.closedAt && l.closedBy === "manager");
    ok("  and both in the history",
      l.interactions.some((i) => /Lost to Gulf Contracting — Beaten on price by 8%/.test(i.summary)),
      l.interactions.map((i) => i.summary).join(" | "));
  }

  {
    const reopen = await moveStage({ leadId: lost.leadId, to: "Quoted", by: "salesman" });
    ok("a lost enquiry cannot be reopened", reopen.ok === false);
    ok("  and says to raise a new one", /Raise a new enquiry/.test(reopen.error || ""), reopen.error);
  }

  const won = await createLead({
    companyId: co.id, raisedBy: "salesman", title: `${TAG} Won one`,
    customerName: "Emirates Steel", estimatedValue: 600000,
  });
  ok("winning needs no reason",
    (await moveStage({ leadId: won.leadId, to: "Won", by: "manager" })).ok === true);

  /* =========================================================== pipeline == */
  {
    const open = await openLeads(co.id);
    const ours = open.filter((l) => l.title.startsWith(TAG));
    ok("won and lost enquiries are not open", ours.length === 1, `${ours.length} open of 3 raised`);
    ok("  it is the one still running", ours[0].id === raised.leadId);

    const all = await db.lead.findMany({
      where: { companyId: co.id, title: { startsWith: TAG } },
      include: { visits: { select: { reportOn: true } } },
    });
    const p = summarisePipeline(all.map(toLeadLike));
    ok("the forecast counts only the open one", p.open === 1 && p.gross === 400000, `${p.open} / ${p.gross}`);
    ok("  weighted by its stage", p.weighted === 40000, `Qualifying is 10% of 400000, got ${p.weighted}`);

    /**
     * The failure the module exists to prevent.
     */
    ok("  with the won 600,000 left out of the forecast", p.gross < 600000,
      "a forecast that keeps won deals only ever goes up");
    ok("  and counted as won instead", p.won === 1 && p.wonValue === 600000);
    ok("  and the lost one likewise", p.lost === 1 && p.lostValue === 250000);
  }

  /* ====================================================== posts nothing == */
  {
    const vouchers = await db.journalEntry.count({
      where: { companyId: co.id, memo: { contains: TAG } },
    });
    ok("an enquiry posts nothing to the ledger", vouchers === 0,
      "nothing is owed and nothing is owned because somebody rang up");
  }
} finally {
  await db.lead.deleteMany({ where: { companyId: co.id, title: { startsWith: TAG } } });
}

/* ==================================================== how it is wired == */

const src = prose("src/lib/lead-posting.ts");
ok("the file says why it posts nothing",
  /nothing is owed and nothing is owned because somebody rang up/.test(src));
ok("and why the site report status is derived",
  /stay saying it if the report never arrived/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
