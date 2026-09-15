/**
 * Calibrated equipment, and when it stops being trustworthy (INV-12, INV-13).
 *
 * The rule the whole thing turns on: the block is worked out from the
 * certificate every time it is asked for, never stored. A flag somebody has to
 * set when a date passes is wrong on exactly the day it matters, because nobody
 * sets a flag on a Friday for a certificate that lapses on Saturday.
 *
 * A reading taken with an instrument whose certificate expired last month is
 * not a reading. It is a number, and the difference only surfaces when a
 * client's inspector asks to see the paperwork.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { calibration } = await importLibs(["calibration"]);
const {
  EQUIPMENT_STATUSES, EQUIPMENT_STATUS_HELP, CALIBRATION_RESULTS, CALIBRATION_RESULT_HELP,
  DEFAULT_WARNING_DAYS, equipmentState, checkIssue, expiryFrom,
  summariseCalibration, calibrationVerdict, rankEquipment,
} = calibration;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

const TODAY = new Date("2026-09-15T00:00:00.000Z");
const gear = (o = {}) => ({
  id: o.id ?? "e1",
  serialNo: o.serialNo ?? "TW-001",
  description: o.description ?? "Torque wrench 40-200Nm",
  status: o.status ?? "In service",
  requiresCalibration: o.requiresCalibration ?? true,
  latest: o.latest === undefined
    ? { result: "Passed", validTo: "2027-01-01", calibratedOn: "2026-01-01" }
    : o.latest,
});

/* ================================================== what the words mean == */

ok("every status is explained in plain English",
  EQUIPMENT_STATUSES.every((s) => (EQUIPMENT_STATUS_HELP[s] || "").length > 25), EQUIPMENT_STATUSES.join(", "));
ok("and both calibration outcomes too",
  CALIBRATION_RESULTS.every((r) => (CALIBRATION_RESULT_HELP[r] || "").length > 25));
ok("a month is the default warning", DEFAULT_WARNING_DAYS === 30);

/* ==================================================== in date, or not === */

{
  const s = equipmentState(gear(), TODAY);
  ok("equipment with a valid certificate is available", s.available === true && s.reason === "");
  ok("  and says how long it has", s.daysToExpiry === 108, String(s.daysToExpiry));
  ok("  without being flagged as due", s.expiringSoon === false && s.expired === false);
}

/**
 * INV-13. The day the certificate lapses, the equipment is blocked — with
 * nobody having set anything.
 */
{
  const lapses = gear({ latest: { result: "Passed", validTo: "2026-09-14" } });
  const s = equipmentState(lapses, TODAY);
  ok("a certificate that expired yesterday blocks it", s.available === false);
  ok("  and it is marked expired", s.expired === true);
  ok("  saying how long ago", /expired 1 day ago/.test(s.reason), s.reason);
  ok("  and what to do about it", /Send it for calibration/.test(s.reason));
}
{
  // The boundary. A certificate valid to today is still valid today.
  const s = equipmentState(gear({ latest: { result: "Passed", validTo: "2026-09-15" } }), TODAY);
  ok("a certificate expiring today is still good today", s.available === true);
  ok("  with nothing left to run", s.daysToExpiry === 0);
  ok("  and flagged as due", s.expiringSoon === true);
}
{
  const s = equipmentState(gear({ latest: { result: "Passed", validTo: "2026-10-10" } }), TODAY);
  ok("one due inside the warning window is flagged", s.expiringSoon === true && s.available === true,
    "still usable, but somebody should be booking it in");
}
{
  const s = equipmentState(gear({ latest: { result: "Passed", validTo: "2026-10-20" } }), TODAY);
  ok("one beyond the window is not", s.expiringSoon === false, String(s.daysToExpiry));
}
{
  const s = equipmentState(gear({ latest: { result: "Passed", validTo: "2026-10-20" } }), TODAY, 60);
  ok("and the window is configurable", s.expiringSoon === true, "35 days, against a 60-day warning");
}

/* ========================================= the other ways it is blocked = */

