/**
 * Work in progress and contract status.
 *
 * The report exists to say two things a profit and loss cannot: how far through
 * each contract is, and whether the billing has run ahead of or behind the work.
 * Both depend on completeness, so the rules that decide completeness carry the
 * whole report, and each one below is a way the figure could be quietly wrong.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["wip", "tree", "db"]);
const {
  percentComplete, contractState, summariseWip, wipVerdict, rankContracts, FINISHED_STATUSES,
} = libs["wip"];
const { arrange, withDescendants } = libs["tree"];
const { db } = libs["db"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/** A contract, with everything defaulted to the ordinary case. */
const job = (o = {}) => ({
  id: o.id ?? "j1",
  code: o.code ?? "J-2601",
  name: o.name ?? "Test contract",
  status: o.status ?? "Open",
  contractValue: o.contractValue ?? 1_000_000,
  budgetCost: o.budgetCost ?? 800_000,
  costToDate: o.costToDate ?? 0,
  billedToDate: o.billedToDate ?? 0,
});

/* ==================================================== how far through ==== */

ok("nothing spent is nothing complete", percentComplete(job({ costToDate: 0 })) === 0);
ok("half the budget spent is half complete", percentComplete(job({ costToDate: 400_000 })) === 0.5);
ok("the whole budget spent is complete", percentComplete(job({ costToDate: 800_000 })) === 1);

/**
 * The two ways this figure goes wrong.
 *
 * A contract with no budget is not nought per cent complete — it is unmeasured.
 * Reporting nought would put a live job at the top of every barely-started list
 * and drag the totals underneath it with it.
 */
ok("a contract with no budget cannot be measured",
  percentComplete(job({ budgetCost: 0, costToDate: 250_000 })) === null,
  "unmeasured, not nought per cent");

ok("and overspending does not make it more than finished",
  percentComplete(job({ costToDate: 1_200_000 })) === 1,
  "the overspend belongs in the margin, which is where it is reported");

/**
 * A finished job delivered under budget would otherwise read as unfinished for
 * the rest of its life.
 */
for (const status of ["Completed", "Closed"]) {
  ok(`a ${status.toLowerCase()} contract is complete however the costs landed`,
    percentComplete(job({ status, costToDate: 500_000 })) === 1);
  ok(`  and ${status.toLowerCase()} needs no budget to say so`,
    percentComplete(job({ status, budgetCost: 0, costToDate: 0 })) === 1);
}
ok("the finished statuses are named once", FINISHED_STATUSES.has("Completed") && FINISHED_STATUSES.has("Closed"));

/* ============================================ billed against earned ====== */

{
  // Half spent, so half of the million is earned. Six hundred thousand invoiced.
  const s = contractState(job({ costToDate: 400_000, billedToDate: 600_000 }));
  ok("earned follows completeness", s.revenueEarned === 500_000);
  ok("billing ahead of the work is over-billing", s.overBilled === 100_000);
  ok("  and nothing is shown as under-billed", s.underBilled === 0);
  ok("  named for somebody who is not an accountant", s.position === "Over-billed");
}

{
  const s = contractState(job({ costToDate: 400_000, billedToDate: 350_000 }));
  ok("billing behind the work is under-billing", s.underBilled === 150_000);
  ok("  which is earned money nobody has asked for", s.position === "Under-billed");
}

{
  const s = contractState(job({ costToDate: 400_000, billedToDate: 500_000 }));
  ok("billing exactly in line says so", s.position === "In line" && s.overBilled === 0 && s.underBilled === 0);
}

{
  const s = contractState(job({ budgetCost: 0, costToDate: 400_000, billedToDate: 900_000 }));
  ok("with no budget, nothing is claimed either way", s.position === "Not measurable");
  ok("  earned is null rather than nought", s.revenueEarned === null,
    "a missing budget must never look like a contract exactly on plan");
  ok("  and no over-billing is invented", s.overBilled === 0 && s.underBilled === 0);
}

