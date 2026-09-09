/**
 * The cash flow forecast.
 *
 * This is the one report in the system that people will act on before it has
 * happened — delay a supplier, chase a client, move a cheque — so an optimistic
 * number here does real damage. The rules held below are the ones that decide
 * whether the answer is honest:
 *
 *   - money already overdue is still money that has not arrived;
 *   - the cautious view doubts what you are owed but never what you owe;
 *   - a short month still has a payday.
 */
import { importLibs } from "./lib-shim.mjs";

const { cashflow } = await importLibs(["cashflow"]);
const {
  DEFAULT_WEEKS, MIN_WEEKS, MAX_WEEKS, DEFAULT_PAY_DAY,
  startOfDay, weekBuckets, payrollDates, buildForecast, verdict,
} = cashflow;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const d = (s) => new Date(`${s}T00:00:00.000Z`);
const ev = (date, amount, kind, certainty = "certain", label = kind) => ({ date: d(date), amount, kind, certainty, label });

/* ============================ weeks ===================================== */

ok("a quarter is the default", DEFAULT_WEEKS === 13);
{
  const b = weekBuckets(d("2026-09-09"), 13);
  ok("thirteen weeks are produced", b.length === 13);
  ok("the first starts on the day asked for", b[0].from.toISOString().startsWith("2026-09-09"));
  ok("each week is seven days", b[0].to.getTime() - b[0].from.getTime() === 6 * 24 * 3600 * 1000);
  ok("weeks do not overlap", b[1].from.getTime() - b[0].to.getTime() === 24 * 3600 * 1000);
  ok("the first two are named in words", b[0].label === "This week" && b[1].label === "Next week");
  ok("and the rest are numbered", b[2].label === "Week 3" && b[12].label === "Week 13");
}
ok("a time of day cannot move a bucket",
  startOfDay(new Date("2026-09-09T23:59:59.000Z")).toISOString() === "2026-09-09T00:00:00.000Z");

/* ============================ payday ==================================== */
{
  const pays = payrollDates(d("2026-01-01"), d("2026-04-30"), 28);
  ok("one payday per month", pays.length === 4, pays.map((p) => p.toISOString().slice(0, 10)).join(", "));
  ok("on the day chosen", pays.every((p) => p.getUTCDate() === 28));
}
{
  // A company paying on the 31st still pays in February. Skipping the month
  // would drop the single largest outflow it has.
  const pays = payrollDates(d("2026-01-01"), d("2026-03-31"), 31);
  ok("a short month pays on its last day", pays.length === 3, pays.map((p) => p.toISOString().slice(0, 10)).join(", "));
  ok("February 2026 pays on the 28th", pays[1].toISOString().slice(0, 10) === "2026-02-28");
  const leap = payrollDates(d("2028-02-01"), d("2028-02-29"), 31);
  ok("and on the 29th in a leap year", leap[0].toISOString().slice(0, 10) === "2028-02-29");
}
ok("a payday before the window is not counted",
  payrollDates(d("2026-01-29"), d("2026-02-27"), 28).length === 0);
ok("nonsense day-of-month falls back rather than throwing",
  payrollDates(d("2026-01-01"), d("2026-01-31"), 0)[0].getUTCDate() === DEFAULT_PAY_DAY);
ok("a day beyond 31 is clamped, not skipped",
  payrollDates(d("2026-01-01"), d("2026-01-31"), 99)[0].getUTCDate() === 31);

/* ============================ the running balance ======================= */
{
  const f = buildForecast({
    opening: 100_000,
    from: d("2026-09-09"),
    weeks: 4,
    events: [
      ev("2026-09-10", 50_000, "cheque-in"),
      ev("2026-09-20", -30_000, "cheque-out"),
      ev("2026-09-28", -80_000, "payroll", "likely"),
    ],
  });
  ok("opening is carried in", f.opening === 100_000);
  ok("week one nets the cheque in", f.buckets[0].moneyIn === 50_000 && f.buckets[0].closing === 150_000);
  ok("week two takes the cheque out", f.buckets[1].moneyOut === 30_000 && f.buckets[1].closing === 120_000);
  ok("week three pays the wages", f.buckets[2].moneyOut === 80_000 && f.buckets[2].closing === 40_000);
  ok("the closing balance is opening plus in less out",
    f.closing === 100_000 + 50_000 - 30_000 - 80_000, String(f.closing));
  ok("totals agree with the weeks",
    f.totalIn === 50_000 && f.totalOut === 110_000);
  ok("the lowest point is found", f.lowest.closing === 40_000, String(f.lowest.closing));
  ok("and it names the week it happens in", f.lowest.bucket?.label === "Week 3");
  ok("no shortfall when it never goes negative", f.shortfall === null);
}

