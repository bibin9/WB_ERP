/**
 * The second costing dimension, and the job tree.
 *
 * The decision this proves out: a Job and a Project are one record, so a job
 * carries a type and a parent rather than there being two tables to keep in
 * step. That only holds if two things are true — the roll-up is correct and
 * cannot hang, and there is somewhere to put cost that no customer job pays
 * for. Without the second, "not tagged yet" and "genuine overhead" are the same
 * empty field and every job margin is suspect.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
const read = (p) => fs.readFileSync(p, "utf8");

// posting.ts carries `import "server-only"`, which Node cannot resolve outside
// Next's bundler. Same shim the posting test uses.
const SHIM = "src/lib/.posting.cc.ts";
fs.writeFileSync(
  SHIM,
  read("src/lib/posting.ts")
    .replace(/^import "server-only";.*$/m, "")
    .replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let postVoucher;
try {
  ({ postVoucher } = await import("../src/lib/.posting.cc.ts"));
} finally {
  fs.unlinkSync(SHIM);
}
const { arrange, withDescendants } = await import("../src/lib/tree.ts");
const { chargeValue, chargeFrom } = await import("../src/lib/costing.ts");

const db = new PrismaClient();
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`);
  }
};

const company = await db.company.findFirst({ where: { code: "WBE" } });
const other = await db.company.findFirst({ where: { code: { not: "WBE" } } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const cash = accounts.find((a) => a.code === "1000");
const expense = accounts.find((a) => a.type === "Expense");

const TAG = "TEST-CC";
const cleanup = async () => {
  const ids = (
    await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } })
  ).map((m) => m.id);
  if (ids.length) await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  await db.costCentre.deleteMany({ where: { code: { startsWith: "ZZ-" } } });
  await db.job.deleteMany({ where: { code: { startsWith: "ZZJ-" } } });
};
await cleanup();

/* ------------------------------------------------- the tree helper itself -- */
// Pure, so it can be checked against a shape the database need not contain.
{
  const rows = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
  ];
  const out = arrange(rows);
  ok("every row survives being arranged", out.length === 4, `${out.length} of 4`);
  ok(
    "a parent comes before its children",
    out.map((r) => r.node.id).join("") === "abcd",
    out.map((r) => r.node.id).join("")
  );
  ok("depth counts the generations", out[2].depth === 2, `c is at depth ${out[2].depth}`);
  ok(
    "descendants reach all the way down",
    out[0].descendants.sort().join(",") === "b,c",
    out[0].descendants.join(",")
  );
  ok("a leaf has no descendants", out[3].descendants.length === 0 && !out[3].hasChildren);

  const measure = new Map([
    ["a", 10],
    ["b", 20],
    ["c", 5],
    ["d", 100],
  ]);
  ok("a total includes the row and everything under it", withDescendants(out[0], measure) === 35);
  ok("a leaf totals only itself", withDescendants(out[3], measure) === 100);

  // The report must degrade, never hang.
  const cyclic = [
    { id: "x", parentId: "y" },
    { id: "y", parentId: "x" },
    { id: "z", parentId: null },
  ];
  const survived = arrange(cyclic);
  ok("a cycle in the data does not hang the report", survived.length === 3, `${survived.length} rows`);

  const orphan = arrange([{ id: "o", parentId: "gone" }]);
  ok("a row whose parent is missing is shown, not lost", orphan.length === 1 && orphan[0].depth === 0);
}

/* ------------------------------------------------------- posting to one ---- */
const centre = await db.costCentre.create({
  data: { companyId: company.id, code: "ZZ-01", name: "Test workshop" },
});
const child = await db.costCentre.create({
  data: { companyId: company.id, code: "ZZ-02", name: "Test crane", parentId: centre.id },
});
const foreign = await db.costCentre.create({
  data: { companyId: other.id, code: "ZZ-09", name: "Other company centre" },
});

const overhead = await postVoucher({
  companyId: company.id,
  postedBy: "test",
  voucherType: "Purchase",
  date: "2026-08-14",
  memo: `${TAG} overhead`,
  lines: [
    { accountId: expense.id, debit: 900, credit: 0, costCentreId: child.id },
    { accountId: cash.id, debit: 0, credit: 900 },
  ],
});
ok("a cost can be charged to a cost centre", overhead.ok, overhead.ok ? overhead.reference : overhead.error);

