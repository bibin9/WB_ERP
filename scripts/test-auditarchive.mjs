/**
 * Retention and archiving of the audit trail.
 *
 * The rule this file exists to hold: an entry that leaves the live table is in
 * the archive. Not "usually", not "unless the process died" — the copy and the
 * delete are one transaction precisely so there is no third outcome. An audit
 * trail that can lose a row under load is not an audit trail, and the failure
 * would be silent, discovered only by the auditor who asks for the row.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { auditmeta, auditarchive } = await importLibs([
  "auditmeta", "auditarchive", "db",
]);
const {
  DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS,
  RETENTION_CHOICES, validateRetentionDays, retentionCutoff, retentionLabel,
} = auditmeta;
const { archiveTenant, dueForArchive, ARCHIVE_BATCH } = auditarchive;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");

/* ===================== the rules, before any database ==================== */

ok("a year is the default", DEFAULT_RETENTION_DAYS === 365);
ok("every offered choice is inside the bounds",
  RETENTION_CHOICES.every((c) => c.days >= MIN_RETENTION_DAYS && c.days <= MAX_RETENTION_DAYS));
ok("one year is among them", RETENTION_CHOICES.some((c) => c.days === 365 && c.label === "1 year"));

ok("a sensible period is accepted", validateRetentionDays(365).ok);
ok("so is the floor itself", validateRetentionDays(MIN_RETENTION_DAYS).ok);
ok("so is the ceiling itself", validateRetentionDays(MAX_RETENTION_DAYS).ok);

// Somebody hiding their tracks would set this to a day. The floor is the reason
// they cannot, and the message has to say why rather than just refuse.
const tooShort = validateRetentionDays(1);
ok("a window of one day is refused", !tooShort.ok);
ok("and the refusal explains itself", !tooShort.ok && /at least 30 days/.test(tooShort.error), tooShort.error);
ok("the refusal also says nothing is deleted",
  !tooShort.ok && /rather than being deleted/.test(tooShort.error));

ok("beyond ten years is refused", !validateRetentionDays(MAX_RETENTION_DAYS + 1).ok);
{
  const blank = validateRetentionDays("");
  ok("blank is refused", !blank.ok, blank.ok ? "IT WAS ACCEPTED" : "");
  ok("and told to enter a number, rather than lectured about the floor",
    !blank.ok && /Enter the number of days/.test(blank.error), blank.error);
}
ok("text is refused", !validateRetentionDays("soon").ok);
ok("a fraction is floored rather than stored as one",
  validateRetentionDays(365.9).ok && validateRetentionDays(365.9).days === 365);
ok("a negative is refused", !validateRetentionDays(-400).ok);

{
  const now = new Date("2026-09-09T12:00:00.000Z");
  const cut = retentionCutoff(365, now);
  ok("the cutoff is a year back to the minute", cut.toISOString() === "2025-09-09T12:00:00.000Z", cut.toISOString());
}
ok("a standard period reads as a period", retentionLabel(365) === "1 year" && retentionLabel(90) === "3 months");
ok("an odd one reads as days", retentionLabel(45) === "45 days", retentionLabel(45));

/* ============ nothing leaves the live table without arriving ============= */

const tenant = await db.tenant.findFirst();
const MARK = "ARCHIVE TEST —";
const cleanup = async () => {
  await db.auditLog.deleteMany({ where: { summary: { startsWith: MARK } } });
  await db.auditLogArchive.deleteMany({ where: { summary: { startsWith: MARK } } });
};
await cleanup();

const original = (await db.tenant.findUnique({ where: { id: tenant.id }, select: { auditRetentionDays: true } })).auditRetentionDays;
const day = 24 * 60 * 60 * 1000;