/* ============================ going overdrawn =========================== */
{
  const f = buildForecast({
    opening: 20_000,
    from: d("2026-09-09"),
    weeks: 4,
    events: [ev("2026-09-28", -80_000, "payroll", "likely"), ev("2026-10-05", 200_000, "receivable", "likely")],
  });
  ok("the shortfall week is identified", f.shortfall?.label === "Week 3", f.shortfall?.label ?? "none");
  ok("even though the period ends healthy", f.closing === 140_000, String(f.closing));
  const v = verdict(f);
  ok("and the verdict says so plainly", v.tone === "bad" && /overdrawn/.test(v.text), v.text);
  ok("the verdict names the week", /week 3/i.test(v.text), v.text);

  // Recovering later must not hide the hole. This is the whole reason the
  // report is weekly rather than monthly.
  ok("a healthy closing balance does not overrule a mid-period shortfall",
    f.closing > 0 && f.shortfall !== null);
}
{
  const f = buildForecast({ opening: 100_000, from: d("2026-09-09"), weeks: 4, events: [] });
  ok("no movement at all is flat, not empty", f.closing === 100_000 && f.buckets.length === 4);
  ok("and reads as healthy", verdict(f).tone === "good");
}
{
  const f = buildForecast({
    opening: 100_000, from: d("2026-09-09"), weeks: 4,
    events: [ev("2026-09-10", -90_000, "payable", "likely")],
  });
  ok("a big dip is flagged as tight even while positive", verdict(f).tone === "watch", verdict(f).text);
}

/* ============================ overdue money ============================= */
{
  // An invoice that was due last month has not been paid. Dropping it off the
  // front of the timeline would forecast money that is never coming.
  const f = buildForecast({
    opening: 0,
    from: d("2026-09-09"),
    weeks: 4,
    events: [ev("2026-07-01", 25_000, "receivable", "estimated"), ev("2026-08-15", -10_000, "payable", "likely")],
  });
  ok("money overdue lands in the first week, not nowhere",
    f.buckets[0].moneyIn === 25_000 && f.buckets[0].moneyOut === 10_000);
  ok("and nothing is silently lost", f.totalIn === 25_000 && f.totalOut === 10_000);
}

/* ============================ beyond the horizon ======================== */
{
  const f = buildForecast({
    opening: 0, from: d("2026-09-09"), weeks: 4,
    events: [ev("2027-06-01", 500_000, "retention-in", "likely"), ev("2027-06-02", -5_000, "payable", "likely")],
  });
  ok("money past the horizon is not in any week", f.totalIn === 0 && f.totalOut === 0);
  ok("but it is still counted and reported",
    f.beyondHorizon.moneyIn === 500_000 && f.beyondHorizon.moneyOut === 5_000);
  ok("so it cannot flatter the closing balance", f.closing === 0);
}

/* ============================ the cautious view ========================= */
{
  const events = [
    ev("2026-09-10", 40_000, "receivable", "estimated"),
    ev("2026-09-11", 60_000, "cheque-in", "certain"),
    ev("2026-09-12", -15_000, "payable", "estimated"),
    ev("2026-09-13", -25_000, "cheque-out", "certain"),
  ];
  const open = buildForecast({ opening: 0, from: d("2026-09-09"), weeks: 4, events });
  const careful = buildForecast({ opening: 0, from: d("2026-09-09"), weeks: 4, events, cautious: true });

  ok("the open view counts everything", open.totalIn === 100_000 && open.totalOut === 40_000);
  ok("the cautious view drops the uncertain money coming in", careful.totalIn === 60_000);

  // The asymmetry is the point. A view that also dropped the uncertain money
  // going out would produce a comforting number and a bounced cheque.
  ok("but keeps the uncertain money going out", careful.totalOut === 40_000, String(careful.totalOut));
  ok("so it is never more optimistic than the open view", careful.closing <= open.closing);
  ok("and it says what it left out",
    careful.excluded.count === 1 && careful.excluded.amount === 40_000);
  ok("the open view excludes nothing", open.excluded.count === 0);
}

/* ============================ bounds and edges ========================== */
{
  ok("a silly horizon is clamped, not obeyed",
    buildForecast({ opening: 0, from: d("2026-09-09"), weeks: 500, events: [] }).buckets.length === MAX_WEEKS);
  ok("and so is a tiny one",
    buildForecast({ opening: 0, from: d("2026-09-09"), weeks: 0, events: [] }).buckets.length === MIN_WEEKS);
  ok("a zero-amount event is ignored rather than cluttering a week",
    buildForecast({ opening: 0, from: d("2026-09-09"), weeks: 2, events: [ev("2026-09-10", 0, "receivable")] })
      .buckets[0].events.length === 0);
  ok("an overdrawn opening balance is carried in as it is",
    buildForecast({ opening: -5_000, from: d("2026-09-09"), weeks: 2, events: [] }).shortfall?.label === "This week");
}
{
  // Fils must not accumulate: three thirds of a fils should not become a fils.
  const f = buildForecast({
    opening: 0.01, from: d("2026-09-09"), weeks: 2,
    events: [ev("2026-09-10", 0.333, "receivable"), ev("2026-09-11", 0.333, "receivable"), ev("2026-09-12", 0.333, "receivable")],
  });
  ok("amounts are rounded to fils on the way in", Math.abs(f.buckets[0].moneyIn - 0.99) < 0.005, String(f.buckets[0].moneyIn));
  ok("and the closing balance carries no dust",
    Math.abs(f.closing - Math.round(f.closing * 100) / 100) < 1e-9, String(f.closing));
}
{
  const f = buildForecast({
    opening: 1000, from: d("2026-09-09"), weeks: 3,
    events: [ev("2026-09-25", -100, "payable", "likely"), ev("2026-09-12", -50, "cheque-out")],
  });
  ok("events inside a week are listed oldest first",
    f.buckets[0].events[0].date.getTime() <= (f.buckets[0].events[1]?.date.getTime() ?? Infinity));
  const all = f.buckets.flatMap((b) => b.events);
  ok("every event lands in exactly one week", all.length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
