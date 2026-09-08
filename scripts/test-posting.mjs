/**
 * The posting service.
 *
 * This is the seam Projects, Inventory and Payroll will post through, so the
 * rules that protect the books have to hold for a caller that never touches a
 * form: balance, the period lock, everything belonging to the right company,
 * and one voucher per source document.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
const read = (p) => fs.readFileSync(p, "utf8");

// posting.ts carries `import "server-only"` — the guard that stops a client
// component importing the ledger. Node cannot resolve that outside Next's
// bundler, so the test imports a copy with only that line removed, written
// beside the original so its relative imports still resolve.
const SHIM = "src/lib/.posting.undertest.ts";
fs.writeFileSync(
  SHIM,
  read("src/lib/posting.ts")
    .replace(/^import "server-only";.*$/m, "")
    // Node's ESM resolver wants the extension that TypeScript leaves off.
    .replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let postVoucher, VOUCHER_PREFIX;
try {
  ({ postVoucher, VOUCHER_PREFIX } = await import("../src/lib/.posting.undertest.ts"));
} finally {
  fs.unlinkSync(SHIM);
}

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const company = await db.company.findFirst({ where: { code: "WBE" } });
const other = await db.company.findFirst({ where: { code: { not: "WBE" } } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const cash = accounts.find((a) => a.code === "1000");
const revenue = accounts.find((a) => a.type === "Income");
const otherAccount = await db.chartOfAccount.findFirst({ where: { companyId: other.id } });

const TAG = "TEST-POSTING";
const cleanup = async () => {
  const ids = (await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } })).map((m) => m.id);
  if (ids.length) {
    await db.journalEntry.updateMany({ where: { reversalOfId: { in: ids } }, data: { reversalOfId: null } });
    await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }
};
await cleanup();

const balanced = (amount = 1000) => [
  { accountId: cash.id, debit: amount, credit: 0 },
  { accountId: revenue.id, debit: 0, credit: amount },
];
const base = { companyId: company.id, postedBy: "test", voucherType: "Sales", date: "2026-08-14" };

/* -------------------------------------------- posting without a form ---- */
const posted = await postVoucher({ ...base, memo: `${TAG} plain`, lines: balanced() });
ok("a module can post without a FormData", posted.ok, posted.ok ? posted.reference : posted.error);
ok("the reference follows the company/type/year series",
  posted.ok && /^WBE\/SI\/\d{2}-\d{2}\/\d{4}$/.test(posted.reference), posted.ok ? posted.reference : "");

/* ------------------------------------------------ the rules still hold -- */
const unbalanced = await postVoucher({
  ...base, memo: `${TAG} unbalanced`,
  lines: [{ accountId: cash.id, debit: 1000, credit: 0 }, { accountId: revenue.id, debit: 0, credit: 900 }],
});
ok("an unbalanced voucher is refused", !unbalanced.ok && /not balanced/i.test(unbalanced.error), unbalanced.error);

const oneLine = await postVoucher({ ...base, memo: `${TAG} one line`, lines: [{ accountId: cash.id, debit: 100, credit: 0 }] });
ok("a single-sided voucher is refused", !oneLine.ok, oneLine.error);

const future = await postVoucher({ ...base, memo: `${TAG} future`, date: "2099-01-01", lines: balanced() });
ok("a date years ahead is refused", !future.ok && /year/i.test(future.error), future.error);

const badDate = await postVoucher({ ...base, memo: `${TAG} bad date`, date: "14-08-2026", lines: balanced() });
ok("a malformed date is refused", !badDate.ok, badDate.error);

/* ------------------------------------------------------ period lock ----- */
const previousLock = company.booksLockedTo;
await db.company.update({ where: { id: company.id }, data: { booksLockedTo: new Date("2026-07-31T23:59:59.999Z") } });
const locked = await postVoucher({ ...base, memo: `${TAG} locked`, date: "2026-07-15", lines: balanced() });
ok("the period lock applies to a module too", !locked.ok && /books are closed/i.test(locked.error), locked.error);
const afterLock = await postVoucher({ ...base, memo: `${TAG} after lock`, date: "2026-08-05", lines: balanced() });
ok("and a date after it still posts", afterLock.ok);
await db.company.update({ where: { id: company.id }, data: { booksLockedTo: previousLock } });

/* ------------------------------------- everything belongs to the company */
const wrongAccount = await postVoucher({
  ...base, memo: `${TAG} wrong account`,
  lines: [{ accountId: otherAccount.id, debit: 500, credit: 0 }, { accountId: revenue.id, debit: 0, credit: 500 }],
});
ok("an account from another company is refused",
  !wrongAccount.ok && /does not belong/i.test(wrongAccount.error), wrongAccount.error);

const otherJob = await db.job.findFirst({ where: { companyId: other.id } });
if (otherJob) {
  const wrongJob = await postVoucher({
    ...base, memo: `${TAG} wrong job`,
    lines: [
      { accountId: cash.id, debit: 500, credit: 0 },
      { accountId: revenue.id, debit: 0, credit: 500, jobId: otherJob.id },
    ],
  });
  ok("a job from another company is refused", !wrongJob.ok && /does not belong/i.test(wrongJob.error), wrongJob.error);
}

