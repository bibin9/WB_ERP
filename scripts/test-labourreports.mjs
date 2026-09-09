/**
 * The overtime and manhours reports.
 *
 * Two rules here are worth more than the rest. The overtime cap counts hours
 * worked, not hours paid, so both rates count towards it — pricing some of them
 * at 150% does not make them fewer hours. And a job with no budget is not a job
 * at nought per cent of its budget: reporting it as one would bury the jobs
 * that genuinely have a budget and are running through it.
 */
import { importLibs } from "./lib-shim.mjs";

const { overtime, manhours } = await importLibs(["overtime", "manhours"]);
const {
  STATUTORY_MAX_OT_PER_DAY, STATUTORY_MAX_HOURS_PER_3_WEEKS, ROLLING_WINDOW_DAYS,
  DEFAULT_OVERTIME_POLICY, HEAVY_OT_SHARE,
  summariseOvertime, dailyBreaches, rollingBreaches, overtimeVerdict,
} = overtime;
const { BUDGET_WARNING_SHARE, summariseManhours, manhoursVerdict } = manhours;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const d = (s) => new Date(`${s}T00:00:00.000Z`);

const slip = (id, period, otHours, otPremiumHours, overtimePay, basic = 3000) => ({
  employeeId: id, empNo: `EMP-${id}`, employeeName: `Person ${id}`, department: "Site",
  period, basic, otHours, otPremiumHours, overtime: overtimePay,
});
const att = (id, date, hours, otHours, otPremiumHours = 0) => ({
  employeeId: id, empNo: `EMP-${id}`, employeeName: `Person ${id}`,
  date: d(date), hours, otHours, otPremiumHours,
});

/* ===================== overtime: what it cost =========================== */
{
  const s = summariseOvertime([
    slip("A", "2026-07", 10, 2, 900),
    slip("A", "2026-08", 8, 0, 600),
    slip("B", "2026-08", 30, 10, 3200),
  ]);
  ok("one row per person, not per payslip", s.rows.length === 2, `${s.rows.length}`);
  ok("a person's months are added up", s.rows.find((r) => r.employeeId === "A").totalHours === 20);
  ok("and their cost with them", s.rows.find((r) => r.employeeId === "A").cost === 1500);
  ok("the costliest person is first", s.rows[0].employeeId === "B", s.rows[0].employeeId);
  ok("totals agree with the rows", s.totals.cost === 4700 && s.totals.totalHours === 60);
  ok("the two rates are kept apart, because they are priced differently",
    s.totals.otHours === 48 && s.totals.otPremiumHours === 12);
  ok("months come back oldest first, for a trend",
    s.byPeriod.map((p) => p.period).join(",") === "2026-07,2026-08");
  ok("each month carries its own hours and cost",
    s.byPeriod[0].hours === 12 && s.byPeriod[1].cost === 3800);
}
{
  // Overtime worth more than half of basic is legal and worth a look.
  const s = summariseOvertime([slip("C", "2026-08", 40, 0, 2000, 3000), slip("D", "2026-08", 2, 0, 100, 3000)]);
  ok("somebody earning more than half their basic in overtime is flagged",
    s.heavy.length === 1 && s.heavy[0].employeeId === "C", s.heavy.map((h) => h.employeeId).join(","));
  ok("the share is reported, not just the flag",
    Math.abs(s.rows.find((r) => r.employeeId === "C").shareOfBasic - 0.67) < 0.01);
  ok("and the threshold is a named constant, not a magic number", HEAVY_OT_SHARE === 0.5);
  ok("somebody with no basic pay does not divide by zero",
    summariseOvertime([slip("E", "2026-08", 5, 0, 200, 0)]).rows[0].shareOfBasic === 0);
}
ok("no payslips is an empty report, not a crash",
  summariseOvertime([]).rows.length === 0 && summariseOvertime([]).totals.cost === 0);

/* ===================== overtime: the legal caps ========================= */

ok("the statute is two hours a day", STATUTORY_MAX_OT_PER_DAY === 2);
ok("and 144 hours in three weeks", STATUTORY_MAX_HOURS_PER_3_WEEKS === 144 && ROLLING_WINDOW_DAYS === 21);