/* ================================================ contracts that lose ==== */

/**
 * When the expected cost passes the contract value the whole loss is taken
 * now, not spread over the months left. A loss recognised in month three is
 * still a decision; one deferred to month eleven is an explanation.
 */
{
  const s = contractState(job({ contractValue: 1_000_000, budgetCost: 1_150_000, costToDate: 300_000 }));
  ok("a contract budgeted to lose money is flagged", s.onerous === true);
  ok("  and the whole loss is stated, not the part incurred so far",
    s.expectedLoss === 150_000, "150,000 now, not 45,000 pro-rata");
  ok("  the forecast margin is negative", s.forecastMargin === -150_000);
}

{
  // Budgeted to make money, but already spent more than the whole contract.
  const s = contractState(job({ contractValue: 1_000_000, budgetCost: 800_000, costToDate: 1_100_000 }));
  ok("a budget already exceeded stops being the estimate", s.forecastMargin === -100_000,
    "expected cost is what has been spent, once that is more than the budget");
  ok("  so the contract is onerous even though its budget was not", s.onerous === true);
  ok("  and the overspend is called out separately", s.overspent === true);
}

ok("a healthy contract is not flagged", contractState(job({ costToDate: 100_000 })).onerous === false);
ok("  and shows its forecast margin", contractState(job()).forecastMargin === 200_000);
ok("  as a share of the contract", Math.round(contractState(job()).forecastMarginShare * 100) === 20);

/* -------------------------------------------------------- cost to go ---- */
ok("what is left in the budget", contractState(job({ costToDate: 300_000 })).costToComplete === 500_000);
ok("never negative when overspent", contractState(job({ costToDate: 900_000 })).costToComplete === 0);
ok("and null with no budget", contractState(job({ budgetCost: 0 })).costToComplete === null);

/* ======================================================== the totals ===== */

const portfolio = [
  job({ id: "a", code: "J-01", costToDate: 400_000, billedToDate: 600_000 }),            // over 100k
  job({ id: "b", code: "J-02", costToDate: 400_000, billedToDate: 350_000 }),            // under 150k
  job({ id: "c", code: "J-03", budgetCost: 0, costToDate: 90_000, billedToDate: 90_000 }), // unmeasurable
  job({ id: "d", code: "J-04", contractValue: 500_000, budgetCost: 600_000, costToDate: 100_000 }), // onerous
];
const t = summariseWip(portfolio);

ok("every contract is counted", t.contracts === 4);
ok("and the unmeasurable ones are named", t.unbudgeted === 1);
ok("  without being counted as measured", t.measurable === 3);

/**
 * Netting these would say two contracts a million out in opposite directions
 * are the same business as two sitting exactly on plan.
 */
ok("assets and liabilities are kept apart",
  t.contractAssets === 233_333.33 && t.contractLiabilities === 100_000,
  `${t.contractAssets} due from customers and ${t.contractLiabilities} due to them, never netted`);
ok("losses are totalled for provisioning", t.onerousCount === 1 && t.expectedLosses === 100_000);
ok("an unmeasurable contract adds nothing to earned", t.revenueEarned === 500_000 + 500_000 + 83_333.33,
  String(t.revenueEarned));
ok("but its value and cost still count", t.contractValue === 3_500_000 && t.costToDate === 990_000,
  `${t.contractValue} / ${t.costToDate}`);

/* ======================================================= the sentence ==== */

ok("an empty report says what to do", /Add a job with a contract value/.test(wipVerdict([])));
ok("a loss outranks everything else",
  /expected to finish at a loss/.test(wipVerdict(portfolio)), wipVerdict(portfolio));
ok("  and says the loss belongs in this period",
  /not spread over the months left/.test(wipVerdict(portfolio)));

