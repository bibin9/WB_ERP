/**
 * The retention register.
 *
 * Retention is five or ten per cent of every certificate, held for a year, in
 * both directions at once. The rules that make the register trustworthy:
 *
 *   - recording an entry must not touch the ledger, because the certificate
 *     that withheld the money already did — posting again would double it;
 *   - releasing must move the amount out of retention and into the ordinary
 *     receivable or payable, changing neither the total owed nor the profit;
 *   - and it must be impossible to release the same money twice.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import {
  retentionState, ageing, retentionOn, STAGES, DIRECTIONS,
  RETENTION_RECEIVABLE_CODE, RETENTION_PAYABLE_CODE, AR_CODE, AP_CODE,
} from "../src/lib/retention.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const SHIM = "src/lib/.posting.ret.ts";
fs.writeFileSync(
  SHIM,
  read("src/lib/posting.ts").replace(/^import "server-only";.*$/m, "").replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let postVoucher;
try { ({ postVoucher } = await import("../src/lib/.posting.ret.ts")); } finally { fs.unlinkSync(SHIM); }

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* =================================================== the arithmetic ======= */
ok("ten per cent of a certificate", retentionOn(200000, 10) === 20000);
ok("five per cent, to the fils", retentionOn(126000, 5) === 6300);
ok("an awkward figure rounds to fils", retentionOn(33333.33, 10) === 3333.33);
ok("retention runs both ways", DIRECTIONS.join(",") === "Receivable,Payable");
ok("and comes back in two known tranches",
  STAGES.includes("Practical completion") && STAGES.includes("Defects liability"));

/* ================================================= dates and ageing ======= */
{
  const asAt = new Date("2026-09-10T00:00:00.000Z");
  const at = (iso, status = "Held", direction = "Receivable", amount = 1000) =>
    ({ direction, dueDate: new Date(iso + "T00:00:00.000Z"), amount, status });

  ok("a tranche past its date is overdue", retentionState(at("2026-08-01"), asAt).overdue);
  ok("one due today can be asked for", retentionState(at("2026-09-10"), asAt).releasable);
  ok("one due next month is not yet", !retentionState(at("2026-10-20"), asAt).releasable);
  ok("but does count as due soon", retentionState(at("2026-10-20"), asAt).dueSoon);
  ok("one a year out is neither", !retentionState(at("2027-09-01"), asAt).dueSoon);
  ok("released money is not held at all", !retentionState(at("2026-08-01", "Released"), asAt).held);

  const a = ageing(
    [at("2026-08-01", "Held", "Receivable", 20000),
     at("2026-10-01", "Held", "Receivable", 15000),
     at("2027-09-01", "Held", "Receivable", 30000),
     at("2026-08-01", "Released", "Receivable", 99999)],
    asAt
  );
  ok("what can be asked for now is counted apart", a.releasable === 20000, String(a.releasable));
  ok("what falls due within sixty days is its own figure", a.soon === 15000, String(a.soon));
  ok("the rest is later", a.later === 30000, String(a.later));
  ok("and released money is in none of it", a.total === 65000, String(a.total));
}