const storedLine = await db.journalLine.findFirst({
  where: { entryId: overhead.entryId, costCentreId: { not: null } },
});
ok("the cost centre is stored on the line", storedLine?.costCentreId === child.id);

/* ------------------------------------------- it obeys the same guard rails - */
const wrongCompany = await postVoucher({
  companyId: company.id,
  postedBy: "test",
  voucherType: "Purchase",
  date: "2026-08-14",
  memo: `${TAG} foreign centre`,
  lines: [
    { accountId: expense.id, debit: 100, credit: 0, costCentreId: foreign.id },
    { accountId: cash.id, debit: 0, credit: 100 },
  ],
});
ok(
  "a cost centre from another company is refused",
  !wrongCompany.ok && /does not belong/i.test(wrongCompany.error),
  wrongCompany.error
);

const job = await db.job.findFirst({ where: { companyId: company.id } });
const both = await postVoucher({
  companyId: company.id,
  postedBy: "test",
  voucherType: "Purchase",
  date: "2026-08-14",
  memo: `${TAG} both dimensions`,
  lines: [
    { accountId: expense.id, debit: 100, credit: 0, jobId: job.id, costCentreId: centre.id },
    { accountId: cash.id, debit: 0, credit: 100 },
  ],
});
ok(
  "a line cannot carry both a job and a cost centre",
  !both.ok && /not both/i.test(both.error),
  both.error
);

/* --------------------------------------------------------- the roll-up ----- */
const centres = await db.costCentre.findMany({
  where: { companyId: company.id, code: { startsWith: "ZZ-" } },
  include: { lines: { include: { account: { select: { type: true } } } } },
});
const own = new Map(
  centres.map((c) => [
    c.id,
    c.lines.reduce((t, l) => (l.account.type === "Expense" ? t + l.debit - l.credit : t), 0),
  ])
);
const arranged = arrange(centres);
const parentRow = arranged.find((r) => r.node.id === centre.id);
ok("nothing was posted to the parent itself", (own.get(centre.id) ?? 0) === 0);
ok(
  "but the parent totals what its child carried",
  withDescendants(parentRow, own) === 900,
  String(withDescendants(parentRow, own))
);

/* ------------------------------------------- the untagged figure is real --- */
// The whole point of the second dimension: a cost with neither is now
// countable, where before it was indistinguishable from an overhead.
const stray = await postVoucher({
  companyId: company.id,
  postedBy: "test",
  voucherType: "Purchase",
  date: "2026-08-14",
  memo: `${TAG} untagged`,
  lines: [
    { accountId: expense.id, debit: 250, credit: 0 },
    { accountId: cash.id, debit: 0, credit: 250 },
  ],
});
const untagged = await db.journalLine.aggregate({
  where: {
    jobId: null,
    costCentreId: null,
    account: { companyId: company.id, type: "Expense" },
    entry: { memo: { contains: TAG } },
  },
  _sum: { debit: true, credit: true },
});
ok(
  "cost with neither a job nor a centre is countable",
  stray.ok && (untagged._sum.debit ?? 0) - (untagged._sum.credit ?? 0) === 250,
  String((untagged._sum.debit ?? 0) - (untagged._sum.credit ?? 0))
);

/* ----------------------------------------------------- a job is a project -- */
const parentJob = await db.job.create({
  data: { companyId: company.id, code: "ZZJ-01", name: "Test contract", type: "Contract" },
});
const pkg = await db.job.create({
  data: {
    companyId: company.id,
    code: "ZZJ-02",
    name: "Test variation",
    type: "Project",
    parentId: parentJob.id,
  },
});
ok("a job carries the word the client uses for it", pkg.type === "Project", pkg.type);
ok("and can sit under another job", pkg.parentId === parentJob.id);

const jobActions = read("src/app/(app)/finance/jobs/actions.ts");
ok("a job cannot become its own parent", jobActions.includes("cannot be its own parent"));
ok("nor be moved inside its own sub-job", jobActions.includes("inside one of its own sub-jobs"));
ok("a parent cannot be deleted out from under its children", jobActions.includes("sub-job"));
ok(
  "the job types are one list, not a second table",
  /JOB_TYPES = \["Contract", "Project", "Service call", "AMC", "Internal"\]/.test(read("src/lib/costing.ts"))
);
ok(
  "and the forms read that same list rather than copying it",
  read("src/components/finance/JobForm.tsx").includes('from "@/lib/costing"') &&
    jobActions.includes('from "@/lib/costing"')
);

