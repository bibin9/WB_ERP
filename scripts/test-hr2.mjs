/**
 * HR extended test suite — Attendance, Timesheets, Certifications, Medical,
 * Performance, Supplied manpower. Run: node scripts/test-hr2.mjs
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
let pass = 0, fail = 0;
function ok(id, name, cond, detail = "") {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "✅" : "❌"} ${id}  ${name}${detail ? "  — " + detail : ""}`);
}
function expiryState(d) {
  if (!d) return "No expiry";
  const days = Math.ceil((new Date(d) - Date.now()) / 86400000);
  if (days < 0) return "Expired";
  if (days <= 30) return "Expiring";
  return "Valid";
}

async function main() {
  const tenant = await db.tenant.findUnique({ where: { key: "wandb" } });
  const wbe = await db.company.findFirst({ where: { tenantId: tenant.id, code: "WBE" } });
  const emp = await db.employee.findFirst({ where: { companyId: wbe.id, employmentType: { not: "Supplied" } } });

  // ===== ATTENDANCE =====
  const date = new Date("2099-03-15");
  await db.attendance.deleteMany({ where: { employeeId: emp.id, date } });
  const att = await db.attendance.create({ data: { companyId: wbe.id, employeeId: emp.id, date, status: "Present", hours: 8 } });
  ok("HR-A1", "Attendance CREATE", att.status === "Present" && att.hours === 8);
  // upsert (same employee+date) updates, not duplicates
  await db.attendance.upsert({ where: { employeeId_date: { employeeId: emp.id, date } }, update: { status: "Half-day", hours: 4 }, create: { companyId: wbe.id, employeeId: emp.id, date, status: "x", hours: 0 } });
  const attCount = await db.attendance.count({ where: { employeeId: emp.id, date } });
  ok("HR-A2", "Attendance upsert (unique per employee+date, no dupes)", attCount === 1 && (await db.attendance.findFirst({ where: { employeeId: emp.id, date } })).status === "Half-day");
  await db.attendance.delete({ where: { id: att.id } });

  // ===== TIMESHEETS =====
  const ts = await db.timesheet.create({ data: { companyId: wbe.id, employeeId: emp.id, date: new Date("2099-03-15"), projectRef: "PRJ-TEST", hours: 6 } });
  ok("HR-T1", "Timesheet CREATE against Project ID", ts.projectRef === "PRJ-TEST" && ts.hours === 6);
  await db.timesheet.delete({ where: { id: ts.id } });
  ok("HR-T2", "Timesheet DELETE", !(await db.timesheet.findUnique({ where: { id: ts.id } })));

  // ===== CERTIFICATIONS + expiry states =====
  const soon = new Date(Date.now() + 15 * 86400000);
  const past = new Date(Date.now() - 5 * 86400000);
  const far = new Date(Date.now() + 400 * 86400000);
  const c1 = await db.certification.create({ data: { companyId: wbe.id, employeeId: emp.id, name: "TEST Cert Soon", category: "Safety", expiryDate: soon } });
  const c2 = await db.certification.create({ data: { companyId: wbe.id, employeeId: emp.id, name: "TEST Cert Past", category: "Competency", expiryDate: past } });
  const c3 = await db.certification.create({ data: { companyId: wbe.id, employeeId: emp.id, name: "TEST Cert Far", category: "Safety", expiryDate: far } });
  ok("HR-C1", "Certification CREATE", !!c1.id);
  ok("HR-C2", "Expiry state: within 30d → Expiring", expiryState(soon) === "Expiring");
  ok("HR-C3", "Expiry state: past date → Expired", expiryState(past) === "Expired");
  ok("HR-C4", "Expiry state: >30d → Valid", expiryState(far) === "Valid");
  // alert query: certs expiring within 30 days (incl. expired)
  const in30 = new Date(Date.now() + 30 * 86400000);
  const alertCerts = await db.certification.findMany({ where: { companyId: wbe.id, employeeId: emp.id, expiryDate: { not: null, lte: in30 } } });
  ok("HR-C5", "Expiry alert query returns soon+expired, not far", alertCerts.some((c) => c.id === c1.id) && alertCerts.some((c) => c.id === c2.id) && !alertCerts.some((c) => c.id === c3.id));

  // ===== MEDICAL (category) =====
  const med = await db.certification.create({ data: { companyId: wbe.id, employeeId: emp.id, name: "TEST Medical", category: "Medical", expiryDate: soon } });
  ok("HR-M1", "Medical clearance stored (category = Medical)", med.category === "Medical");
  await db.certification.deleteMany({ where: { id: { in: [c1.id, c2.id, c3.id, med.id] } } });

  // ===== PERFORMANCE / APPRAISAL =====
  const ap = await db.appraisal.create({ data: { companyId: wbe.id, employeeId: emp.id, period: "2099 H1", rating: 4, feedback: "Good", reviewedBy: "Tester" } });
  ok("HR-PF1", "Appraisal CREATE with rating 1–5", ap.rating === 4);
  await db.appraisal.delete({ where: { id: ap.id } });
  ok("HR-PF2", "Appraisal DELETE", !(await db.appraisal.findUnique({ where: { id: ap.id } })));

  // ===== SUPPLIED MANPOWER =====
  const supplied = await db.employee.findFirst({ where: { companyId: wbe.id, employmentType: "Supplied" } });
  ok("HR-S1", "Supplied worker registered (employmentType=Supplied)", !!supplied);
  ok("HR-S2", "Supplied worker has a supplier/sponsor", !!(supplied && supplied.supplier), supplied?.supplier || "");

  console.log("\n" + "=".repeat(50));
  console.log(`HR-EXT RESULTS:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
  console.log("=".repeat(50));
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
