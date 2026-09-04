// Verifies the UAE WPS SIF builder (mirrors src/lib/wps.ts).
const two = (n) => String(n).padStart(2, "0");
const amt = (n) => (Math.round(n * 100) / 100).toFixed(2);
function periodBounds(period) {
  const [y, m] = period.split("-").map(Number);
  return { start: `${y}-${two(m)}-01`, end: `${y}-${two(m)}-${two(new Date(y, m, 0).getDate())}`, days: new Date(y, m, 0).getDate(), salaryMonth: `${two(m)}${y}` };
}
function splitFixedVariable(basic, net) { const fixed = Math.min(basic, net); return { fixed, variable: Math.max(0, net - fixed) }; }
function buildSif(emp, employees, period, now) {
  const { start, end, salaryMonth } = periodBounds(period);
  const fileDate = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const fileTime = `${two(now.getHours())}${two(now.getMinutes())}`;
  const total = employees.reduce((s, e) => s + e.fixed + e.variable, 0);
  const edr = employees.map((e) => ["EDR", e.personId, e.routing, e.iban, start, end, String(e.days), amt(e.fixed), amt(e.variable), String(e.leaveDays ?? 0)].join(","));
  const scr = ["SCR", emp.employerId, emp.routing, fileDate, fileTime, salaryMonth, String(employees.length), amt(total), String(employees.length + 1), "AED"].join(",");
  return [scr, ...edr].join("\r\n") + "\r\n";
}

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)));

const pb = periodBounds("2026-08");
ok(pb.start === "2026-08-01" && pb.end === "2026-08-31" && pb.days === 31, `period bounds Aug 2026 (start ${pb.start}, end ${pb.end})`);
ok(pb.salaryMonth === "082026", `salaryMonth MMYYYY = ${pb.salaryMonth}`);

const fv = splitFixedVariable(18000, 22000); // basic 18000, net 22000 (allowances)
ok(fv.fixed === 18000 && fv.variable === 4000 && fv.fixed + fv.variable === 22000, `split fixed/variable (fixed ${fv.fixed}, var ${fv.variable})`);
const fv2 = splitFixedVariable(5000, 3000); // heavy deductions: net < basic
ok(fv2.fixed === 3000 && fv2.variable === 0, `split when net < basic caps fixed at net`);

const emp = { employerId: "1234567890123", routing: "302460010" };
const employees = [
  { personId: "784198812345671", routing: "302460010", iban: "AE070331234567890100000", fixed: 18000, variable: 6000, days: 31 },
  { personId: "784199076543212", routing: "302460010", iban: "AE070331234567890100001", fixed: 9000, variable: 3000, days: 31 },
];
const sif = buildSif(emp, employees, "2026-08", new Date(2026, 8, 4, 9, 30));
const lines = sif.trim().split("\r\n");
ok(lines.length === 3, `SIF has SCR + 2 EDR = 3 lines (got ${lines.length})`);
const scr = lines[0].split(",");
ok(scr[0] === "SCR" && scr[1] === "1234567890123" && scr[2] === "302460010", "SCR header: type/employer/routing");
ok(scr[5] === "082026" && scr[6] === "2" && scr[8] === "3" && scr[9] === "AED", `SCR: salaryMonth/edrCount/totalRecords/currency`);
ok(scr[7] === "36000.00", `SCR total salary = 36000.00 (got ${scr[7]})`);
const edr = lines[1].split(",");
ok(edr[0] === "EDR" && edr[1] === "784198812345671" && edr[3] === "AE070331234567890100000", "EDR: type/personId/iban");
ok(edr[4] === "2026-08-01" && edr[5] === "2026-08-31" && edr[7] === "18000.00" && edr[8] === "6000.00", "EDR: pay dates + fixed/variable");
ok(sif.endsWith("\r\n"), "file ends with CRLF");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