{
  const days = [
    att("A", "2026-08-01", 8, 2),      // exactly at the cap
    att("A", "2026-08-02", 8, 3),      // over
    att("B", "2026-08-02", 8, 1, 2),   // 3 hours across both rates — also over
    att("C", "2026-08-02", 8, 0, 2),   // premium only, at the cap
  ];
  const breaches = dailyBreaches(days, DEFAULT_OVERTIME_POLICY);
  ok("exactly at the cap is not a breach", !breaches.some((b) => b.date.getTime() === d("2026-08-01").getTime()));
  ok("over the cap is", breaches.some((b) => b.employeeId === "A" && b.otHours === 3));

  // The law limits hours worked. Paying some of them at 150% does not make
  // them fewer hours, and splitting them across the two rates is the obvious
  // way this would be missed.
  ok("both rates count towards the daily cap",
    breaches.some((b) => b.employeeId === "B" && b.otHours === 3),
    "1h ordinary + 2h premium is 3 hours of overtime");
  ok("premium-only hours at the cap are not a breach", !breaches.some((b) => b.employeeId === "C"));
  ok("the worst is listed first", breaches[0].otHours >= breaches[breaches.length - 1].otHours);
  ok("and each says what the limit was", breaches.every((b) => b.limit === 2));
}
{
  // A company may be stricter than the statute.
  const strict = { ...DEFAULT_OVERTIME_POLICY, maxOvertimeHoursPerDay: 1 };
  ok("a stricter company cap is applied",
    dailyBreaches([att("A", "2026-08-01", 8, 2)], strict).length === 1);
}
{
  // 21 days at 8 hours is 168, over the 144 cap.
  const days = Array.from({ length: 21 }, (_, i) =>
    att("A", `2026-08-${String(i + 1).padStart(2, "0")}`, 8, 0));
  const r = rollingBreaches(days, DEFAULT_OVERTIME_POLICY);
  ok("three solid weeks of eight-hour days breaks the 144-hour cap", r.length === 1, `${r.length}`);
  ok("the window is reported, so it can be checked", r[0]?.hours === 168 && r[0]?.limit === 144);
  ok("and it is three weeks long",
    r[0] && (r[0].to.getTime() - r[0].from.getTime()) / (24 * 3600 * 1000) === 20);
}
{
  // Six days a week at eight hours is 144 over three weeks — exactly at it.
  const days = [];
  for (let i = 0; i < 21; i++) {
    if (i % 7 === 6) continue; // one rest day a week
    days.push(att("A", `2026-08-${String(i + 1).padStart(2, "0")}`, 8, 0));
  }
  ok("a six-day week at eight hours is exactly at the cap, not over",
    rollingBreaches(days, DEFAULT_OVERTIME_POLICY).length === 0);
}
{
  // The statute says "any three weeks", so a run straddling two calendar
  // months is still a breach. Testing fixed blocks is how it would be missed.
  const days = [];
  for (let i = 20; i <= 31; i++) days.push(att("A", `2026-07-${i}`, 10, 2));
  for (let i = 1; i <= 9; i++) days.push(att("A", `2026-08-0${i}`.slice(0, 10), 10, 2));
  const r = rollingBreaches(days, DEFAULT_OVERTIME_POLICY);
  ok("a run across a month boundary is still caught", r.length === 1, `${r.length}`);
  ok("only the worst window per person is reported, not every overlap",
    r.filter((x) => x.employeeId === "A").length === 1);
}
ok("nobody working means nobody breaching",
  rollingBreaches([], DEFAULT_OVERTIME_POLICY).length === 0 &&
  dailyBreaches([], DEFAULT_OVERTIME_POLICY).length === 0);

{
  const clean = summariseOvertime([slip("A", "2026-08", 2, 0, 100)]);
  ok("a clean month reads as clean", overtimeVerdict(clean, [], []).tone === "good");
  const v = overtimeVerdict(clean, [{ employeeId: "A", empNo: "1", employeeName: "A", date: d("2026-08-02"), otHours: 4, limit: 2 }], []);
  ok("a breach is stated plainly", v.tone === "bad" && /more overtime than the law allows/.test(v.text), v.text);
  ok("and points at the roster rather than the payslip", /roster/.test(v.text));
  const heavy = summariseOvertime([slip("C", "2026-08", 40, 0, 2000, 3000)]);
  ok("heavy but legal overtime reads as a watch", overtimeVerdict(heavy, [], []).tone === "watch");
}

/* ===================== manhours ========================================= */

const ts = (jobId, employeeId, date, hours, costRate = 20, posted = true) => ({
  jobId, jobCode: jobId ? `J-${jobId}` : null, jobName: jobId ? `Job ${jobId}` : null,
  employeeId, empNo: `EMP-${employeeId}`, employeeName: `Person ${employeeId}`, trade: "Electrician",
  date: d(date), hours, costRate, posted,
});

