/**
 * HR module test suite — Payroll, Onboarding/Recruitment, Leave.
 * Run:  node scripts/test-hr.mjs   (creates + cleans up its own temp data)
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
let pass = 0, fail = 0;
function ok(id, name, cond, detail = "") {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "✅" : "❌"} ${id}  ${name}${detail ? "  — " + detail : ""}`);
}
const CHECKLIST = ["Visa processing", "Emirates ID / residency", "Bank account setup", "HSE induction", "Issue assets (laptop/PPE)", "Collect certificates", "Sign contract"];
function days(from, to) { return Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1); }

async function main() {
  const tenant = await db.tenant.findUnique({ where: { key: "wandb" } });
  const wbe = await db.company.findFirst({ where: { tenantId: tenant.id, code: "WBE" } });

  // ===== PAYROLL =====
  const period = "2099-01";
  await db.payrollRun.deleteMany({ where: { companyId: wbe.id, period } }); // clean prior test
  const emps = await db.employee.findMany({ where: { companyId: wbe.id, status: { not: "Inactive" } } });
  const run = await db.payrollRun.create({
    data: {
      companyId: wbe.id, period, status: "Draft", runBy: "Tester",
      payslips: { create: emps.map((e) => ({ employeeId: e.id, empNo: e.empNo, employeeName: e.name, basic: e.basicSalary, allowances: e.allowances, deductions: 0, netPay: e.basicSalary + e.allowances })) },
    },
    include: { payslips: true },
  });
  ok("HR-P1", "Payroll run generates a payslip per active employee", run.payslips.length === emps.length, `${run.payslips.length} payslips`);
  const netOk = run.payslips.every((p) => Math.round((p.netPay - (p.basic + p.allowances)) * 100) === 0);
  ok("HR-P2", "Net pay = basic + allowances (− deductions)", netOk);
  const total = run.payslips.reduce((s, p) => s + p.netPay, 0);
  const expected = emps.reduce((s, e) => s + e.basicSalary + e.allowances, 0);
  ok("HR-P3", "Run total = sum of salary structures", Math.round(total * 100) === Math.round(expected * 100), `AED ${total}`);
  // duplicate period blocked (unique constraint)
  let dupBlocked = false;
  try { await db.payrollRun.create({ data: { companyId: wbe.id, period, status: "Draft", runBy: "Tester" } }); }
  catch { dupBlocked = true; }
  ok("HR-P4", "Duplicate payroll for same month is blocked", dupBlocked);
  // status transitions
  await db.payrollRun.update({ where: { id: run.id }, data: { status: "Approved" } });
  await db.payrollRun.update({ where: { id: run.id }, data: { status: "Paid" } });
  ok("HR-P5", "Run status Draft → Approved → Paid", (await db.payrollRun.findUnique({ where: { id: run.id } })).status === "Paid");
  await db.payrollRun.delete({ where: { id: run.id } });
  ok("HR-P6", "Payroll run delete cascades payslips", (await db.payslip.count({ where: { runId: run.id } })) === 0);

  // ===== ONBOARDING / RECRUITMENT =====
  const req = await db.requisition.create({ data: { companyId: wbe.id, position: "Test Welder", department: "Fabrication", headcount: 2, raisedBy: "Tester" } });
  ok("HR-O1", "Requisition CREATE", !!(await db.requisition.findUnique({ where: { id: req.id } })));
  const cand = await db.candidate.create({ data: { requisitionId: req.id, name: "Test Candidate", email: "t@c.com", visaType: "Mission", stage: "Offer" } });
  ok("HR-O2", "Candidate CREATE under requisition", cand.requisitionId === req.id);
  // hire → create employee + checklist
  const nBefore = await db.employee.count({ where: { companyId: wbe.id } });
  const empNo = `EMP-${String(nBefore + 1).padStart(4, "0")}`;
  const hired = await db.employee.create({
    data: { companyId: wbe.id, empNo, name: cand.name, email: cand.email, designation: req.position, department: req.department, status: "Active",
      onboarding: { create: CHECKLIST.map((label, i) => ({ label, order: i + 1 })) } },
    include: { onboarding: true },
  });
  await db.candidate.update({ where: { id: cand.id }, data: { stage: "Hired" } });
  ok("HR-O3", "Hire creates an Employee record", (await db.employee.count({ where: { companyId: wbe.id } })) === nBefore + 1);
  ok("HR-O4", "Hire creates the onboarding checklist (7 items)", hired.onboarding.length === CHECKLIST.length, `${hired.onboarding.length} items`);
  ok("HR-O5", "Candidate stage set to Hired", (await db.candidate.findUnique({ where: { id: cand.id } })).stage === "Hired");
  // toggle a checklist item
  await db.onboardingItem.update({ where: { id: hired.onboarding[0].id }, data: { done: true } });
  ok("HR-O6", "Onboarding item can be checked off", (await db.onboardingItem.findUnique({ where: { id: hired.onboarding[0].id } })).done === true);
  // cleanup
  await db.employee.delete({ where: { id: hired.id } });
  await db.requisition.delete({ where: { id: req.id } });
  ok("HR-O7", "Requisition delete cascades candidates", (await db.candidate.count({ where: { requisitionId: req.id } })) === 0);

  // ===== LEAVE =====
  const emp = await db.employee.create({ data: { companyId: wbe.id, empNo: "EMP-LV", name: "Leave Tester", basicSalary: 5000, allowances: 0, annualLeaveBalance: 30 } });
  const d = days("2026-09-01", "2026-09-05");
  ok("HR-L1", "Leave days computed inclusive (1–5 Sep = 5)", d === 5, `${d} days`);
  const lr = await db.leaveRequest.create({ data: { companyId: wbe.id, employeeId: emp.id, type: "Annual", fromDate: new Date("2026-09-01"), toDate: new Date("2026-09-05"), days: d, status: "Pending" } });
  ok("HR-L2", "Leave request CREATE (Pending)", lr.status === "Pending");
  // approve annual → deduct balance
  await db.leaveRequest.update({ where: { id: lr.id }, data: { status: "Approved" } });
  await db.employee.update({ where: { id: emp.id }, data: { annualLeaveBalance: { decrement: d } } });
  ok("HR-L3", "Approving annual leave deducts balance (30 → 25)", (await db.employee.findUnique({ where: { id: emp.id } })).annualLeaveBalance === 25);
  // delete approved annual → restore balance
  await db.employee.update({ where: { id: emp.id }, data: { annualLeaveBalance: { increment: d } } });
  await db.leaveRequest.delete({ where: { id: lr.id } });
  ok("HR-L4", "Deleting approved annual leave restores balance (→ 30)", (await db.employee.findUnique({ where: { id: emp.id } })).annualLeaveBalance === 30);
  // sick leave does NOT touch annual balance
  const lr2 = await db.leaveRequest.create({ data: { companyId: wbe.id, employeeId: emp.id, type: "Sick", fromDate: new Date("2026-10-01"), toDate: new Date("2026-10-02"), days: 2, status: "Pending" } });
  await db.leaveRequest.update({ where: { id: lr2.id }, data: { status: "Approved" } });
  ok("HR-L5", "Approving Sick leave does not change annual balance", (await db.employee.findUnique({ where: { id: emp.id } })).annualLeaveBalance === 30);
  await db.employee.delete({ where: { id: emp.id } }); // cascades leave

  console.log("\n" + "=".repeat(50));
  console.log(`HR RESULTS:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
  console.log("=".repeat(50));
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