const otherParty = await db.party.findFirst({ where: { companyId: other.id } });
if (otherParty) {
  const wrongParty = await postVoucher({ ...base, memo: `${TAG} wrong party`, partyId: otherParty.id, lines: balanced() });
  ok("a party from another company is refused", !wrongParty.ok, wrongParty.error);
}

/* ------------------------------------------------- the source document -- */
const fromGrn = await postVoucher({
  ...base, memo: `${TAG} from a receipt`, voucherType: "Purchase",
  sourceType: "grn", sourceId: "GRN-TEST-1", lines: balanced(2500),
});
ok("a voucher can record the document behind it", fromGrn.ok, fromGrn.ok ? fromGrn.reference : fromGrn.error);

const stored = await db.journalEntry.findUnique({ where: { id: fromGrn.entryId } });
ok("the source is stored on the voucher", stored.sourceType === "grn" && stored.sourceId === "GRN-TEST-1");
ok("and source defaults to the module that raised it", stored.source === "grn", stored.source);

const twice = await postVoucher({
  ...base, memo: `${TAG} same receipt again`, voucherType: "Purchase",
  sourceType: "grn", sourceId: "GRN-TEST-1", lines: balanced(2500),
});
ok("the same document cannot post twice", !twice.ok && /already been posted/i.test(twice.error), twice.error);
ok("and the refusal names the voucher that already exists",
  !twice.ok && twice.error.includes(fromGrn.reference), twice.error);

const differentDoc = await postVoucher({
  ...base, memo: `${TAG} a different receipt`, voucherType: "Purchase",
  sourceType: "grn", sourceId: "GRN-TEST-2", lines: balanced(700),
});
ok("a different document of the same type posts fine", differentDoc.ok);

// Hand-typed vouchers carry no source, so many of them must coexist.
const manual1 = await postVoucher({ ...base, memo: `${TAG} manual one`, lines: balanced(11) });
const manual2 = await postVoucher({ ...base, memo: `${TAG} manual two`, lines: balanced(12) });
ok("vouchers with no source are not constrained by it", manual1.ok && manual2.ok);

/* ------------------------------------------------------ rounded to fils - */
// A VAT extraction or a proration produces 1119.571428…, which is not an amount
// anybody can pay. Stored unrounded it would show as 1,119.57 while the figure
// behind it carried a tail, so a report that sums before rounding would
// disagree with one that rounds before summing.
{
  const raw = 1175.55 / 1.05; // 1119.5714285714284
  const posted = await postVoucher({
    ...base, memo: `${TAG} vat extraction`, vatAmount: raw * 0.05,
    lines: [{ accountId: cash.id, debit: raw, credit: 0 }, { accountId: revenue.id, debit: 0, credit: raw }],
  });
  ok("a sub-fils amount posts", posted.ok, posted.ok ? posted.reference : posted.error);
  const stored = await db.journalEntry.findUnique({ where: { id: posted.entryId }, include: { lines: true } });
  const overTwoDp = (v) => Math.abs(v * 100 - Math.round(v * 100)) > 1e-9;
  ok("the line is stored rounded to fils", !overTwoDp(stored.lines[0].debit), String(stored.lines[0].debit));
  ok("and so is the VAT", !overTwoDp(stored.vatAmount), String(stored.vatAmount));

  // Rounding must not turn an unbalanced voucher into a balanced one.
  const uneven = await postVoucher({
    ...base, memo: `${TAG} uneven`,
    lines: [{ accountId: cash.id, debit: 100.005, credit: 0 }, { accountId: revenue.id, debit: 0, credit: 100.004 }],
  });
  ok("rounding does not square off an unbalanced voucher",
    !uneven.ok && /not balanced/i.test(uneven.error), uneven.error);
}

/* ------------------------------------------------------- the reversal --- */
// A reversal is its own document. Copying the source would collide with the
// unique index and make the original impossible to correct.
const actions = read("src/app/(app)/finance/actions.ts");
const reversalBlock = actions.slice(actions.indexOf("export async function reverseJournalEntry"));
ok("a reversal does not inherit the source document",
  !/sourceType|sourceId/.test(reversalBlock.slice(0, reversalBlock.indexOf("await audit"))));

/* ------------------------------------------------------------ wiring ---- */
ok("the screen's action is a thin caller", actions.includes("await postVoucher({") && actions.includes('from "@/lib/posting"'));
ok("the action still checks permission first", /createJournalEntry[\s\S]{0,200}allow\("finance\.overview", "create"\)/.test(actions));
ok("the service holds no permission logic", !read("src/lib/posting.ts").includes("allow("));
ok("all eight voucher types have a prefix", Object.keys(VOUCHER_PREFIX).length === 8, Object.keys(VOUCHER_PREFIX).join(", "));

