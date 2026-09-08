"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parsePunchLog, aggregateDaily, dayToAttendance } from "@/lib/punch";
import { splitDayHours } from "@/lib/payroll";
import { withDefaults } from "@/lib/hrpolicy";
import { allow } from "@/lib/guard";
import { hourlyCostFor } from "@/lib/labour";
import { toFils } from "@/lib/money";

async function empInScope(employeeId: string) {
  const session = await getSession();
  if (!session) return null;
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return null;
  return emp;
}

export async function markAttendance(formData: FormData) {
  if (!(await allow("hr.attendance", "create"))) return;
  const employeeId = String(formData.get("employeeId") || "");
  const dateStr = String(formData.get("date") || "");
  const emp = await empInScope(employeeId);
  if (!emp || !dateStr) return;
  const date = new Date(dateStr);
  const status = String(formData.get("status") || "Present");
  const hours = Number(formData.get("hours")) || (status === "Present" ? 8 : status === "Half-day" ? 4 : 0);

  // Overtime entered by hand, for the days there are no punches for. The two
  // rates are kept apart because the law prices them differently: 125% for
  // ordinary hours, 150% for night work, a rest day or a public holiday.
  const otHours = Math.max(0, Number(formData.get("otHours")) || 0);
  const otPremiumHours = Math.max(0, Number(formData.get("otPremiumHours")) || 0);
  const remarks = String(formData.get("remarks") || "") || null;

  await db.attendance.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: { status, hours, otHours, otPremiumHours, remarks },
    create: { companyId: emp.companyId, employeeId, date, status, hours, otHours, otPremiumHours, remarks },
  });
  revalidatePath("/hr/attendance");
}

const HOURS_FOR = (s: string) => (s === "Present" ? 8 : s === "Half-day" ? 4 : 0);

// Exception-based bulk entry: save the whole site crew for one day in a single action.
export async function saveMuster(formData: FormData) {
  if (!(await allow("hr.attendance", "create"))) return;
  const session = await getSession();
  if (!session) return;
  const companyId = String(formData.get("companyId") || "");
  if (!session.companies.some((c) => c.id === companyId)) return;
  const dateStr = String(formData.get("date") || "");
  if (!dateStr) return;
  const date = new Date(dateStr);

  let marks: { employeeId: string; status: string }[] = [];
  try { marks = JSON.parse(String(formData.get("marks") || "[]")); } catch { return; }
  if (marks.length === 0) return;

  // Only allow employees that belong to this company
  const emps = await db.employee.findMany({ where: { id: { in: marks.map((m) => m.employeeId) }, companyId }, select: { id: true } });
  const valid = new Set(emps.map((e) => e.id));

  for (const m of marks) {
    if (!valid.has(m.employeeId)) continue;
    await db.attendance.upsert({
      where: { employeeId_date: { employeeId: m.employeeId, date } },
      update: { status: m.status, hours: HOURS_FOR(m.status) },
      create: { companyId, employeeId: m.employeeId, date, status: m.status, hours: HOURS_FOR(m.status) },
    });
  }
  const present = marks.filter((m) => m.status === "Present").length;
  await audit({ action: "Updated", entity: "Attendance", summary: `Muster ${dateStr}: ${marks.length} marked (${present} present)` });
  revalidatePath("/hr/attendance");
}

export type PunchImportResult = {
  ok: boolean;
  message: string;
  imported?: number;
  days?: number;
  skipped?: number;
  unmatched?: string[];
};