const noLoss = portfolio.filter((c) => c.id !== "d");
ok("otherwise both directions are named",
  /ahead of the work on some contracts, and .* behind it on others/.test(wipVerdict(noLoss)), wipVerdict(noLoss));

ok("over-billing alone is not called profit",
  /not profit/.test(wipVerdict([portfolio[0]])), wipVerdict([portfolio[0]]));
ok("under-billing alone says nobody has asked",
  /nobody has asked the client/.test(wipVerdict([portfolio[1]])), wipVerdict([portfolio[1]]));
ok("no budget anywhere says to set one",
  /cannot be measured/.test(wipVerdict([portfolio[2]])), wipVerdict([portfolio[2]]));
ok("in line says so plainly",
  /in line with the work done/.test(wipVerdict([job({ costToDate: 400_000, billedToDate: 500_000 })])));

/* ========================================================== ordering ===== */

const ranked = rankContracts(portfolio);
ok("the loss-making contract leads", ranked[0].id === "d");
ok("then the largest gap between billed and earned", ranked[1].id === "b", ranked[1].code);
ok("and the unmeasurable one sinks without being dropped",
  ranked[3].id === "c" && ranked.length === 4);

/* ============================== the roll-up, on the real job tree ======== */

/**
 * A main contract with packages beneath it. Nothing is posted to the parent, so
 * its figures have to be the sum of what sits under it — the same roll-up the
 * costing screen uses, checked here against the shape the report needs.
 */
{
  const rows = [
    { id: "p", parentId: null },
    { id: "c1", parentId: "p" },
    { id: "c2", parentId: "p" },
  ];
  const cost = new Map([["p", 0], ["c1", 120_000], ["c2", 80_000]]);
  const parent = arrange(rows).find((r) => r.node.id === "p");
  ok("a parent totals its children", withDescendants(parent, cost) === 200_000,
    "a main contract shows a true total with nothing posted against it");

  const s = contractState(job({ contractValue: 500_000, budgetCost: 250_000, costToDate: 200_000, billedToDate: 300_000 }));
  ok("  and the rolled-up figures drive the same state",
    s.percentComplete === 0.8 && s.underBilled === 100_000,
    `${Math.round(s.percentComplete * 100)}% complete, ${s.underBilled} earned and unbilled`);
}

/* ------------------------------------ against real data, so it loads ---- */
{
  const co = await db.company.findFirst({ where: { code: "WBE" } });
  const jobs = await db.job.findMany({
    where: { companyId: co.id },
    select: { id: true, code: true, name: true, status: true, contractValue: true, budgetCost: true },
  });
  ok("the seeded company has contracts to report on", jobs.length > 0, `${jobs.length} jobs`);

  const states = jobs.map((j) => contractState({ ...j, costToDate: 0, billedToDate: 0 }));
  ok("every one produces a state without throwing", states.length === jobs.length);
  ok("and none reports a number where it cannot measure",
    states.every((s) => (s.percentComplete === null) === (s.revenueEarned === null)));
}

/* ==================================================== how it is wired ==== */

ok("the screen is registered", /key: "finance\.wip"/.test(read("src/lib/rbac.ts")));
ok("it sits with job costing", /href: "\/finance\/wip"/.test(read("src/lib/moduletabs.ts")));
ok("and has a card in the report centre", /key: "wip"/.test(read("src/lib/reports.ts")));

const page = read("src/app/(app)/finance/wip/page.tsx");
ok("the screen renders its tab strip", /<FinanceTabs/.test(page), "otherwise it is a dead end");
ok("it reads costs life to date, not for a period", !/resolvePeriod/.test(page),
  "a contract question is cumulative; a period would restart it every January");
ok("it rolls sub-jobs into their parent", /withDescendants/.test(page));

const helpSrc = read("src/lib/help.ts");
for (const id of ["wip", "wip-overbilling", "wip-losses"]) {
  ok(`there is plain-English help: ${id}`, new RegExp(`id: "${id}"`).test(helpSrc));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
