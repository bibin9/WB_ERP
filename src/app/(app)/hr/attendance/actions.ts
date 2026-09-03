"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parsePunchLog, aggregateDaily, dayToAttendance } from "@/lib/punch";

async function empInScope(employeeId: string) {
  const session = await getSession();
  if (!session) return null;
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return null;
  return emp;
}

export async function markAttendance(formData: FormData) {
  const employeeId = String(formData.get("employeeId") || "");
  const dateStr = String(formData.get("date") || "");
  const emp = await empInScope(employeeId);
  if (!emp || !dateStr) return;
  const date = new Date(dateStr);
  const status = String(formData.get("status") || "Present");
  const hours = Number(formData.get("hours")) || (status === "Present" ? 8 : status === "Half-day" ? 4 : 0);
  await db.attendance.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: { status, hours, remarks: String(formData.get("remarks") || "") || null },
    create: { companyId: emp.companyId, employeeId, date, status, hours, remarks: String(formData.get("remarks") || "") || null },
  });
  revalidatePath("/hr/attendance");
}

const HOURS_FOR = (s: string) => (s === "Present" ? 8 : s === "Half-day" ? 4 : 0);

// Exception-based bulk entry: save the whole site crew for one day in a single action.
export async function saveMuster(formData: FormData) {
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

  let imported = 0;
  const unmatched = new Set<string>();
  for (const d of days) {
    const employeeId = byBio.get(d.deviceId);
    if (!employeeId) { unmatched.add(d.deviceId); continue; }
    const { hours, status } = dayToAttendance(d);
    const date = new Date(d.ymd);
    await db.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      update: { status, hours, remarks: `Punch: ${d.firstIn.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${d.lastOut.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` },
      create: { companyId, employeeId, date, status, hours, remarks: `Punch: ${d.firstIn.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${d.lastOut.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` },
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
  const session = await getSession();
  if (!session) return;
  const a = await db.attendance.findUnique({ where: { id } });
  if (!a || !session.companies.some((c) => c.id === a.companyId)) return;
  await db.attendance.delete({ where: { id } });
  revalidatePath("/hr/attendance");
}

export async function addTimesheet(formData: FormData) {
  const employeeId = String(formData.get("employeeId") || "");
  const emp = await empInScope(employeeId);
  const dateStr = String(formData.get("date") || "");
  const projectRef = String(formData.get("projectRef") || "").trim();
  const hours = Number(formData.get("hours")) || 0;
  if (!emp || !dateStr || !projectRef || hours <= 0) return;
  await db.timesheet.create({
    data: { companyId: emp.companyId, employeeId, date: new Date(dateStr), projectRef, hours, notes: String(formData.get("notes") || "") || null },
  });
  await audit({ action: "Created", entity: "Timesheet", summary: `${emp.name} logged ${hours}h to ${projectRef}` });
  revalidatePath("/hr/attendance");
}

export async function deleteTimesheet(id: string) {
  const session = await getSession();
  if (!session) return;
  const t = await db.timesheet.findUnique({ where: { id } });
  if (!t || !session.companies.some((c) => c.id === t.companyId)) return;
  await db.timesheet.delete({ where: { id } });
  revalidatePath("/hr/attendance");
}
