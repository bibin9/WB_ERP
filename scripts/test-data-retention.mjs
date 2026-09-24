/**
 * Data retention: the windows, the archives, and what must never be touched.
 *
 * Two rules this file exists to hold.
 *
 * The first is that only logs are ever moved. The obvious next request after
 * this screen ships is "archive the old invoices too", and the day somebody
 * adds Invoice or JournalEntry to the policy list, the trial balance, the job
 * cost report and every end-of-service calculation start reading a table with
 * its history taken out. The test below fails on the name.
 *
 * The second is that a sent-email record that leaves the live table is in the
 * archive — the copy and the delete are one transaction, so there is no third
 * outcome, the same rule the audit archive is held to.
 */
import { PrismaClient } from "@prisma/client";
import { importLibs } from "./lib-shim.mjs";

const { "data-retention": retention } = await importLibs(["data-retention", "auditmeta", "db"]);
const {
  POLICIES, policyOf, validateDays, MAX_DAYS, retentionCutoff, retentionLabel,
  archiveEmailLogs, pruneNotifications, dueNow, ARCHIVE_BATCH,
} = retention;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };

/* ======================= the policy list itself ========================== */

// The whole point of the screen: logs only. Business records are read by
// reports years later, and a report reading an emptied table is wrong rather
// than slow.
const FORBIDDEN = [
  "invoice", "journal", "voucher", "payroll", "payslip", "attendance", "timesheet",
  "stock", "movement", "employee", "leave", "settlement", "separation", "quotation",
  "estimate", "lead", "order", "requisition", "cheque", "advance",
];
// The key and the label only: the column names all carry the word "retention",
// which is also a finance record (money held back on a contract) — the one word
// this list cannot use to tell the two apart.
const named = POLICIES.map((p) => `${p.key} ${p.label}`.toLowerCase()).join(" | ");
ok("only logs are ever archived — no business record is in the policy list",
  !FORBIDDEN.some((w) => named.includes(w)), named);
ok("the three logs are all there",
  ["audit", "email", "notifications"].every((k) => !!policyOf(k)), `${POLICIES.length} policies`);
ok("each policy says what the records are, and what happens next",
  POLICIES.every((p) => p.what.length > 20 && p.then.length > 20));
ok("each says where the records go", POLICIES.every((p) => ["Archive", "Removed"].includes(p.destination)));
ok("only notifications are removed rather than archived",
  POLICIES.filter((p) => p.destination === "Removed").map((p) => p.key).join() === "notifications");
ok("every window has a floor with a reason a person can read",
  POLICIES.every((p) => p.minDays >= 30 && p.floorReason.length > 30));
ok("sent emails are kept at least a year by default",
  policyOf("email").defaultDays >= 365 && policyOf("email").minDays >= 365);
ok("an unknown key is not a policy", policyOf("invoices") === undefined);

/* ============================ validation ================================= */

const email = policyOf("email");
ok("a sensible period is accepted", validateDays(email, 1095).ok);
ok("the floor itself is accepted", validateDays(email, email.minDays).ok);
ok("under the floor is refused, and says why", (() => {
  const r = validateDays(email, 30);
  return !r.ok && r.error === email.floorReason;
})());
ok("over ten years is refused", !validateDays(email, MAX_DAYS + 1).ok);
ok("a blank field is refused as a blank field, not as too short",
  (() => { const r = validateDays(email, ""); return !r.ok && /Enter the number/.test(r.error); })());
ok("text is refused", !validateDays(email, "soon").ok);
ok("a fraction is floored, not rejected", (() => { const r = validateDays(email, 400.7); return r.ok && r.days === 400; })());
ok("the label reads as a period", retentionLabel(365) === "1 year" && retentionLabel(45) === "45 days");
ok("the cutoff is that many days back",
  Math.round((Date.now() - retentionCutoff(10).getTime()) / 86400000) === 10);

/* ====================== the archive, on the database ===================== */

