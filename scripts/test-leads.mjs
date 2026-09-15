/**
 * Enquiries and the pipeline (CRM-01, CRM-02, CRM-11, CRM-12).
 *
 * The number this module exists to keep honest is the pipeline, and the three
 * ways it becomes fiction are all tested here:
 *   - won and lost deals left in the forecast, so it only ever goes up;
 *   - a probability somebody types, so every deal is ninety per cent;
 *   - a qualification score somebody sets, so it measures who the salesman
 *     likes rather than what anybody knows.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { leads: lib } = await importLibs(["leads"]);
const {
  LEAD_STAGES, STAGE_PROBABILITY, STAGE_HELP, CLOSED_STAGES, LEAD_SOURCES,
  qualify, siteReportSubmitted, stageProbability, isOpen, weightedValue,
  summarisePipeline, checkStageChange, pipelineVerdict, leadVerdict,
} = lib;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const lead = (extra = {}) => ({ stage: "Qualifying", estimatedValue: 100000, ...extra });
/** Every qualification question answered. */
const known = (extra = {}) => lead({
  budgetStated: 90000, decisionMaker: "Mr Khan", requiredBy: "2026-06-01",
  siteReportOn: "2026-03-01", scopeDefined: true, ...extra,
});

/* ================================================== what the words mean == */

ok("every stage is explained in plain English",
  LEAD_STAGES.every((s) => (STAGE_HELP[s] || "").length > 25), LEAD_STAGES.join(", "));
ok("every stage carries a probability",
  LEAD_STAGES.every((s) => typeof STAGE_PROBABILITY[s] === "number"));
ok("there are sources an enquiry can come from", LEAD_SOURCES.length >= 4);

ok("a won deal is certain", stageProbability("Won") === 1);
ok("a lost deal is worth nothing", stageProbability("Lost") === 0);
ok("probability rises through the stages",
  stageProbability("New") < stageProbability("Quoted")
    && stageProbability("Quoted") < stageProbability("Negotiating"));
ok("  with the big jump at negotiating",
  stageProbability("Negotiating") - stageProbability("Quoted") > 0.2,
  "a customer arguing about price has decided they want the work done");
ok("an unknown stage is worth nothing rather than NaN", stageProbability("Nonsense") === 0);

/* ======================================================= qualification == */

{
  const q = qualify(known());
  ok("a fully worked lead answers all five", q.answered === 5 && q.of === 5);
  ok("  and scores accordingly", q.score === 1, String(q.score));
  ok("  with nothing missing", q.missing.length === 0);
}

{
  const q = qualify(lead());
  ok("a bare lead answers none of them", q.answered === 0, String(q.answered));
  ok("  and says which, in words somebody can act on",
    q.missing.length === 5 && /no budget has been stated/.test(q.missing.join("; ")),
    q.missing.join("; "));
}

ok("a budget of nil is not a stated budget", qualify(known({ budgetStated: 0 })).answered === 4);
ok("a blank decision-maker is not a decision-maker",
  qualify(known({ decisionMaker: "   " })).answered === 4,
  "whitespace is what an empty form field actually contains");
ok("scope not explicitly defined counts against it",
  qualify(known({ scopeDefined: false })).answered === 4);
ok("  and neither does leaving it unanswered", qualify(known({ scopeDefined: null })).answered === 4);

/**
 * The half that would otherwise be a flag somebody ticks.
 */
ok("the site report status comes from a report existing", siteReportSubmitted(known()) === true);
ok("  and is false when none has been received", siteReportSubmitted(lead()) === false,
  "a status somebody sets by hand is a status that is wrong the day after a visit slips");
ok("  which is the same fact qualification counts", qualify(lead({ siteReportOn: "2026-01-01" })).answered === 1);

/* ========================================================== the weight == */

ok("an open deal is worth its value times its stage",
  weightedValue(lead({ stage: "Quoted", estimatedValue: 100000 })) === 40000,
  String(weightedValue(lead({ stage: "Quoted", estimatedValue: 100000 }))));

ok("a won deal is worth nothing TO THE PIPELINE",
  weightedValue(lead({ stage: "Won", estimatedValue: 100000 })) === 0,
  "it is revenue now, and belongs on a job");
ok("a lost deal likewise", weightedValue(lead({ stage: "Lost", estimatedValue: 100000 })) === 0);

ok("an open lead is open", isOpen(lead()) === true);
ok("a won one is not", isOpen(lead({ stage: "Won" })) === false);
ok("nor a lost one", isOpen(lead({ stage: "Lost" })) === false);
ok("both are closed stages", CLOSED_STAGES.has("Won") && CLOSED_STAGES.has("Lost"));

ok("a deal with no value weighs nothing", weightedValue(lead({ estimatedValue: null })) === 0);

/* ======================================================== the pipeline == */

{
  const p = summarisePipeline([
    lead({ stage: "Quoted", estimatedValue: 100000 }),
    lead({ stage: "Negotiating", estimatedValue: 200000 }),
    lead({ stage: "Won", estimatedValue: 500000 }),
    lead({ stage: "Lost", estimatedValue: 900000 }),
  ]);
  ok("only open deals are pipeline", p.open === 2, String(p.open));
  ok("  totalled gross", p.gross === 300000, String(p.gross));
  ok("  and weighted by stage", p.weighted === 180000, `40000 + 140000, got ${p.weighted}`);

  /**
   * The failure this whole module exists to prevent.
   */
  ok("  with the won deal excluded", p.weighted < 500000 && p.gross === 300000,
    "a forecast that keeps won deals only ever goes up");
  ok("  and the lost one too", p.gross < 900000);

  ok("won and lost are counted separately", p.won === 1 && p.lost === 1);
  ok("  with their values", p.wonValue === 500000 && p.lostValue === 900000);
  ok("  and a win rate over what was decided", p.winRate === 0.5, String(p.winRate));
}