await cleanup();
await db.$disconnect();
/* ================ two people posting at the same moment =================== */
/**
 * The reference number used to be a count, read and then used. A stress test
 * against PostgreSQL found what that costs: twenty simultaneous posts, three
 * succeeded and seventeen were refused with "Unique constraint failed on the
 * fields: (companyId, reference)". Nothing was corrupted — the index held — but
 * a finance team at month-end was being turned away in a language nobody reads.
 *
 * SQLite serialises writers, so this cannot reproduce the collision here the way
 * PostgreSQL does. What it CAN prove is the part that matters either way: every
 * caller gets a voucher, no two share a number, and the sequence has no holes.
 * The gap check earns its place — the first version of the fix skipped numbers,
 * which is an audit finding of its own.
 */
{
  const co = await db.company.findFirst({ where: { code: "WBE" } });
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId: co.id, code: { in: ["1000", "4000"] } },
    select: { id: true, code: true },
  });
  const bank = accounts.find((a) => a.code === "1000");
  const revenue = accounts.find((a) => a.code === "4000");

  const before = await db.journalEntry.findMany({
    where: { companyId: co.id, voucherType: "Contra" },
    select: { reference: true },
  });

  const WORKERS = 8;
  const results = await Promise.all(
    Array.from({ length: WORKERS }, (_, k) =>
      postVoucher({
        companyId: co.id,
        postedBy: `worker-${k}`,
        voucherType: "Contra",
        date: "2026-06-15",
        memo: `race ${k}`,
        lines: [
          { accountId: bank.id, debit: 10, credit: 0 },
          { accountId: revenue.id, debit: 0, credit: 10 },
        ],
      }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }))
    )
  );

  const posted = results.filter((r) => r.ok);
  ok("every simultaneous post gets a voucher", posted.length === WORKERS,
    `${posted.length} of ${WORKERS}` + (posted.length < WORKERS
      ? ` — ${results.find((r) => !r.ok)?.error?.slice(0, 80)}`
      : ""));

  const refs = posted.map((r) => r.reference);
  ok("no two of them share a number", new Set(refs).size === refs.length, refs.join(", "));

  const after = await db.journalEntry.findMany({
    where: { companyId: co.id, voucherType: "Contra" },
    select: { reference: true },
  });
  const nums = after.map((e) => Number(e.reference.split("/").pop())).sort((a, b) => a - b);
  const gaps = nums.filter((v, i) => i > 0 && v !== nums[i - 1] + 1);
  ok("the sequence has no gaps in it", gaps.length === 0,
    gaps.length ? `jumps to ${gaps.join(", ")}` : `${nums.length} consecutive`);

  const agg = await db.journalLine.aggregate({
    where: { entry: { companyId: co.id } },
    _sum: { debit: true, credit: true },
  });
  ok("and the ledger still balances after all of it",
    Math.abs((agg._sum.debit ?? 0) - (agg._sum.credit ?? 0)) < 0.005);

  // Put the books back.
  const made = after.filter((e) => !before.some((b) => b.reference === e.reference));
  for (const e of made) {
    const row = await db.journalEntry.findFirst({ where: { companyId: co.id, reference: e.reference } });
    if (row) await db.journalEntry.delete({ where: { id: row.id } });
  }
}

/* =========== the same document cannot be posted twice, even in a race ==== */
{
  const co = await db.company.findFirst({ where: { code: "WBE" } });
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId: co.id, code: { in: ["1000", "4000"] } },
    select: { id: true, code: true },
  });
  const bank = accounts.find((a) => a.code === "1000");
  const revenue = accounts.find((a) => a.code === "4000");
  const sourceId = "race-source-" + Date.now();

  // Retrying a reference clash is right; retrying a duplicate SOURCE DOCUMENT
  // would post the very thing the index exists to prevent. The two look
  // identical to Prisma — both are P2002 — so they are told apart by which
  // fields the constraint names.
  const both = await Promise.all(
    [0, 1].map((k) =>
      postVoucher({
        companyId: co.id,
        postedBy: `worker-${k}`,
        voucherType: "Contra",
        date: "2026-06-16",
        memo: "same document twice",
        lines: [
          { accountId: bank.id, debit: 10, credit: 0 },
          { accountId: revenue.id, debit: 0, credit: 10 },
        ],
        sourceType: "race-test",
        sourceId,
      }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }))
    )
  );
  const won = both.filter((r) => r.ok);
  ok("only one of two posts of the same document succeeds", won.length === 1,
    `${won.length} succeeded`);
  ok("and the other is told why, in a sentence",
    both.some((r) => !r.ok && /already been posted/i.test(r.error ?? "")),
    both.find((r) => !r.ok)?.error?.slice(0, 90) ?? "(no message)");

  const rows = await db.journalEntry.findMany({
    where: { companyId: co.id, sourceType: "race-test", sourceId },
  });
  ok("exactly one voucher exists for that document", rows.length === 1, `${rows.length} rows`);
  for (const r of rows) await db.journalEntry.delete({ where: { id: r.id } });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