const tenant = await db.tenant.findFirst({ where: { key: "wandb" } });
const company = await db.company.findFirst({ where: { tenantId: tenant.id } });
const user = await db.user.findFirst({ where: { tenantId: tenant.id } });
const MARK = "[retention test]";

const cleanup = async () => {
  await db.emailLog.deleteMany({ where: { subject: { contains: MARK } } });
  await db.emailLogArchive.deleteMany({ where: { subject: { contains: MARK } } });
  await db.notification.deleteMany({ where: { title: { contains: MARK } } });
};
await cleanup();

const old = new Date(Date.now() - 4000 * 86400000);
const recent = new Date(Date.now() - 2 * 86400000);

await db.emailLog.createMany({
  data: [
    ...Array.from({ length: 5 }, (_, i) => ({
      companyId: company.id, kind: "Quotation", subject: `${MARK} old ${i}`,
      toAddresses: "client@example.com", sentAt: old, ok: true,
    })),
    { companyId: company.id, kind: "Quotation", subject: `${MARK} recent`, toAddresses: "client@example.com", sentAt: recent, ok: true },
  ],
});

const before = await dueNow(tenant.id);
const emailRow = before.find((r) => r.policy.key === "email");
ok("the screen counts what is due without moving anything", emailRow.due >= 5, `${emailRow.due} due`);

const run = await archiveEmailLogs(tenant.id);
ok("the old ones moved", run.moved >= 5, `${run.moved} moved`);
ok("and the recent one did not",
  (await db.emailLog.count({ where: { subject: { contains: MARK } } })) === 1);
ok("what left the live table is in the archive",
  (await db.emailLogArchive.count({ where: { subject: { contains: MARK } } })) >= 5);
const copy = await db.emailLogArchive.findFirst({ where: { subject: { contains: `${MARK} old 0` } } });
ok("the archived row is the same row, id and all, keeping the date it was sent rather than the date it moved",
  !!copy && copy.toAddresses === "client@example.com" && Math.abs(copy.sentAt.getTime() - old.getTime()) < 1000
  && copy.archivedAt.getTime() > old.getTime());

const again = await archiveEmailLogs(tenant.id);
ok("running it twice moves nothing the second time", again.moved === 0);

/* ===================== notifications: read only, and gone ================ */

await db.notification.createMany({
  data: [
    { tenantId: tenant.id, userId: user.id, title: `${MARK} read and old`, isRead: true, createdAt: old },
    { tenantId: tenant.id, userId: user.id, title: `${MARK} unread and old`, isRead: false, createdAt: old },
    { tenantId: tenant.id, userId: user.id, title: `${MARK} read and recent`, isRead: true, createdAt: recent },
  ],
});

const pruned = await pruneNotifications(tenant.id);
ok("a read notification past the window is removed", pruned.moved >= 1, `${pruned.moved} removed`);
ok("an unread one is kept however old",
  (await db.notification.count({ where: { title: { contains: "unread and old" } } })) === 1);
ok("a recent read one is kept",
  (await db.notification.count({ where: { title: { contains: "read and recent" } } })) === 1);

/* ========================= what is never touched ========================= */

// The counts that must not move, whatever any retention job does.
const counts = async () => ({
  invoices: await db.invoice.count(),
  journals: await db.journalEntry.count(),
  payslips: await db.payslip.count(),
  attendance: await db.attendance.count(),
  movements: await db.stockMovement.count(),
  employees: await db.employee.count(),
});
const beforeCounts = await counts();
await archiveEmailLogs(tenant.id);
await pruneNotifications(tenant.id);
const afterCounts = await counts();
ok("no business record was touched by any retention job",
  JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
  JSON.stringify(afterCounts));

ok("the batch size keeps one transaction short", ARCHIVE_BATCH <= 1000 && ARCHIVE_BATCH >= 100);

await cleanup();
console.log("\n" + "=".repeat(50));
console.log(`DATA RETENTION:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
console.log("=".repeat(50));
await db.$disconnect();
if (fail > 0) process.exit(1);
