// Verifies the UAE end-of-service settlement math (mirrors src/lib/settlement.ts).
const DAY = 86_400_000;
const round2 = (n) => Math.round(n * 100) / 100;
function serviceLength(join, last) {
  const j = new Date(join), l = new Date(last);
  const totalDays = Math.max(0, Math.floor((l - j) / DAY));
  return { decimalYears: totalDays / 365.25, totalDays };
}
function computeGratuity(basic, y, forfeit = false) {
  const daily = basic / 30;
  if (forfeit || y < 1) return { eligible: false, days: 0, amount: 0 };
  const first5 = Math.min(y, 5), after5 = Math.max(0, y - 5);
  const days = first5 * 21 + after5 * 30;
  const raw = days * daily, cap = basic * 24;
  return { eligible: true, days: round2(days), amount: round2(Math.min(raw, cap)), capped: raw > cap };
}
function settle(i) {
  const svc = serviceLength(i.joinDate, i.lastWorkingDay);
  const daily = i.basicSalary / 30;
  const forfeit = i.forfeitGratuity ?? i.separationType === "Termination (Misconduct)";
  const g = computeGratuity(i.basicSalary, svc.decimalYears, forfeit);
  const leaveAmount = round2(daily * (i.leaveBalanceDays || 0));
  const add = g.amount + leaveAmount + (i.pendingSalary || 0) + (i.noticePay || 0) + (i.airTicket || 0) + (i.otherAdditions || 0);
  const net = round2(add - (i.deductions || 0) + (i.adjustment || 0));
  return { svc, g, leaveAmount, totalAdditions: round2(add), net };
}

let pass = 0, fail = 0;
const near = (a, b, tol = 50) => Math.abs(a - b) <= tol;
const ok = (c, m) => (c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)));

// 3 years, basic 10,000 -> ~63 days -> ~21,000
let r = settle({ basicSalary: 10000, joinDate: "2021-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 0, separationType: "Resignation" });
ok(r.g.eligible && near(r.g.amount, 21000, 100), `3y basic 10k gratuity ~21,000 (got ${r.g.amount})`);

// 7 years -> 5*21 + 2*30 = 165 days -> ~55,000
r = settle({ basicSalary: 10000, joinDate: "2017-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 0, separationType: "Termination" });
ok(near(r.g.amount, 55000, 150), `7y gratuity ~55,000 (got ${r.g.amount})`);

// under 1 year -> not eligible
r = settle({ basicSalary: 10000, joinDate: "2024-01-01", lastWorkingDay: "2024-08-01", leaveBalanceDays: 0, separationType: "Resignation" });
ok(!r.g.eligible && r.g.amount === 0, `under 1y -> no gratuity (got ${r.g.amount})`);

// resignation == termination (new law: same gratuity)
const a = settle({ basicSalary: 8000, joinDate: "2019-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 0, separationType: "Resignation" });
const b = settle({ basicSalary: 8000, joinDate: "2019-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 0, separationType: "Termination" });
ok(a.g.amount === b.g.amount && a.g.amount > 0, `resignation == termination gratuity (${a.g.amount})`);

// cap at 2 years' basic pay (30 years service)
r = settle({ basicSalary: 10000, joinDate: "1994-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 0, separationType: "Termination" });
ok(r.g.capped && r.g.amount === 240000, `30y capped at 240,000 (got ${r.g.amount})`);

// gross misconduct forfeits gratuity
r = settle({ basicSalary: 10000, joinDate: "2018-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 0, separationType: "Termination (Misconduct)" });
ok(!r.g.eligible && r.g.amount === 0, `misconduct forfeits gratuity (got ${r.g.amount})`);

// leave encashment: 30 days, basic 9,000 -> 9,000
r = settle({ basicSalary: 9000, joinDate: "2020-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 30, separationType: "Resignation" });
ok(near(r.leaveAmount, 9000, 1), `leave encashment 30d @9k -> 9,000 (got ${r.leaveAmount})`);

// net with additions/deductions/adjustment
r = settle({ basicSalary: 10000, joinDate: "2021-01-01", lastWorkingDay: "2024-01-01", leaveBalanceDays: 15, separationType: "Resignation", pendingSalary: 5000, deductions: 2000, adjustment: 500 });
// gratuity ~21,000 + leave (15*333.33=5,000) + pending 5,000 - 2,000 + 500 = ~29,500
ok(near(r.net, 29500, 150), `net with adjustments ~29,500 (got ${r.net})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