/* ------------------------------- the roll-up must not reach the edit form -- */
// The job screen rolls sub-jobs into their parent for display. The edit form is
// filled from the same row, so if the roll-up overwrote the stored fields,
// opening a parent and pressing Save would write the total back and permanently
// double-count every variation. The totals therefore carry their own names.
{
  const page = read("src/app/(app)/finance/jobs/page.tsx");
  ok("the roll-up does not overwrite the stored contract value",
    !/^\s*contractValue,\s*$/m.test(page) && page.includes("rolledContract"));
  ok("nor the stored budget", !/^\s*budgetCost,\s*$/m.test(page) && page.includes("rolledBudget"));
  ok("and the edit form is filled from the job's own figures",
    page.includes("contractValue: j.contractValue") && page.includes("budgetCost: j.budgetCost"));
  ok("while the percentage shown is guarded on the figure it is derived from",
    page.includes("j.rolledBudget > 0 ?"));
}

/* ------------------------------------------------------------- wiring ------ */
const ccActions = read("src/app/(app)/finance/cost-centres/actions.ts");
ok(
  "every cost centre action checks permission",
  (ccActions.match(/await allow\("finance\.costcentres"/g) || []).length === 3
);
ok("the screen is registered for access control", read("src/lib/rbac.ts").includes('"finance.costcentres"'));
ok(
  "the finance roles are granted the new screen",
  read("prisma/seed.mjs").includes('"finance.costcentres"')
);
ok(
  "a cost centre with postings cannot be deleted",
  ccActions.includes("Untick Active instead")
);

const reversal = read("src/app/(app)/finance/actions.ts");
const reversalBlock = reversal.slice(reversal.indexOf("export async function reverseJournalEntry"));
ok("a reversal carries the cost centre through", reversalBlock.includes("costCentreId: l.costCentreId"));
ok("a reversal carries the party through", reversalBlock.includes("partyId: original.partyId"));

/* --------------------------------------- the form's encoding, round trip --- */
// The single "charge to" list encodes which dimension was picked into the
// option value. It is the one place a slip would silently write the id into the
// wrong column, so it is checked rather than merely present.
ok("a job encodes as a job", chargeValue({ jobId: "j1", costCentreId: "" }) === "job:j1");
ok("a cost centre encodes as a cost centre", chargeValue({ jobId: "", costCentreId: "c1" }) === "cc:c1");
ok("nothing chosen encodes as empty", chargeValue({ jobId: "", costCentreId: "" }) === "");
{
  const back = chargeFrom("job:j1");
  ok("decoding a job returns the job alone", back.jobId === "j1" && back.costCentreId === "");
}
{
  const back = chargeFrom("cc:c1");
  ok("decoding a centre returns the centre alone", back.costCentreId === "c1" && back.jobId === "");
}
{
  const back = chargeFrom("");
  ok("decoding nothing clears both", back.jobId === "" && back.costCentreId === "");
}
{
  // An id that itself begins with the other prefix must not be mangled: the
  // decode slices a fixed prefix, and cuids are arbitrary strings.
  const tricky = "cc:job:weird";
  ok("the prefix is stripped once, not greedily", chargeFrom(tricky).costCentreId === "job:weird");
  ok("and the round trip is lossless",
    chargeFrom(chargeValue({ jobId: "", costCentreId: "job:weird" })).costCentreId === "job:weird");
}

const form = read("src/components/JournalForm.tsx");
ok(
  "the voucher offers one 'charge to' list, not two",
  form.includes("Charge to") && form.includes("chargeFrom") && !form.includes("<span>Job</span>")
);
ok(
  "and the form uses the shared encoding rather than its own copy",
  form.includes('from "@/lib/costing"') && !form.includes("const chargeFrom")
);
ok(
  "and labels each group in plain English",
  form.includes("a customer pays for this") && form.includes("our own overhead")
);

await cleanup();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
