/**
 * The September 2026 security review, held closed.
 *
 *   SEC-1  any administrator could take over the Group Admin: reset their
 *          password and be shown it, give themselves Group Admin, create a
 *          role above everybody, lock the Group Admin out.
 *   SEC-3  guesses sent at the same instant all read "0 failed", so the
 *          three-strikes lock-out allowed as many guesses as could be sent.
 *   SEC-4  three wrong passwords from anyone locked the account for everyone.
 *   SEC-5  whoever raised a request could approve it, and one senior person
 *          could approve every step.
 *   SEC-6  six-character passwords, none at all when an administrator set
 *          one, and temporary passwords from Math.random.
 *   SEC-7  the sign-in screen told a stranger which emails had accounts.
 *   SEC-8  a missing AUTH_SECRET fell back to a value written in the source.
 *   SEC-9  the Tally connector would connect anywhere an administrator typed,
 *          including the host's own private network.
 *   SEC-10 a session lasted seven days and signing out did not end it.
 *   SEC-11 two approvers deciding the same step at once both got through.
 *   SEC-12 inline scripts were allowed by the Content-Security-Policy.
 *
 * Each fix is proved by behaviour where it can be run outside the app, and by
 * the shape of the code where it cannot (a server action needs a request).
 */
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const libs = await importLibs(["db", "rank", "password-policy", "signin-throttle", "net-guard", "session-token", "csp", "company-scope", "approval-visibility"]);
const { db } = libs.db;
const { outranks, cleanLevel, levelOf, TOP_LEVEL } = libs.rank;
const { passwordProblem, temporaryPassword, MIN_PASSWORD_LENGTH } = libs["password-policy"];
const T = libs["signin-throttle"];
const { isPrivateAddress, hostProblem, cleanPort } = libs["net-guard"];
const tokens = libs["session-token"];
const { contentSecurityPolicy, makeNonce } = libs.csp;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/* ================================================ SEC-1 · rank ============ */
console.log("SEC-1 · who may manage whom");
ok("a Director (80) cannot manage the Group Admin (100)", !outranks(80, 100));
ok("a Director cannot manage another Director", !outranks(80, 80));
ok("a Director can manage a Finance Controller (60)", outranks(80, 60));
ok("the Group Admin can manage everyone, including another Group Admin", outranks(100, 100) && outranks(100, 0));
ok("nothing is created above the top", !outranks(100, 101) && cleanLevel(101) === null && cleanLevel(-1) === null && cleanLevel(2.5) === null);
ok("a typed level is cleaned to a whole number", cleanLevel("60") === 60 && cleanLevel("abc") === null);
ok("a person's level is their most senior role", levelOf([20, 80, 45]) === 80 && levelOf([]) === -1 && TOP_LEVEL === 100);