/* ============================= recording must not touch the ledger ======== */
const company = await db.company.findFirst({ where: { code: "WBE" } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const acc = (c) => accounts.find((a) => a.code === c);

ok(`the chart has ${RETENTION_RECEIVABLE_CODE} Retention Receivable`, !!acc(RETENTION_RECEIVABLE_CODE), acc(RETENTION_RECEIVABLE_CODE)?.name);
ok(`and ${RETENTION_PAYABLE_CODE} Retention Payable`, !!acc(RETENTION_PAYABLE_CODE), acc(RETENTION_PAYABLE_CODE)?.name);
ok("receivable retention is an asset — the client owes it back", acc(RETENTION_RECEIVABLE_CODE)?.type === "Asset");
ok("payable retention is a liability — we owe it on", acc(RETENTION_PAYABLE_CODE)?.type === "Liability");

const clean = async () => {
  const ids = (await db.retention.findMany({ where: { reference: { startsWith: "ZZR" } }, select: { id: true } })).map((r) => r.id);
  if (ids.length) await db.retention.deleteMany({ where: { id: { in: ids } } });
  const eids = (await db.journalEntry.findMany({ where: { memo: { contains: "ZZR" } }, select: { id: true } })).map((e) => e.id);
  if (eids.length) await db.journalEntry.deleteMany({ where: { id: { in: eids } } });
};
await clean();

const client = await db.party.findFirst({ where: { companyId: company.id, type: { in: ["Customer", "Both"] } } });
const vouchersBefore = await db.journalEntry.count({ where: { companyId: company.id } });

const row = await db.retention.create({
  data: {
    companyId: company.id, direction: "Receivable", reference: "ZZR-IPC-09",
    amount: 25000, percent: 10, stage: "Defects liability",
    dueDate: new Date("2026-09-01T00:00:00.000Z"),
    partyId: client.id, partyName: client.name, status: "Held",
  },
});
ok("retention can be recorded", !!row.id);
ok("recording it writes no voucher",
  (await db.journalEntry.count({ where: { companyId: company.id } })) === vouchersBefore,
  "the certificate already posted the money");

/* ================== releasing moves it, without changing what is owed ===== */
{
  const balances = async () => {
    const rows = await db.journalLine.findMany({
      where: { entry: { companyId: company.id } },
      include: { account: { select: { code: true, type: true } } },
    });
    const of = (code) => rows.filter((l) => l.account.code === code).reduce((t, l) => t + l.debit - l.credit, 0);
    let income = 0, expense = 0;
    for (const l of rows) {
      if (l.account.type === "Income") income += l.credit - l.debit;
      else if (l.account.type === "Expense") expense += l.debit - l.credit;
    }
    return { retention: of(RETENTION_RECEIVABLE_CODE), ar: of(AR_CODE), profit: Math.round((income - expense) * 100) / 100 };
  };

  const before = await balances();
  const posted = await postVoucher({
    companyId: company.id, postedBy: "test", voucherType: "Journal", date: "2026-09-05",
    partyId: row.partyId, memo: "ZZR release",
    lines: [
      { accountId: acc(AR_CODE).id, debit: row.amount, credit: 0 },
      { accountId: acc(RETENTION_RECEIVABLE_CODE).id, debit: 0, credit: row.amount },
    ],
    sourceType: "retention", sourceId: row.id, source: "retention",
  });
  ok("releasing posts a voucher", posted.ok, posted.ok ? posted.reference : posted.error);

  const after = await balances();
  ok("retention falls by the amount released", Math.round((before.retention - after.retention) * 100) / 100 === 25000,
    `${before.retention} -> ${after.retention}`);
  ok("and the ordinary receivable rises by the same",
    Math.round((after.ar - before.ar) * 100) / 100 === 25000, `${before.ar} -> ${after.ar}`);
  ok("the profit does not move — nothing was earned or spent", after.profit === before.profit,
    `${before.profit}`);

  // The guard that matters: releasing twice would invent money.
  const again = await postVoucher({
    companyId: company.id, postedBy: "test", voucherType: "Journal", date: "2026-09-05",
    memo: "ZZR release again",
    lines: [
      { accountId: acc(AR_CODE).id, debit: row.amount, credit: 0 },
      { accountId: acc(RETENTION_RECEIVABLE_CODE).id, debit: 0, credit: row.amount },
    ],
    sourceType: "retention", sourceId: row.id,
  });
  ok("the same retention cannot be released twice",
    !again.ok && /already been posted/i.test(again.error), again.error);

  await db.retention.update({ where: { id: row.id }, data: { status: "Released", entryId: posted.entryId } });
  const settled = await db.retention.findUnique({ where: { id: row.id } });
  ok("the register records which voucher released it", settled.entryId === posted.entryId);
  ok("and it leaves the held list", settled.status !== "Held");
}

/* ==================================================== the wiring ========== */
const actions = read("src/app/(app)/finance/retention/actions.ts");
ok("every action checks permission",
  (actions.match(/await allow\("finance\.retention"/g) || []).length === 4);
ok("releasing posts through the shared service",
  actions.includes("await postVoucher({") && actions.includes('from "@/lib/posting"'));
ok("the voucher carries the retention as its source",
  actions.includes('sourceType: "retention"') && actions.includes("sourceId: row.id"));
ok("a receivable release debits the ordinary receivable",
  actions.includes("receivable ? RETENTION_RECEIVABLE_CODE : RETENTION_PAYABLE_CODE"));
ok("an entry already released cannot be released again",
  actions.includes('already ${row.status.toLowerCase()}'));
ok("a posted entry cannot be edited", actions.includes("Reverse that voucher in the Day Book to change it"));
ok("nor deleted", actions.includes("Reverse that voucher in the Day Book instead"));
ok("the same certificate and stage cannot be entered twice", actions.includes("is already in the register"));
ok("a job from another company is refused", actions.includes("not in this company"));
ok("amounts are rounded to fils", actions.includes("toFils("));

const page = read("src/app/(app)/finance/retention/page.tsx");
ok("the screen is permission-gated", page.includes('requireAccess("finance.retention")'));
ok("it leads with what can be asked for now", page.includes("Ready to ask for"));
ok("it shows both directions", page.includes("Held by clients") && page.includes("Held by us"));
ok("it warns about tranches past their date", page.includes("past the date they could have"));
ok("it agrees the register to the ledger", page.includes("The register and the ledger disagree"));
ok("it says plainly that recording does not post", page.includes("does not change your accounts"));
ok("it can be searched, paged, printed and exported",
  page.includes("<SearchBox") && page.includes("<Pager") && page.includes("PrintReport") && page.includes('dataset="retention"'));

ok("the screen is registered for access control", read("src/lib/rbac.ts").includes('"finance.retention"'));
ok("and granted to the finance roles", read("prisma/seed.mjs").includes('"finance.retention"'));
ok("the tab is wired", read("src/components/FinanceTabsClient.tsx").includes("/finance/retention"));
ok("the export is registered", read("src/app/(app)/export/actions.ts").includes("  retention,"));

await clean();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