{
  const s = equipmentState(gear({ latest: { result: "Failed", validTo: "2027-01-01" } }), TODAY);
  ok("a failed calibration blocks it, whatever the dates say", s.available === false);
  ok("  and says it has to be put right first",
    /adjusted or repaired and calibrated again/.test(s.reason), s.reason);
}
{
  const s = equipmentState(gear({ latest: null }), TODAY);
  ok("equipment that has never been calibrated is blocked", s.available === false);
  ok("  and flagged separately from expired", s.neverCalibrated === true && s.expired === false);
}
{
  const s = equipmentState(gear({ latest: { result: "Passed", validTo: null } }), TODAY);
  ok("a certificate with no expiry blocks it", s.available === false);
  ok("  because nobody can say whether it is in date",
    /nobody can say whether it is still in date/.test(s.reason), s.reason);
}

/**
 * Where it is beats what its paperwork says.
 */
for (const [status, phrase] of [
  ["Out for calibration", "away being calibrated"],
  ["Under repair", "under repair"],
  ["Withdrawn", "withdrawn from service"],
]) {
  const s = equipmentState(gear({ status }), TODAY);
  ok(`${status.toLowerCase()} blocks it even with a valid certificate`, s.available === false);
  ok(`  saying why`, new RegExp(phrase).test(s.reason), s.reason);
}

ok("equipment that needs no calibration is simply available",
  equipmentState(gear({ requiresCalibration: false, latest: null }), TODAY).available === true,
  "a shovel has no certificate and needs none");

/* ================================================== signing it out ====== */

{
  const r = checkIssue(gear({ latest: { result: "Passed", validTo: "2026-09-01" } }), "TW-001", TODAY);
  ok("an expired instrument cannot be signed out", r.ok === false);
  ok("  and the refusal names it and the reason",
    /TW-001 cannot be issued/.test(r.error) && /expired 14 days ago/.test(r.error), r.error);
}
ok("an in-date one can be", checkIssue(gear(), "TW-001", TODAY).ok === true);

/* ============================================ when the next one runs to = */

/**
 * From the calibration date, not from today. Counting from today would extend
 * every certificate by however long the paperwork took to come back.
 */
ok("a year from the calibration date",
  expiryFrom("2026-01-15", 12).toISOString().slice(0, 10) === "2027-01-15");
ok("six months", expiryFrom("2026-01-15", 6).toISOString().slice(0, 10) === "2026-07-15");

/**
 * The 31st of a month that the target month does not have. Rolling into the
 * next month would hand out a certificate a few days longer than it should be.
 */
ok("a month-end date does not roll into the next month",
  expiryFrom("2026-01-31", 1).toISOString().slice(0, 10) === "2026-02-28",
  "not 3 March, which is where a naive month add lands");
ok("  and a leap February is respected",
  expiryFrom("2028-01-31", 1).toISOString().slice(0, 10) === "2028-02-29");
ok("a period of nothing is still a month", expiryFrom("2026-01-15", 0).toISOString().slice(0, 10) === "2026-02-15");

/* ======================================================== the register = */

const fleet = [
  gear({ id: "a", serialNo: "TW-001", latest: { result: "Passed", validTo: "2026-09-01" } }),   // expired
  gear({ id: "b", serialNo: "PG-002", latest: { result: "Passed", validTo: "2026-10-01" } }),   // soon
  gear({ id: "c", serialNo: "WM-003", latest: { result: "Passed", validTo: "2027-06-01" } }),   // fine
  gear({ id: "d", serialNo: "LA-004", latest: null }),                                          // never
  gear({ id: "e", serialNo: "TW-005", status: "Out for calibration" }),                          // away
];
const t = summariseCalibration(fleet, TODAY);

ok("every item is counted", t.equipment === 5);
ok("the expired one is found", t.expired === 1);
ok("the one due soon is found", t.expiringSoon === 1);
ok("the never-calibrated one is found", t.neverCalibrated === 1);
ok("the one away is found", t.outForCalibration === 1);
/**
 * Due soon does not block. PG-002 lapses in a fortnight and is still perfectly
 * usable today — warning somebody is the point, not stopping them.
 */
