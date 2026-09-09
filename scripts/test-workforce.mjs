/**
 * The workforce nationality mix.
 *
 * Two counting rules carry the weight here, and both are the kind of mistake
 * that produces a comfortable number rather than an obviously wrong one:
 *
 *   - supplied labour is on the supplier's establishment, not this one, so
 *     counting it gives you somebody else's mix;
 *   - people with no nationality recorded stay in the denominator, because
 *     dropping them makes every share look smaller than it is, and a hiring
 *     plan built on a flattering percentage is worse than no plan.
 */
import { importLibs } from "./lib-shim.mjs";

const { workforce } = await importLibs(["workforce"]);
const { DEFAULT_MAX_NATIONALITY_SHARE, workforceMix, diversityGap, mixVerdict } = workforce;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };

/** n people of one nationality. */
const many = (n, nationality, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    employeeId: `${nationality}-${i}`, nationality, employmentType: "Full-time", status: "Active", ...extra,
  }));

/* ===================== who is counted =================================== */
{
  const people = [
    ...many(6, "Indian"),
    ...many(4, "Filipino"),
    ...many(20, "Indian", { employmentType: "Supplied" }), // the supplier's people
    ...many(5, "Nepali", { status: "Inactive" }),          // left the company
  ];
  const m = workforceMix(people);
  ok("supplied labour is not part of our establishment", m.headcount === 10, `${m.headcount}`);
  ok("and is reported as excluded rather than silently dropped", m.suppliedExcluded === 20, `${m.suppliedExcluded}`);
  ok("leavers are not counted", !m.rows.some((r) => r.nationality === "Nepali"));

  // Twenty supplied Indians would have made this 26 of 30 — 87% instead of 60%.
  ok("the largest share is ours, not the supplier's", m.largest.share === 60, `${m.largest.share}%`);
  ok("an inactive person is not in the headcount either", m.headcount === 10);
}
{
  const m = workforceMix(many(3, "Indian", { employmentType: "Supplied" }));
  ok("a workforce made only of supplied labour is an empty mix", m.headcount === 0 && m.rows.length === 0);
  ok("and says so plainly rather than showing 0%",
    mixVerdict(m, null, 50).tone === "watch" && /supplier/.test(mixVerdict(m, null, 50).text),
    mixVerdict(m, null, 50).text);
}

/* ===================== people with no nationality ======================= */
{
  const people = [...many(51, "Indian"), ...many(30, "Filipino"), ...many(3, null)];
  const m = workforceMix(people);
  ok("headcount includes people whose nationality is missing", m.headcount === 84, `${m.headcount}`);

  // 51/84 is 60.7%. Dropping the three unknowns would give 51/81 = 63% — a
  // different number, and the wrong direction to be wrong in.
  ok("the share is over the whole headcount, not over the known ones",
    m.largest.share === 60.7, `${m.largest.share}%`);
  ok("the unrecorded are named", m.unrecorded === 3 && m.rows.some((r) => r.isUnrecorded));
  ok("they are never treated as a nationality of their own",
    m.largest.nationality === "Indian" && m.distinct === 2);
  ok("and the report says how bad it could be if they were all the same",
    m.largestWorstCase === 64.3, `${m.largestWorstCase}%`);
  ok("a blank string counts as unrecorded, not as a nationality",
    workforceMix([...many(1, "Indian"), ...many(1, "   ")]).unrecorded === 1);
}
{
  const m = workforceMix(many(5, null));
  ok("nobody with a nationality recorded has no largest", m.largest === null);
  ok("and the verdict says there is nothing to report yet",
    /no mix to report/.test(mixVerdict(m, null, 50).text), mixVerdict(m, null, 50).text);
}