const users = read("src/app/(app)/users/actions.ts");
const fn = (src, name) => { const i = src.indexOf(`export async function ${name}`); const j = src.indexOf("export async function", i + 10); return src.slice(i, j === -1 ? undefined : j); };
for (const name of ["setUserActive", "updateUser", "resetUserPassword", "setUserLock", "deleteUser"]) {
  ok(`${name} checks the administrator outranks the person`, /outranks\(a\.level, t\.level\)|outranks\(level, t\.level\)/.test(fn(users, name)));
}
ok("a role is only handed out by someone above it", /outranks\(level, role\.approvalLevel\)/.test(fn(users, "createUser")) && /outranks\(level, role\.approvalLevel\)/.test(fn(users, "updateUser")));
ok("nobody changes their own role", /if \(self\) return \{ ok: false, error: "You cannot change your own role/.test(fn(users, "updateUser")));
ok("a new user's companies must be in this group", /tenantId: session\.tenant\.id \} \}\);\s*if \(companies !== companyIds\.length\)/.test(fn(users, "createUser")));
const roles = read("src/app/(app)/settings/roles/actions.ts");
for (const name of ["createRole", "updateRoleLevel", "setRolePermission", "setModulePermission", "deleteRole"]) {
  ok(`${name} checks rank`, /outranks\(session\.level,/.test(fn(roles, name)));
}
ok("permission changes accept only real screens and actions", /KNOWN_SCREENS\.has\(screenKey\)/.test(roles) && /KNOWN_ACTIONS\.has\(action\)/.test(roles));

/* ============================================ SEC-6 · passwords =========== */
console.log("\nSEC-6 · passwords");
ok(`fewer than ${MIN_PASSWORD_LENGTH} characters is refused`, !!passwordProblem("Short1!"));
ok("a common password is refused even with a number on the end", !!passwordProblem("password123") && !!passwordProblem("Welcome2026!"));
ok("the person's own name or email is refused", !!passwordProblem("fatima-summer-2026", { name: "Fatima Khan" }) && !!passwordProblem("ahmed.r-2026-pass", { email: "ahmed.r@wandb.ae" }));
ok("a keyboard run or a repeated character is refused", !!passwordProblem("1234567890ab") && !!passwordProblem("aaaaaaaaaaaa"));
ok("a sentence someone would remember is accepted", passwordProblem("Green tea at 7 on Friday", { name: "Jane Doe", email: "jane@wandb.ae" }) === null);
const temps = new Set(Array.from({ length: 2000 }, () => temporaryPassword()));
const sample = [...temps][0];
ok("temporary passwords are long, readable and never repeat", temps.size === 2000 && /^Wb-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(sample), sample);
ok("they come from a cryptographic source, not Math.random", /randomInt/.test(read("src/lib/password-policy.ts")) && !/Math\.random\(/.test(read("src/lib/password-policy.ts")) && !/Math\.random\(/.test(users));
ok("a temporary password passes the rules it is handed out under", passwordProblem(sample) === null);
ok("an administrator's chosen password must be changed at first sign-in", /passwordHash, mustReset: true/.test(fn(users, "createUser")));
ok("changing your own password uses the same rules", /passwordProblem\(next/.test(read("src/app/(app)/account/actions.ts")) && !/next\.length < 6/.test(read("src/app/(app)/account/actions.ts")));

/* ============================== SEC-3 / SEC-4 · the sign-in throttle ======= */
console.log("\nSEC-3 / SEC-4 · counting wrong passwords");
const run = `t${Date.now()}`;
try {
  const same = T.keysFor(`${run}-alice`, "203.0.113.5");
  const burst = await Promise.all(Array.from({ length: 30 }, () => T.reserveAttempt(same)));
  const allowed = burst.filter((r) => r.allowed).length;
  ok("30 guesses at the same instant get exactly 3 password checks, not 30", allowed === T.LIMITS.pair, `${allowed} of 30 allowed`);

  const fromElsewhere = await T.reserveAttempt(T.keysFor(`${run}-alice`, "198.51.100.7"));
  ok("the real person on another machine is not locked out by it", fromElsewhere.allowed);

  // Many machines on one account: the account pauses for everybody at the limit, and says so once.
  const spread = [];
  for (let i = 0; i < 14; i++) spread.push(await T.reserveAttempt(T.keysFor(`${run}-bob`, `192.0.2.${i + 1}`)));
  const firstRefused = spread.findIndex((r) => !r.allowed);
  ok(`an account guessed at from many addresses pauses after ${T.LIMITS.account}`, firstRefused === T.LIMITS.account, `refused from attempt ${firstRefused + 1}`);
  ok("  and the administrators are told exactly once", spread.filter((r) => r.accountLocked).length === 1);

  // One machine spraying many accounts.
  const sprayer = "203.0.113.99";
  const sprayed = [];
  for (let i = 0; i < 25; i++) sprayed.push(await T.reserveAttempt(T.keysFor(`${run}-u${i}`, sprayer)));
  ok(`one address trying many accounts is stopped after ${T.LIMITS.address}`, sprayed.findIndex((r) => !r.allowed) === T.LIMITS.address);

  // A correct password gives its attempt back.
  const carol = T.keysFor(`${run}-carol`, "203.0.113.20");
  for (let i = 0; i < 5; i++) { await T.reserveAttempt(carol); await T.releaseAttempt(carol); }
  ok("signing in correctly never counts against anyone", (await T.reserveAttempt(carol)).allowed);

  // The pause ends.
  const later = new Date(Date.now() + T.WINDOW_MS + T.LOCK_MS + 60_000);
  ok("fifteen minutes later the same person can try again", (await T.reserveAttempt(same, later)).allowed);

  await T.clearAccount(`${run}-bob`);
  ok("an administrator's unlock clears the pause", (await T.reserveAttempt(T.keysFor(`${run}-bob`, "192.0.2.1"))).allowed);
} finally {
  await db.signInThrottle.deleteMany({ where: { OR: [{ key: { contains: run } }, { key: { in: ["ip:203.0.113.5", "ip:198.51.100.7", "ip:203.0.113.99", "ip:203.0.113.20", ...Array.from({ length: 14 }, (_, i) => `ip:192.0.2.${i + 1}`)] } }] } });
}

/* ==================================== SEC-7 · telling strangers nothing ==== */
console.log("\nSEC-7 · the sign-in screen");
const login = read("src/app/login/actions.ts");
ok("the password is checked only after the attempt is counted", login.indexOf("reserveAttempt(keys)") < login.indexOf("bcrypt.compare(password"));
ok("one message for every wrong answer", (login.match(/return WRONG;/g) ?? []).length === 1 && !/attempts? left/.test(login));
ok("the pause message does not depend on whether the account exists", /keysFor\(user\?\.id \?\? `email:\$\{email\}`/.test(login));

/* ======================================== SEC-5 / SEC-11 · approvals ======= */
console.log("\nSEC-5 / SEC-11 · approvals");
const decide = fn(read("src/app/(app)/approvals/actions.ts"), "decideStep");
ok("whoever raised a request cannot approve it", /request\.requestedById === me\.id/.test(decide) && /You raised this request/.test(decide));
ok("nobody decides two steps of the same request", /already decided an earlier step/.test(decide));
ok("the decision is recorded only if the step is still waiting", /approvalStep\.updateMany\(\{\s*where: \{ id: stepId, status: "Pending" \}/.test(decide) && /taken\.count === 0/.test(decide));
const back = fn(read("src/app/(app)/approvals/actions.ts"), "sendBackStep");
ok("sending back needs the same permission as approving", /allow\("approvals\.inbox", "approve"\)/.test(back));
ok("  and the level the step itself requires", /membership\.approvalLevel < step\.requiredLevel/.test(back));
ok("  and refuses whoever raised it", /You raised this request/.test(back));
ok("  and only while that step is the one waiting",
  /step\.order !== request\.currentStep/.test(back) && /status: "Pending"/.test(back));
ok("it only goes backwards, never forwards", /toOrder < 1 \|\| toOrder >= step\.order/.test(back));
ok("a reason is required, because the next person has only those words",
  /said\.length < 3/.test(back) && /Say what needs correcting/.test(back));
ok("every stage from there up waits again, its old decision cleared",
  /order: \{ gte: toOrder \}/.test(back) && /decidedBy: null, decidedById: null, decidedAt: null/.test(back),
  "an approval given above the correction was given to a different document");
ok("the send-back is kept as its own record, with who and why",
  /approvalReturn\.create/.test(back) && /fromOrder/.test(back) && /reason: said/.test(back));
ok("  and the approvers it lands on are told", /notifyApprovers/.test(back));
ok("  and it is on the audit trail", /Sent "\$\{request\.title\}" back/.test(back));

const sources = ["src/app/(app)/approvals/actions.ts", "src/lib/purchase-posting.ts", "src/lib/quote-posting.ts"];
const creates = sources.flatMap((f) => [...read(f).matchAll(/approvalRequest\.create\(\{[\s\S]*?requestedBy: [^\n]+\n([^\n]+)/g)].map((m) => [f, m[1]]));
ok("every place that raises a request records who, by account", creates.length >= 4 && creates.every(([, next]) => /requestedById/.test(next)), `${creates.length} places`);

/* ========================================== SEC-8 / SEC-10 · sessions ====== */
console.log("\nSEC-8 / SEC-10 · sessions");
{
  const saved = { env: process.env.NODE_ENV, secret: process.env.AUTH_SECRET, phase: process.env.NEXT_PHASE };
  process.env.NODE_ENV = "production"; delete process.env.NEXT_PHASE;
  delete process.env.AUTH_SECRET;
  let threw = false; try { tokens.authSecret(); } catch { threw = true; }
  ok("a production server refuses to run without AUTH_SECRET", threw);
  process.env.AUTH_SECRET = "dev-secret-change-me";
  threw = false; try { tokens.authSecret(); } catch { threw = true; }
  ok("  or with the value that used to be the fallback", threw);
  process.env.AUTH_SECRET = "x".repeat(48);
  ok("  and accepts a real one", tokens.authSecret() === "x".repeat(48));
  process.env.NEXT_PHASE = "phase-production-build"; delete process.env.AUTH_SECRET;
  threw = false; try { tokens.authSecret(); } catch { threw = true; }
  ok("  while a build without it still completes", !threw);
  Object.assign(process.env, { NODE_ENV: saved.env ?? "" });
  if (saved.env === undefined) delete process.env.NODE_ENV;
  if (saved.secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = saved.secret;
  if (saved.phase === undefined) delete process.env.NEXT_PHASE; else process.env.NEXT_PHASE = saved.phase;
}
ok("mail passwords are encrypted under the same rule", /authSecret\(\)/.test(read("src/lib/secrets.ts")) && !/dev-secret-change-me/.test(read("src/lib/secrets.ts")));
{
  const t = await tokens.signSession({ uid: "u", tid: "t", name: "n", email: "e" });
  const body = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
  ok("a session lasts twelve hours, not seven days", body.exp - body.iat === 12 * 3600, `${(body.exp - body.iat) / 3600} h`);
  ok("  and the cookie is set for the same", /maxAge: SESSION_SECONDS/.test(read("src/lib/auth.ts")) && /maxAge: SESSION_SECONDS/.test(read("src/app/(app)/account/actions.ts")));
}
const auth = read("src/lib/auth.ts");
ok("signing out ends every session issued before it", /sessionsEndedAt: new Date\(\)/.test(fn(login, "logout")) && /t\.iat \* 1000 < user\.sessionsEndedAt\.getTime\(\)/.test(auth));
ok("  at no extra cost: read from the user row already loaded", auth.indexOf("sessionsEndedAt") > auth.indexOf("db.user.findUnique"));

/* ================================================ SEC-9 · Tally ============ */
console.log("\nSEC-9 · where the server may connect");
ok("the host's own private network is refused", ["10.0.0.5", "172.20.1.1", "192.168.1.20", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:10.0.0.1"].every(isPrivateAddress));
ok("public addresses are allowed", !isPrivateAddress("94.200.10.4") && !isPrivateAddress("8.8.8.8"));
ok("internal names are refused", ["localhost", "postgres.railway.internal", "tally.local", "tally"].every((h) => hostProblem(h)));
ok("URLs, credentials, paths and spaces are refused", ["http://x.com", "a@x.com", "x.com/a", "x .com", "x.com:9000"].every((h) => hostProblem(h)));
ok("a public host name is accepted", hostProblem("tally.wandb.ae") === null && hostProblem("94.200.10.4") === null);
ok("ports are 1 to 65535", cleanPort(9000) === 9000 && cleanPort(0) === null && cleanPort(70000) === null && cleanPort("x") === null);
const tally = read("src/lib/tally.ts");
ok("where the name resolves is checked again at connection time", tally.indexOf("lookup(host") < tally.indexOf("fetch(") && /isPrivateAddress\(r\.address\)/.test(tally));

/* ================================================== SEC-12 · scripts ======= */
console.log("\nSEC-12 · inline scripts");
const n1 = makeNonce(), n2 = makeNonce();
const policy = contentSecurityPolicy(n1, true);
const scriptSrc = policy.split("; ").find((d) => d.startsWith("script-src"));
ok("each page gets a fresh nonce", n1 !== n2 && n1.length >= 22);
ok("scripts need the nonce; 'unsafe-inline' is gone", scriptSrc.includes(`'nonce-${n1}'`) && !scriptSrc.includes("'unsafe-inline'"), scriptSrc);
ok("no eval in production", !scriptSrc.includes("unsafe-eval") && contentSecurityPolicy(n1, false).includes("unsafe-eval"));

/* ================================ company filters · scope only narrows ===== */
console.log("\nCompany filters");
{
  const { companyScope, ALL_COMPANIES } = libs["company-scope"];
  const mine = [{ id: "A" }, { id: "B" }];
  ok("no pick shows every company you belong to", JSON.stringify(companyScope(mine, undefined)) === JSON.stringify({ ids: ["A", "B"], current: ALL_COMPANIES }));
  ok("a pick shows only that company", JSON.stringify(companyScope(mine, "B").ids) === '["B"]');
  ok("a company you do not belong to is ignored, never shown", JSON.stringify(companyScope(mine, "Z").ids) === '["A","B"]');
  const screens = ["hr/page.tsx", "approvals/page.tsx", "dashboard/page.tsx", "hr/manhours/page.tsx", "hr/overtime/page.tsx", "hr/reports/page.tsx", "hr/separation/page.tsx", "hr/tasks/page.tsx"];
  const missing = screens.filter((f) => { const src = read(`src/app/(app)/${f}`); return !/companyScope\(/.test(src) || !/<CompanyPicker[\s\S]{0,300}?allowAll/.test(src); });
  ok("every group-wide screen has a company filter", missing.length === 0, missing.join(", ") || `${screens.length} screens`);
  ok("HR Tasks lists only your own companies' tasks", /id: \{ in: session\.companies\.map\(\(c\) => c\.id\) \}/.test(read("src/app/(app)/hr/tasks/page.tsx")));
  ok("the People tiles count everyone matching, not the page on screen", /db\.employee\.count\(\{ where: \{ \.\.\.empWhere, status: "Active" \} \}\)/.test(read("src/app/(app)/hr/page.tsx")) && !/employees\.filter\(\(e\) => e\.status === "Active"\)/.test(read("src/app/(app)/hr/page.tsx")));
}

/* ==================================== approvals: who sees which request == */
console.log("\nApprovals — who sees which request");
{
  const { canSeeRequest, waitingFor } = libs["approval-visibility"];
  // A sales quotation (Ops Manager 70 → Director 80), raised by the estimator.
  const quote = { requestedById: "est", requestedBy: "Estimator", status: "Pending", currentStep: 1,
    steps: [{ order: 1, requiredLevel: 70, decidedById: null, decidedBy: null }, { order: 2, requiredLevel: 80, decidedById: null, decidedBy: null }] };
  // A material request (Site Eng 35 → PM 50 → Procurement 45), raised by the site engineer.
  const mr = { requestedById: "site", requestedBy: "Site", status: "Pending", currentStep: 1,
    steps: [{ order: 1, requiredLevel: 35, decidedById: null, decidedBy: null }, { order: 2, requiredLevel: 50, decidedById: null, decidedBy: null }, { order: 3, requiredLevel: 45, decidedById: null, decidedBy: null }] };
  const who = (id, level, mayApprove = true) => ({ id, name: id, level, mayApprove });

  ok("a storekeeper does not see sales quotations", !canSeeRequest(quote, who("store", 20, false)));
  ok("a site engineer does not see sales quotations", !canSeeRequest(quote, who("site2", 35)));
  ok("the estimator who raised it sees their own quotation", canSeeRequest(quote, who("est", 40)));
  ok("the Operations Manager who approves it sees it", canSeeRequest(quote, who("ops", 70)));
  ok("directors see everything", canSeeRequest(quote, who("dir", 80)) && canSeeRequest(mr, who("dir", 80)));
  ok("someone who can only view the inbox sees only what they raised", !canSeeRequest(mr, who("acc", 45, false)));
  ok("someone outside the company sees nothing", !canSeeRequest(mr, who("x", -1)));
  const decided = { ...quote, steps: [{ ...quote.steps[0], decidedById: "ops2" }, quote.steps[1]] };
  ok("whoever decided a step keeps seeing the request", canSeeRequest(decided, who("ops2", 20, false)));

  ok("my queue: the site engineer who raised it is not asked to approve it", !waitingFor(mr, who("site", 35)));
  ok("my queue: another site engineer is", waitingFor(mr, who("site2", 35)));
  const atPm = { ...mr, currentStep: 2, steps: [{ ...mr.steps[0], decidedById: "pm", status: "Approved" }, mr.steps[1], mr.steps[2]] };
  ok("my queue: whoever decided step one is not asked for step two", !waitingFor(atPm, who("pm", 50)));
  ok("my queue: nobody without Approve is asked", !waitingFor(mr, who("site3", 35, false)));

  const page = read("src/app/(app)/approvals/page.tsx");
  ok("the inbox lists only the requests you may see", /const visible = requests\.filter/.test(page) && /\{visible\.map\(/.test(page) && !/\{requests\.map\(/.test(page));
  ok("the dashboard counts only what is waiting for you", /waitingFor\(r,/.test(read("src/app/(app)/dashboard/page.tsx")));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
