import "server-only";

/**
 * Universal punch-machine log parser. Biometric devices (ZKTeco, eSSL, Matrix, Suprema…)
 * all export a delimited log of "who punched, when". Rather than lock to one brand, we
 * parse flexibly: detect the delimiter, find the enrolment-ID column and the timestamp,
 * and aggregate punches into first-in / last-out per employee per day.
 */

export type Punch = { deviceId: string; ts: Date };
export type DayPunch = { deviceId: string; ymd: string; firstIn: Date; lastOut: Date; count: number };

const DELIMS = [",", "\t", ";", "|"];

function pickDelim(line: string): string {
  let best = ",", bestCount = -1;
  for (const d of DELIMS) {
    const c = line.split(d).length;
    if (c > bestCount) { bestCount = c; best = d; }
  }
  return best;
}

/** Parse many date/time formats punch machines emit. Returns null if not a timestamp. */
export function parseTs(dateCell: string, timeCell?: string): Date | null {
  let s = (dateCell || "").trim();
  if (timeCell) s = `${s} ${timeCell.trim()}`;
  if (!s) return null;

  // Native ISO / "YYYY-MM-DD HH:mm:ss"
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) {
    const d = new Date(s.replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }
  // "DD/MM/YYYY HH:mm[:ss]" or "DD-MM-YYYY ..." (day-first — the UAE norm)
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let [, dd, mm, yy, hh, mi, ss] = m;
    let year = Number(yy); if (year < 100) year += 2000;
    const d = new Date(year, Number(mm) - 1, Number(dd), Number(hh || 0), Number(mi || 0), Number(ss || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const looksLikeTime = (s: string) => /\d{1,2}:\d{2}/.test(s);
const looksLikeDate = (s: string) => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(s);

/** Extract raw punches from an uploaded log's text. Best-effort, header-aware with a fallback. */
export function parsePunchLog(text: string): { punches: Punch[]; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { punches: [], skipped: 0 };

  const delim = pickDelim(lines[0]);
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));

  // Header detection: a first row with no timestamp cells is treated as a header
  const first = rows[0];
  const headerIsData = first.some((c) => looksLikeTime(c) || looksLikeDate(c));
  let idIdx = -1, dateIdx = -1, timeIdx = -1, dtIdx = -1, dataStart = 0;

  if (!headerIsData) {
    dataStart = 1;
    const h = first.map((c) => c.toLowerCase());
    const find = (re: RegExp) => h.findIndex((c) => re.test(c));
    idIdx = find(/enroll|ac-?no|user\s?id|userid|badge|\bpin\b|emp.*(id|no)|^id$|^no$/);
    dtIdx = find(/date.?time|punch.?time|timestamp/);
    if (dtIdx < 0) { dateIdx = find(/date/); timeIdx = find(/time/); }
  }

  const punches: Punch[] = [];
  let skipped = 0;
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 0 || r.every((c) => !c)) continue;

    // Resolve device id
    let deviceId = idIdx >= 0 ? r[idIdx] : r[0];

    // Resolve timestamp
    let ts: Date | null = null;
    if (dtIdx >= 0) ts = parseTs(r[dtIdx]);
    else if (dateIdx >= 0) ts = parseTs(r[dateIdx], timeIdx >= 0 ? r[timeIdx] : undefined);
    else {
      // Fallback: find a date cell and a time cell (or one combined cell)
      const dateCell = r.find(looksLikeDate);
      const timeCell = r.find((c) => looksLikeTime(c) && c !== dateCell);
      if (dateCell && /\d/.test(dateCell) && looksLikeTime(dateCell)) ts = parseTs(dateCell);
      else if (dateCell) ts = parseTs(dateCell, timeCell);
      // device id in fallback = first cell that isn't the date/time
      if (!idIdx && deviceId === dateCell) deviceId = r.find((c) => c !== dateCell && c !== timeCell) ?? deviceId;
    }

    if (!deviceId || !ts) { skipped++; continue; }
    punches.push({ deviceId: String(deviceId).trim(), ts });
  }
  return { punches, skipped };
}

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Collapse raw punches into one row per (device id, day): first-in, last-out, punch count. */
export function aggregateDaily(punches: Punch[]): DayPunch[] {
  const map = new Map<string, DayPunch>();
  for (const p of punches) {
    const ymd = ymdOf(p.ts);
    const key = `${p.deviceId}|${ymd}`;
    const cur = map.get(key);
    if (!cur) map.set(key, { deviceId: p.deviceId, ymd, firstIn: p.ts, lastOut: p.ts, count: 1 });
    else {
      if (p.ts < cur.firstIn) cur.firstIn = p.ts;
      if (p.ts > cur.lastOut) cur.lastOut = p.ts;
      cur.count++;
    }
  }
  return Array.from(map.values());
}

/** Worked hours + attendance status from a day's punches. */
export function dayToAttendance(d: DayPunch): { hours: number; status: string } {
  const ms = d.lastOut.getTime() - d.firstIn.getTime();
  const hours = Math.round((ms / 3_600_000) * 10) / 10;
  if (d.count < 2 || hours <= 0) return { hours: 0, status: "Present" }; // single punch — present, hours unknown
  if (hours < 4) return { hours, status: "Half-day" };
  return { hours: Math.min(hours, 16), status: "Present" };
}