/* ===================== the mix itself =================================== */
{
  const m = workforceMix([...many(51, "Indian"), ...many(12, "Filipino"), ...many(8, "Pakistani"), ...many(2, "Emirati")]);
  ok("rows come back largest first", m.rows.map((r) => r.nationality).join(",") === "Indian,Filipino,Pakistani,Emirati");
  ok("shares add up to a hundred", Math.abs(m.rows.reduce((t, r) => t + r.share, 0) - 100) < 0.5,
    `${m.rows.reduce((t, r) => t + r.share, 0)}`);
  ok("distinct nationalities are counted", m.distinct === 4);
  ok("Emirati nationals are counted for Nafis as well", m.emirati === 2);
  ok("and the word is recognised however it is written",
    workforceMix([...many(2, "emirati"), ...many(1, "UAE")]).emirati === 3);
  ok("worst case equals the share when nothing is unrecorded",
    m.largestWorstCase === m.largest.share);
}
ok("an empty workforce is an empty report, not a crash",
  workforceMix([]).headcount === 0 && workforceMix([]).largest === null);

/* ===================== what would close the gap ========================= */
{
  // 51 of 84 is 60.7%. To reach 50%: 51/(84+n) <= 0.5 → n >= 18.
  const m = workforceMix([...many(51, "Indian"), ...many(33, "Filipino")]);
  const g = diversityGap(m, 50);
  ok("a workforce over the target reports a gap", !!g);
  ok("it says how far over", g.overBy === 10.7, `${g.overBy} points`);
  ok("hiring the stated number actually reaches the target",
    (51 / (84 + g.hire)) * 100 <= 50, `hire ${g.hire}`);
  ok("and one fewer would not", (51 / (84 + g.hire - 1)) * 100 > 50, "so the answer is the smallest that works");
  ok("losing the stated number also reaches it",
    ((51 - g.reduce) / (84 - g.reduce)) * 100 <= 50, `reduce ${g.reduce}`);
  ok("and one fewer would not",
    ((51 - g.reduce + 1) / (84 - g.reduce + 1)) * 100 > 50);
  ok("hiring is always the gentler of the two", g.hire >= g.reduce, `${g.hire} vs ${g.reduce}`);
}
{
  const m = workforceMix([...many(5, "Indian"), ...many(4, "Filipino"), ...many(3, "Nepali")]);
  ok("a workforce already inside the target has no gap", diversityGap(m, 50) === null,
    `largest is ${m.largest.share}% against 50%`);
  ok("exactly on the target is not over it", diversityGap(workforceMix([...many(5, "Indian"), ...many(5, "Filipino")]), 50) === null);
}
{
  const m = workforceMix(many(10, "Indian"));
  const g = diversityGap(m, 50);
  ok("a single-nationality workforce is reported honestly at 100%", m.largest.share === 100);
  ok("and the hiring number is real, not infinite", g.hire === 10, `${g.hire}`);
  ok("no target set means no gap and no false comfort", diversityGap(m, 0) === null);
  ok("a target of 100% is meaningless and is refused", diversityGap(m, 100) === null);
}

/* ===================== the sentence at the top ========================== */
{
  const over = workforceMix([...many(51, "Indian"), ...many(33, "Filipino")]);
  const v = mixVerdict(over, diversityGap(over, 50), 50);
  ok("being over the target is stated plainly", v.tone === "bad" && /above the 50%/.test(v.text), v.text);
  ok("it names the nationality and the share", /Indian nationals are 60.7%/.test(v.text));
  ok("and says what closes it", /Hiring 18 people/.test(v.text), v.text);
  ok("the wording never calls the target a legal limit",
    !/law|legal|must|required/i.test(v.text), v.text);

  const close = workforceMix([...many(48, "Indian"), ...many(30, "Filipino"), ...many(22, "Nepali")]);
  ok("just under the target is a warning, not a pass",
    mixVerdict(close, diversityGap(close, 50), 50).tone === "watch",
    mixVerdict(close, diversityGap(close, 50), 50).text);

  const fine = workforceMix([...many(20, "Indian"), ...many(40, "Filipino"), ...many(40, "Nepali")]);
  ok("a comfortable mix reads as comfortable", mixVerdict(fine, diversityGap(fine, 50), 50).tone === "good");
  ok("and says how many nationalities there are", /3 nationalities/.test(mixVerdict(fine, null, 50).text));
}

ok("the starting figure is offered, not imposed", DEFAULT_MAX_NATIONALITY_SHARE === 50);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