{
  const s = summariseManhours(
    [ts("1", "A", "2026-08-01", 8), ts("1", "B", "2026-08-01", 8), ts("2", "A", "2026-08-02", 4)],
    [{ jobId: "1", code: "J-1", name: "Tower", status: "Open", budgetHours: 100 },
     { jobId: "2", code: "J-2", name: "Villa", status: "Open", budgetHours: 0 }],
  );
  ok("hours are grouped by job", s.jobs.length === 2);
  ok("the busiest job is first", s.jobs[0].jobId === "1" && s.jobs[0].hours === 16);
  ok("cost uses the rate captured at the time", s.jobs[0].cost === 320);
  ok("the number of people on a job is counted once each", s.jobs[0].people === 2);
  ok("budget use is a share", s.jobs[0].used === 0.16 && s.jobs[0].remaining === 84);

  // A job with no budget is not a job at nought per cent of one.
  ok("a job with no budget has no share rather than a misleading zero",
    s.jobs.find((j) => j.jobId === "2").used === 0);
  ok("and is never reported as over budget",
    !s.overBudget.some((j) => j.jobId === "2"));
  ok("totals cover every job", s.totals.hours === 20 && s.totals.cost === 400);
}
{
  const s = summariseManhours(
    [ts("1", "A", "2026-08-01", 95), ts("2", "A", "2026-08-02", 120), ts("3", "A", "2026-08-03", 10)],
    [{ jobId: "1", code: "J-1", name: "A", status: "Open", budgetHours: 100 },
     { jobId: "2", code: "J-2", name: "B", status: "Open", budgetHours: 100 },
     { jobId: "3", code: "J-3", name: "C", status: "Open", budgetHours: 100 }],
  );
  ok("a job at 95% is flagged before it is spent, not after",
    s.overBudget.some((j) => j.jobId === "1"), `warning at ${BUDGET_WARNING_SHARE}`);
  ok("a job past its budget is flagged too", s.overBudget.some((j) => j.jobId === "2"));
  ok("a job at 10% is not", !s.overBudget.some((j) => j.jobId === "3"));
  ok("the worst is first", s.overBudget[0].jobId === "2");
  ok("remaining hours go negative rather than clamping to zero",
    s.jobs.find((j) => j.jobId === "2").remaining === -20, "a job 20 hours over is not a job with 0 left");
  ok("the verdict names the worst job", /J-2/.test(manhoursVerdict(s).text) && manhoursVerdict(s).tone === "bad",
    manhoursVerdict(s).text);
}
{
  // Time against no job vanishes from every job report unless it is counted.
  const s = summariseManhours(
    [ts("1", "A", "2026-08-01", 8), ts(null, "B", "2026-08-01", 40)],
    [{ jobId: "1", code: "J-1", name: "A", status: "Open", budgetHours: 100 }],
  );
  ok("hours against no job are counted separately, not dropped",
    s.unallocated.hours === 40 && s.unallocated.cost === 800);
  ok("they are not attributed to a job", s.jobs.length === 1 && s.jobs[0].hours === 8);
  ok("but they are in the total, so the total is the truth",
    s.totals.hours === 48 && s.totals.cost === 960);
  ok("and a big unallocated share is called out",
    manhoursVerdict(s).tone === "watch" && /no job at all/.test(manhoursVerdict(s).text),
    manhoursVerdict(s).text);
  ok("the person is still credited with the time", s.people.find((p) => p.employeeId === "B").hours === 40);
}
{
  const s = summariseManhours(
    [ts("1", "A", "2026-08-01", 8, 20, true), ts("1", "A", "2026-08-02", 8, 20, false)],
    [{ jobId: "1", code: "J-1", name: "A", status: "Open", budgetHours: 100 }],
  );
  ok("hours not yet charged to the job are counted and named",
    s.jobs[0].unpostedHours === 8 && s.totals.unpostedHours === 8,
    "otherwise the margin on Job Costing is quietly missing them");
  ok("they are still in the job's hours, because the work was done",
    s.jobs[0].hours === 16);
}
{
  const s = summariseManhours(
    [ts("1", "A", "2026-08-01", 8), ts("2", "A", "2026-08-02", 8), ts("1", "B", "2026-08-01", 4)],
    [],
  );
  ok("people are listed by hours, busiest first", s.people[0].employeeId === "A" && s.people[0].hours === 16);
  ok("and how many jobs each is spread across", s.people[0].jobs === 2 && s.people[1].jobs === 1);
  ok("a missing budget record does not lose the job",
    s.jobs.length === 2 && s.jobs.every((j) => j.code.startsWith("J-")));
}
ok("no timesheets is an empty report, not a crash",
  summariseManhours([], []).jobs.length === 0 && manhoursVerdict(summariseManhours([], [])).tone === "good");
{
  // Fils and fractions of an hour must not accumulate.
  const s = summariseManhours(
    [ts("1", "A", "2026-08-01", 0.333, 3.333), ts("1", "A", "2026-08-02", 0.333, 3.333)],
    [{ jobId: "1", code: "J-1", name: "A", status: "Open", budgetHours: 1 }],
  );
  // Each entry is rounded on the way in, the same as ageing.ts and cashflow.ts,
  // so 0.333 + 0.333 is 0.66 rather than 0.67. What matters is that no total
  // carries floating-point dust into a report somebody adds up by hand.
  const clean2dp = (v) => Math.abs(v - Math.round(v * 100) / 100) < 1e-9;
  ok("no total carries floating-point dust",
    clean2dp(s.jobs[0].hours) && clean2dp(s.jobs[0].cost) && clean2dp(s.totals.cost),
    `${s.jobs[0].hours}h / ${s.jobs[0].cost}`);
  ok("and the total is the sum of the rounded parts, not a re-rounded sum",
    s.jobs[0].hours === 0.66, String(s.jobs[0].hours));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