{
  const p = summarisePipeline([
    lead({ stage: "Quoted", estimatedValue: 100000 }),
    lead({ stage: "Quoted", estimatedValue: 50000 }),
    lead({ stage: "New", estimatedValue: 10000 }),
  ]);
  ok("deals are grouped by stage", p.byStage["Quoted"].count === 2);
  ok("  with each stage's gross", p.byStage["Quoted"].gross === 150000);
  ok("  and each stage's weighted value", p.byStage["Quoted"].weighted === 60000, String(p.byStage["Quoted"].weighted));
}

ok("an empty pipeline is worth nothing, not NaN",
  summarisePipeline([]).weighted === 0 && summarisePipeline([]).winRate === 0);
ok("  and a pipeline with nothing decided has no win rate",
  summarisePipeline([lead()]).winRate === 0);

/* ========================================================= moving on === */

ok("a lead can move forward", checkStageChange(lead({ stage: "New" }), "Qualifying").ok === true);
ok("a lead can move backward", checkStageChange(lead({ stage: "Quoted" }), "Estimating").ok === true,
  "an estimate sent back for repricing is ordinary");

ok("moving to the stage it is already at is refused",
  checkStageChange(lead({ stage: "Quoted" }), "Quoted").ok === false);
ok("a stage that does not exist is refused",
  checkStageChange(lead(), "Nearly there").ok === false);

{
  const r = checkStageChange(lead({ stage: "Won" }), "Negotiating");
  ok("a won lead cannot be reopened", r.ok === false);
  ok("  and says to raise a new enquiry", /Raise a new enquiry/.test(r.error), r.error);
}
ok("a lost lead cannot be reopened either",
  checkStageChange(lead({ stage: "Lost" }), "Quoted").ok === false);

/**
 * The reason that only exists if it is captured now.
 */
{
  const r = checkStageChange(lead({ stage: "Quoted" }), "Lost");
  ok("losing without a reason is refused", r.ok === false);
  ok("  and says what the file will look like otherwise",
    /the file will say Lost and nobody/.test(r.error), r.error);
}
ok("losing WITH a reason is allowed",
  checkStageChange(lead({ stage: "Quoted" }), "Lost", { lostReason: "Beaten on price by 8%" }).ok === true);
ok("  but whitespace is not a reason",
  checkStageChange(lead({ stage: "Quoted" }), "Lost", { lostReason: "  " }).ok === false);
ok("winning needs no reason", checkStageChange(lead({ stage: "Negotiating" }), "Won").ok === true,
  "nobody ever wanted to know why a job was won");

/* ======================================================== the sentences == */

ok("no enquiries at all says so", /No enquiries yet/.test(pipelineVerdict([])));

{
  const v = pipelineVerdict([
    lead({ stage: "Quoted", estimatedValue: 100000 }),
    lead({ stage: "Negotiating", estimatedValue: 200000 }),
  ]);
  ok("the sentence leads with the weighted figure", /worth 180,000 weighted against 300,000 gross/.test(v), v);
}

{
  const few = [lead({ stage: "Quoted" }), lead({ stage: "Won" }), lead({ stage: "Lost" })];
  const v = pipelineVerdict(few);
  ok("a win rate over two decided deals is not quoted", !/% of the/.test(v), v);
  ok("  and says why", /too few to call a win rate/.test(v), v);
}

{
  const many = [
    lead({ stage: "Quoted" }),
    ...Array.from({ length: 3 }, () => lead({ stage: "Won" })),
    ...Array.from({ length: 2 }, () => lead({ stage: "Lost" })),
  ];
  ok("a win rate over five decided deals is", /60% of the 5 decided/.test(pipelineVerdict(many)),
    pipelineVerdict(many));
}

ok("a fully worked lead says what it is worth",
  /Everything is known about this one/.test(leadVerdict(known({ stage: "Quoted" }))),
  leadVerdict(known({ stage: "Quoted" })));
ok("a bare lead says what is missing",
  /0 of 5 questions answered/.test(leadVerdict(lead())), leadVerdict(lead()));
ok("a won lead says it should be a job", /should be a job now/.test(leadVerdict(lead({ stage: "Won" }))));

/* ============================== boundaries, found by mutation testing == */

{
  const v = pipelineVerdict([lead({ stage: "Quoted", estimatedValue: 100000 })]);
  ok("a pipeline with nothing decided says nothing about a win rate", !/decided so far/.test(v), v);
  ok("  nor quotes one", !/win rate/.test(v), v);
}

{
  const one = pipelineVerdict([lead({ stage: "Quoted" }), lead({ stage: "Won" })]);
  ok("one decided enquiry reads as one, not 1 enquiries", /Only 1 enquiry decided/.test(one), one);
}

{
  const v = pipelineVerdict([lead({ stage: "Quoted" })]);
  ok("one open enquiry reads as one", /^1 enquiry open/.test(v), v);
}

{
  const v = pipelineVerdict([lead({ stage: "Quoted" }), lead({ stage: "New" })]);
  ok("two open enquiries read as two", /^2 enquiries open/.test(v), v);
}

/* ==================================================== how it is written = */

const src = prose("src/lib/leads.ts");
ok("the file says why won and lost leave the pipeline",
  /it only ever goes up/.test(src));
ok("and why probability belongs to the stage",
  /every deal is ninety per cent/.test(src));
ok("and what a low qualification score actually means",
  /a lead nobody has done the work on yet/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
