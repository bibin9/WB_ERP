/**
 * Authorization regression tests.
 *
 * Guards against the class of bug where a screen or a server action checks only
 * "is signed in / is this company mine" and forgets the screen permission — which
 * let a view-only role (e.g. Site Timekeeper) read and edit HR records.
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p.split(path.sep).join("/"));
  }
  return out;
};

const files = walk("src/app");

/* 1. Every page under (app) is permission-gated, except the few that are
      deliberately open to any signed-in user. */
const OPEN_PAGES = new Set([
  "src/app/(app)/dashboard/page.tsx",   // adapts to whatever the user can see
  "src/app/(app)/account/page.tsx",     // own profile / password
  "src/app/(app)/help/page.tsx",        // help centre
  "src/app/(app)/notifications/page.tsx", // own notifications
]);
const pages = files.filter((f) => /src\/app\/\(app\)\/.*page\.tsx$/.test(f));
const ungated = pages.filter((f) => !OPEN_PAGES.has(f) && !read(f).includes("requireAccess("));
ok("every (app) page calls requireAccess (or is explicitly open)", ungated.length === 0, ungated.join(", ") || `${pages.length} pages checked`);

/* 2. Screens that expose personal data are gated even outside the (app) group. */
ok("employee profile page is gated", read("src/app/(app)/hr/employees/[id]/page.tsx").includes('requireAccess("hr.employees")'));
ok("settlement statement page is gated", read("src/app/statement/[id]/page.tsx").includes('requireAccess("hr.separation")'));
ok("document download API is gated", read("src/app/api/documents/[id]/route.ts").includes('can(session, "hr.employees")'));

/* 3. Every exported server action carries a permission check.
      Admin-only files use canAdminister() instead of a screen key. */
const actionFiles = files.filter((f) => /actions\.ts$/.test(f) && !f.endsWith("login/actions.ts"));
const SELF_SERVICE = new Set([
  "src/app/(app)/account/actions.ts",        // own password
  "src/app/(app)/notifications/actions.ts",  // own notifications
]);
const gaps = [];
for (const f of actionFiles) {
  if (SELF_SERVICE.has(f)) continue;
  const src = read(f);
  const bodies = src.split(/export async function /).slice(1);
  for (const b of bodies) {
    const name = b.slice(0, b.indexOf("("));
    const head = b.slice(0, 900);
    if (!/await allow\(|await allowIn\(|canAdminister\(\)|await guard\(\)/.test(head)) gaps.push(`${f}:${name}`);
  }
}
ok("every server action checks permissions", gaps.length === 0, gaps.join(", ") || `${actionFiles.length} files checked`);

/* 4. Destructive UI controls are permission-aware, so a view-only role is not
      shown buttons the server would refuse. */
const rawDelete = files.filter((f) => f.endsWith("page.tsx") && read(f).includes("<ConfirmDelete"));
ok("delete controls on pages use GuardedDelete", rawDelete.length === 0, rawDelete.join(", ") || "all pages use GuardedDelete");

/* 5. The guard helpers behave as advertised. */
const guard = read("src/lib/guard.ts");
ok("requireAccess redirects when denied", /redirect\("\/dashboard"\)/.test(guard));
ok("allow() returns null rather than redirecting", /export async function allow\b[\s\S]{0,220}return null;/.test(guard));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