// Universal punch-machine import: upload the device's exported log, map by biometric ID, create attendance.
export async function importPunchLog(companyId: string, formData: FormData): Promise<PunchImportResult> {
  if (!(await allow("hr.attendance", "create"))) return { ok: false, message: "Not authorised" };
  const session = await getSession();
  if (!session || !session.companies.some((c) => c.id === companyId)) return { ok: false, message: "No access to this company." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a punch-log file to upload." };
  if (file.size > 5_000_000) return { ok: false, message: "File too large (max 5 MB)." };

  const text = await file.text();
  const { punches, skipped } = parsePunchLog(text);
  if (punches.length === 0) return { ok: false, message: "No punches found. Expected a CSV/text log with an ID column and a date/time.", skipped };

  const days = aggregateDaily(punches);

  // Map device biometric ID → employee (this company only)
  const emps = await db.employee.findMany({ where: { companyId, biometricId: { not: null } }, select: { id: true, biometricId: true } });
  const byBio = new Map(emps.map((e) => [String(e.biometricId), e.id]));

  // A company whose normal day is not eight hours splits overtime differently.
  const policy = withDefaults(await db.hrPolicy.findUnique({ where: { companyId } }));

  let imported = 0;
  const unmatched = new Set<string>();
  for (const d of days) {
    const employeeId = byBio.get(d.deviceId);
    if (!employeeId) { unmatched.add(d.deviceId); continue; }
    const { hours, status } = dayToAttendance(d);
    // The punches already say how long the man was on site, so the overtime is
    // there to be read rather than re-keyed from a paper sheet — and because
    // the in and out times are known, the hours that fall between 22:00 and
    // 04:00 can be priced at the higher rate without anyone deciding.
    const split = splitDayHours(hours, d.firstIn, d.lastOut, policy);
    const date = new Date(d.ymd);
    const window = `${d.firstIn.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${d.lastOut.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    const ot = split.ot + split.otPremium;
    const remarks = `Punch: ${window}${ot > 0 ? ` · ${ot}h OT${split.otPremium > 0 ? ` (${split.otPremium}h night)` : ""}` : ""}`;
    await db.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      update: { status, hours, firstIn: d.firstIn, lastOut: d.lastOut, otHours: split.ot, otPremiumHours: split.otPremium, remarks },
      create: { companyId, employeeId, date, status, hours, firstIn: d.firstIn, lastOut: d.lastOut, otHours: split.ot, otPremiumHours: split.otPremium, remarks },
    });
    imported++;
  }

  await audit({ action: "Updated", entity: "Attendance", summary: `Punch import: ${imported} day-records from ${punches.length} punches (${unmatched.size} unmatched IDs)` });
  revalidatePath("/hr/attendance");

  const parts = [`Imported ${imported} attendance day(s) from ${punches.length} punches.`];
  if (unmatched.size) parts.push(`${unmatched.size} device ID(s) had no matching employee.`);
  if (skipped) parts.push(`${skipped} unreadable row(s) skipped.`);
  return { ok: true, message: parts.join(" "), imported, days: days.length, skipped, unmatched: Array.from(unmatched) };
}

export async function deleteAttendance(id: string) {
  if (!(await allow("hr.attendance", "delete"))) return;
  const session = await getSession();
  if (!session) return;
  const a = await db.attendance.findUnique({ where: { id } });
  if (!a || !session.companies.some((c) => c.id === a.companyId)) return;
  await db.attendance.delete({ where: { id } });
  revalidatePath("/hr/attendance");
}

export async function addTimesheet(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.attendance", "create"))) return { ok: false, error: "Not authorised" };
  const employeeId = String(formData.get("employeeId") || "");
  const emp = await empInScope(employeeId);
  const dateStr = String(formData.get("date") || "");
  const hours = Number(formData.get("hours")) || 0;
  if (!emp) return { ok: false, error: "That employee is not in your companies" };
  if (!dateStr) return { ok: false, error: "Pick a date" };
  if (hours <= 0) return { ok: false, error: "Enter the hours worked" };
  if (hours > 24) return { ok: false, error: "That is more than a day — check the hours" };

  // The job has to be a real one, and in the same company, or the cost would
  // land on another company's contract when the hours are absorbed.
  const jobId = String(formData.get("jobId") || "").trim() || null;
  if (jobId && !(await db.job.findFirst({ where: { id: jobId, companyId: emp.companyId } }))) {
    return { ok: false, error: "That job is not in this company" };
  }

  // The rate is taken now and stored on the row. Deriving it on read would mean
  // a pay rise silently rewrote the cost of work done last year.
  const costRate = toFils(hourlyCostFor(emp));

  await db.timesheet.create({
    data: {
      companyId: emp.companyId, employeeId, date: new Date(dateStr), jobId, hours, costRate,
      projectRef: String(formData.get("projectRef") || "").trim() || null,
      notes: String(formData.get("notes") || "") || null,
    },
  });
  await audit({
    action: "Created",
    entity: "Timesheet",
    summary: `${emp.name} logged ${hours}h${jobId ? " to a job" : " with no job"} at ${costRate.toFixed(2)}/h`,
  });
  revalidatePath("/hr/attendance");
  return { ok: true };
}

export async function deleteTimesheet(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.attendance", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const t = await db.timesheet.findUnique({ where: { id } });
  if (!t || !session.companies.some((c) => c.id === t.companyId)) return { ok: false, error: "Not found" };
  // Once the hours are on a voucher, deleting the row would leave the ledger
  // charging a job for time that no longer exists. Reverse the voucher instead.
  if (t.entryId) {
    return { ok: false, error: "This time is already charged to a job. Reverse that voucher in the Day Book first." };
  }
  await db.timesheet.delete({ where: { id } });
  revalidatePath("/hr/attendance");
  return { ok: true };
}
