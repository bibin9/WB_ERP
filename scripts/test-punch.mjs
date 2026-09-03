// Verifies the punch-log import pipeline (same algorithm as src/lib/punch.ts) end-to-end against the DB.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const db = new PrismaClient();

// --- parser (mirrors src/lib/punch.ts) ---
const DELIMS = [",", "\t", ";", "|"];
const pickDelim = (line) => DELIMS.reduce((b, d) => (line.split(d).length > line.split(b).length ? d : b), ",");
function parseTs(dateCell, timeCell) {
  let s = (dateCell || "").trim();
  if (timeCell) s = `${s} ${timeCell.trim()}`;
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) { const d = new Date(s.replace(" ", "T")); return isNaN(d) ? null : d; }
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) { let [, dd, mm, yy, hh, mi, ss] = m; let y = +yy; if (y < 100) y += 2000; const d = new Date(y, +mm - 1, +dd, +(hh||0), +(mi||0), +(ss||0)); return isNaN(d) ? null : d; }
  return null;
}
const looksLikeTime = (s) => /\d{1,2}:\d{2}/.test(s);
const looksLikeDate = (s) => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(s);
function parsePunchLog(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { punches: [], skipped: 0 };
  const delim = pickDelim(lines[0]);
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
  const first = rows[0];
  const headerIsData = first.some((c) => looksLikeTime(c) || looksLikeDate(c));
  let idIdx = -1, dateIdx = -1, timeIdx = -1, dtIdx = -1, dataStart = 0;
  if (!headerIsData) {
    dataStart = 1;
    const h = first.map((c) => c.toLowerCase());
    const find = (re) => h.findIndex((c) => re.test(c));
    idIdx = find(/enroll|ac-?no|user\s?id|userid|badge|\bpin\b|emp.*(id|no)|^id$|^no$/);
    dtIdx = find(/date.?time|punch.?time|timestamp/);
    if (dtIdx < 0) { dateIdx = find(/date/); timeIdx = find(/time/); }
  }
  const punches = []; let skipped = 0;
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i]; if (!r.length || r.every((c) => !c)) continue;
    let deviceId = idIdx >= 0 ? r[idIdx] : r[0];
    let ts = null;
    if (dtIdx >= 0) ts = parseTs(r[dtIdx]);
    else if (dateIdx >= 0) ts = parseTs(r[dateIdx], timeIdx >= 0 ? r[timeIdx] : undefined);
    if (!deviceId || !ts) { skipped++; continue; }
    punches.push({ deviceId: String(deviceId).trim(), ts });
  }
  return { punches, skipped };
}
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function aggregateDaily(punches) {
  const map = new Map();
  for (const p of punches) {
    const key = `${p.deviceId}|${ymdOf(p.ts)}`;
    const cur = map.get(key);
    if (!cur) map.set(key, { deviceId: p.deviceId, ymd: ymdOf(p.ts), firstIn: p.ts, lastOut: p.ts, count: 1 });
    else { if (p.ts < cur.firstIn) cur.firstIn = p.ts; if (p.ts > cur.lastOut) cur.lastOut = p.ts; cur.count++; }
  }
  return [...map.values()];
}
function dayToAttendance(d) {
  const hours = Math.round(((d.lastOut - d.firstIn) / 3600000) * 10) / 10;
  if (d.count < 2 || hours <= 0) return { hours: 0, status: "Present" };
  if (hours < 4) return { hours, status: "Half-day" };
  return { hours: Math.min(hours, 16), status: "Present" };
}

// --- run ---
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)));

const text = readFileSync("C:/Bibin/sample_punch_log.csv", "utf8");
const { punches, skipped } = parsePunchLog(text);
console.log(`Parsed ${punches.length} punches, ${skipped} skipped`);
ok(punches.length === 19, "19 punches parsed from sample");

const days = aggregateDaily(punches);
ok(days.length === 9, `9 day-records aggregated (got ${days.length})`);

const rajesh1 = days.find((d) => d.deviceId === "101" && d.ymd === "2026-09-01");
ok(rajesh1 && dayToAttendance(rajesh1).hours === 9.1, `Rajesh 01/09 = 9.1h Present (07:58->17:05) got ${rajesh1 && dayToAttendance(rajesh1).hours}`);
const maria = days.find((d) => d.deviceId === "103");
ok(maria && dayToAttendance(maria).status === "Half-day", `Maria = Half-day (~4h) got ${maria && dayToAttendance(maria).status}`);
const john = days.find((d) => d.deviceId === "104");
ok(john && john.count === 1 && dayToAttendance(john).status === "Present", "John single punch = Present, 0h");

const wbe = await db.company.findFirst({ where: { code: "WBE" } });
const emps = await db.employee.findMany({ where: { companyId: wbe.id, biometricId: { not: null } }, select: { id: true, name: true, biometricId: true } });
const byBio = new Map(emps.map((e) => [String(e.biometricId), e]));
ok(byBio.size >= 5, `${byBio.size} employees have biometric IDs mapped`);

let imported = 0; const unmatched = new Set();
for (const d of days) {
  const emp = byBio.get(d.deviceId);
  if (!emp) { unmatched.add(d.deviceId); continue; }
  const { hours, status } = dayToAttendance(d);
  const date = new Date(d.ymd);
  await db.attendance.upsert({
    where: { employeeId_date: { employeeId: emp.id, date } },
    update: { status, hours, remarks: `Punch: ${d.firstIn.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}-${d.lastOut.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}` },
    create: { companyId: wbe.id, employeeId: emp.id, date, status, hours, remarks: `Punch import` },
  });
  imported++;
}
ok(imported === 8, `8 day-records imported (got ${imported})`);
ok(unmatched.has("999") && unmatched.size === 1, `device ID 999 reported unmatched (got ${[...unmatched].join(",")})`);

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