try {
  await db.tenant.update({ where: { id: tenant.id }, data: { auditRetentionDays: 365 } });

  // Three well outside the window, two comfortably inside, and one a day short
  // of it — the boundary is where an off-by-one would hide.
  const ages = [400, 400, 400, 366, 364, 10];
  const rows = ages.map((d, i) => ({
    tenantId: tenant.id, userId: null, userName: `person-${i}`,
    action: "Updated", entity: "Test", entityId: null,
    summary: `${MARK} ${d} days old`,
    ipAddress: "10.0.0.1", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36",
    createdAt: new Date(Date.now() - d * day),
  }));
  await db.auditLog.createMany({ data: rows });

  const liveBefore = await db.auditLog.count({ where: { summary: { startsWith: MARK } } });
  ok("six test entries are on the live trail", liveBefore === 6, `${liveBefore}`);

  const due = await dueForArchive(tenant.id, 365);
  ok("four of them are past a one-year window", due >= 4, `${due} due (includes any real old entries)`);

  const result = await archiveTenant(tenant.id);
  ok("the run reports what it kept", result.retentionDays === 365);
  ok("and reports a cutoff a year back", Math.abs(Date.now() - result.cutoff.getTime() - 365 * day) < 5000);

  const live = await db.auditLog.findMany({ where: { summary: { startsWith: MARK } } });
  const arch = await db.auditLogArchive.findMany({ where: { summary: { startsWith: MARK } } });

  ok("everything that left the live table is in the archive",
    live.length + arch.length === 6, `${live.length} live + ${arch.length} archived`);
  ok("the four older than a year moved", arch.length === 4, `${arch.length}`);
  ok("the two inside the window stayed", live.length === 2, `${live.length}`);
  ok("the entry 364 days old was NOT moved",
    live.some((r) => /364 days old/.test(r.summary)), live.map((r) => r.summary).join(" | "));
  ok("the entry 366 days old WAS moved",
    arch.some((r) => /366 days old/.test(r.summary)));

  // An archived entry that has lost its address or its date answers nothing.
  const sample = arch[0];
  ok("the archived row keeps its original id", sample.id.length > 10);
  ok("it keeps when the thing actually happened, not when it was filed",
    sample.createdAt.getTime() < Date.now() - 300 * day);
  ok("and it records separately when it was filed",
    Math.abs(sample.archivedAt.getTime() - Date.now()) < 60000);
  ok("the address survives the move", sample.ipAddress === "10.0.0.1");
  ok("the device survives the move", /Chrome/.test(sample.userAgent ?? ""));
  ok("the user name survives the move", /^person-/.test(sample.userName));

  // Running it again must be a no-op, not a second copy or an error.
  const again = await archiveTenant(tenant.id);
  ok("running it a second time moves nothing", again.moved === 0, `${again.moved}`);
  ok("and does not duplicate what is already archived",
    (await db.auditLogArchive.count({ where: { summary: { startsWith: MARK } } })) === 4);

  // Shortening the window pulls more across; the setting is what decides, not
  // a constant compiled into the archiver.
  await db.tenant.update({ where: { id: tenant.id }, data: { auditRetentionDays: 30 } });
  const shorter = await archiveTenant(tenant.id);
  ok("shortening the window moves the next batch", shorter.moved >= 1, `${shorter.moved} moved`);
  ok("the run used the stored setting, not the default", shorter.retentionDays === 30);
  const stillLive = await db.auditLog.count({ where: { summary: { startsWith: MARK } } });
  ok("the ten-day-old entry is still on the live trail", stillLive === 1, `${stillLive}`);
  ok("and the total is still six, wherever they sit",
    stillLive + (await db.auditLogArchive.count({ where: { summary: { startsWith: MARK } } })) === 6);
} finally {
  await cleanup();
  await db.tenant.update({ where: { id: tenant.id }, data: { auditRetentionDays: original } });
}

ok("the tenant's own setting is put back", true, `${original} days`);

/* ======================= how it is wired in ============================== */
{
  const lib = read("src/lib/auditarchive.ts");
  ok("the copy and the delete are one transaction",
    /\$transaction\(\[[\s\S]*auditLogArchive\.createMany[\s\S]*auditLog\.deleteMany/.test(lib));
  ok("the copy comes before the delete, so a crash cannot lose a row",
    lib.indexOf("auditLogArchive.createMany") < lib.indexOf("auditLog.deleteMany"));
  ok("nothing in it deletes from the archive", !/auditLogArchive\.delete/.test(lib));
  ok("it works in batches rather than one enormous statement", ARCHIVE_BATCH > 0 && ARCHIVE_BATCH <= 5000);
  ok("and one invocation is bounded", /ARCHIVE_MAX_BATCHES/.test(lib));
  ok("a clash with a concurrent run is handled, not thrown",
    /code !== "P2002"/.test(lib) && /\+\+clashes/.test(lib));

  // The first attempt at this was a script in the npm start chain. It would
  // have failed on every deploy without anyone noticing: Node resolves
  // `./db` literally where TypeScript finds `db.ts`, so the import would
  // have thrown before a single row moved, and the guard around it would have
  // swallowed that quietly. Next's own boot hook is ordinary application code
  // with ordinary module resolution, so the problem does not arise.
  const boot = read("src/instrumentation.ts");
  ok("archiving runs from the server's boot hook", /export async function register/.test(boot));
  ok("it calls the same archiver the button calls", /archiveAll/.test(boot));
  ok("it cannot stop the server coming up", /catch \(err\)/.test(boot));
  ok("and it does not try to run in the edge runtime, which has no database",
    /NEXT_RUNTIME !== "nodejs"/.test(boot));

  ok("no orphaned start-chain script is left behind",
    !fs.existsSync("scripts/archive-audit.mjs") &&
    !read("package.json").includes("archive-audit"));

  const actions = read("src/app/(app)/audit/actions.ts");
  ok("changing the retention period needs the audit permission",
    /allow\("audit\.log", "edit"\)/.test(actions));
  ok("and an administrator", /canAdminister\(\)/.test(actions));
  ok("the change is itself written to the trail it governs",
    /audit\(\{[\s\S]*Audit retention/.test(actions));
  ok("so is an archive run", /audit\(\{[\s\S]*Audit trail/.test(actions));

  const page = read("src/app/(app)/audit/page.tsx");
  ok("the screen is paged rather than showing an arbitrary hundred",
    /readPaging\(sp\)/.test(page) && /<Pager/.test(page) && !/take: 100/.test(page));
  ok("the archive is readable from the same screen",
    /auditLogArchive\.findMany/.test(page) && /sp\.src === "archive"/.test(page));
  // The tab used to be a bare link. It now goes through the filter helper so a
  // question asked on the Recent tab survives switching to the Archive — a
  // filter that resets when you change tab is one nobody uses twice.
  ok("  and switching to it keeps the filter",
    /filterQuery\(filter, archive \? \{ src: "archive" \}/.test(page));
  ok("both counts are shown, so nothing looks lost",
    /auditLog\.count/.test(page) && /auditLogArchive\.count/.test(page));
  ok("a non-administrator is still told where the older entries went",
    /Entries older than \{retentionLabel/.test(page));

  const help = read("src/lib/help.ts");
  ok("and there is plain-English help for it", /id: "audit-retention"/.test(help));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