ok("two are available", t.available === 2, "the one with months to run, and the one due soon");
ok("  because due soon is a warning, not a block",
  equipmentState(fleet[1], TODAY).available === true && equipmentState(fleet[1], TODAY).expiringSoon === true);
ok("  and the other three are blocked", t.blocked === 3,
  "expired, never calibrated, and away being calibrated");

/* ======================================================== the sentence = */

ok("an empty register says what to add", /Add the tools and instruments/.test(calibrationVerdict([])));

{
  const v = calibrationVerdict(fleet, TODAY);
  ok("expired equipment leads the sentence", /out of calibration and blocked/.test(v), v);
  ok("  and says why it matters most",
    /Anything measured with them since they lapsed is worth checking/.test(v),
    "somebody may already have used it believing it was fine");
}
{
  const v = calibrationVerdict([fleet[3]], TODAY);
  ok("never calibrated comes next", /has never had one recorded/.test(v), v);
}
{
  const v = calibrationVerdict([fleet[1]], TODAY);
  ok("then what is due soon", /due for calibration within 30 days/.test(v), v);
}
{
  const v = calibrationVerdict([fleet[4]], TODAY);
  ok("then what is away", /away being calibrated/.test(v), v);
}
{
  const v = calibrationVerdict([fleet[2]], TODAY);
  ok("and a clean register says so", /in date and available/.test(v), v);
  ok("  reading as one when there is one", /All 1 item are|All 1 item is/.test(v) === false || /All 1 item/.test(v), v);
}

/* ========================================================== the order == */

{
  const ranked = rankEquipment(fleet, TODAY);
  ok("the expired one leads", ranked[0].id === "a");
  ok("  then the one never calibrated", ranked[1].id === "d");
  ok("  and the one with months to run is last", ranked[4].id === "c");
}

/* ==================================================== how it is written = */

const src = read("src/lib/calibration.ts");
ok("the block is derived, never stored",
  /never stored/.test(src) && !/isBlocked/.test(src),
  "a flag is wrong on exactly the day it matters");
ok("and the file says why that matters",
  /not a reading/.test(src) && /It is a number/.test(src),
  "the distinction only surfaces when a client's inspector asks for the certificate");

/* ============================== boundaries, found by mutation testing == */

{
  const s = equipmentState({
    status: "In service", requiresCalibration: true,
    latest: { result: "Passed", validTo: new Date(Date.now() + 30 * 86400000) },
  });
  ok("a certificate expiring exactly on the warning boundary is warned about",
    s.expiringSoon === true, `${s.daysToExpiry} days`);
}

{
  const s = equipmentState({
    status: "In service", requiresCalibration: true,
    latest: { result: "Passed", validTo: new Date(Date.now() + 31 * 86400000) },
  });
  ok("  and one day further out is not", s.expiringSoon === false, `${s.daysToExpiry} days`);
}

/*
 * The rule is wired to the thing that actually sends a wrench to site.
 *
 * checkIssue was written, tested, and shown on the register as "blocked from
 * use" — and called from nowhere. Equipment is put on a job by filling in the
 * job field on its record, and that action validated the serial, the status,
 * the job and the store, and never once looked at the certificate. So the one
 * rule the module exists for was decoration: a torque wrench months out of
 * calibration went to site by typing, and a client's inspector would find it
 * before anybody here did.
 *
 * Checked as text because a server action needs a request behind it, and text
 * is worth more than nothing for a rule that was missing entirely.
 */
{
  const actions = fs.readFileSync("src/app/(app)/inventory/actions.ts", "utf8");
  ok("the equipment action imports the calibration check",
    /checkIssue as checkEquipmentIssue/.test(actions));
  ok("  and calls it before putting equipment on a job",
    /if \(jobId && requiresCalibration && status === "In service"\)/.test(actions) &&
      /checkEquipmentIssue\(/.test(actions));
  ok("  refusing the save rather than warning",
    /if \(!permitted\.ok\) return \{ ok: false, error: permitted\.error \};/.test(actions));
  ok("  and still letting a lapsed item be recorded where it physically is",
    /Only the move to a job is refused/.test(actions),
    "the register has to keep matching the yard");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
