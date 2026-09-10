/**
 * The checks that keep the checks honest.
 *
 * Phase 2 runs from a second worktree on a second port, against its own
 * database. That makes one old shortcut dangerous: four QA scripts had
 * "http://localhost:3000" written into them, and from the phase-2 copy they
 * would have driven the phase-1 application instead — passing cheerfully while
 * testing code that was not under test.
 *
 * A green result that measured the wrong thing is worse than a red one, so the
 * address now comes from one place and this suite holds it there.
 */
import fs from "node:fs";
import path from "node:path";
import { APP_BASE } from "./app-base.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/* ================================================ one place, not four ==== */

const scripts = fs.readdirSync("scripts").filter((f) => f.endsWith(".mjs"));
const driving = scripts.filter((f) => /^qa-/.test(f) && /fetch\(/.test(read(path.join("scripts", f))));

ok("some scripts drive the running application", driving.length >= 4, driving.join(", "));

for (const f of driving) {
  const src = read(path.join("scripts", f));
  ok(`${f} takes its address from the environment`, /APP_BASE/.test(src));
  ok(`  and has no port written into it`, !/localhost:\d+/.test(src),
    "from the phase-2 worktree that would have driven the phase-1 application");
}

/* ===================================================== what it resolves == */

ok("the base is an address", /^https?:\/\/[^\s]+$/.test(APP_BASE), APP_BASE);
ok("and it carries no trailing slash", !APP_BASE.endsWith("/"),
  "the callers all append a path beginning with one");

/**
 * PORT is the same variable the dev server reads, so setting it once moves the
 * server and everything that drives it together. Getting those two out of step
 * is the failure this whole file exists to prevent.
 */
{
  const before = process.env.PORT;
  try {
    delete process.env.APP_BASE;
    delete process.env.SMOKE_BASE;
    process.env.PORT = "3999";
    const fresh = await import(`./app-base.mjs?probe=${Date.now()}`);
    ok("PORT decides the address", fresh.APP_BASE === "http://localhost:3999", fresh.APP_BASE);
  } finally {
    if (before === undefined) delete process.env.PORT;
    else process.env.PORT = before;
  }
}

{
  const before = process.env.APP_BASE;
  try {
    process.env.APP_BASE = "http://example.test:1234";
    const fresh = await import(`./app-base.mjs?probe=${Date.now()}-b`);
    ok("an explicit address overrides the port", fresh.APP_BASE === "http://example.test:1234");
  } finally {
    if (before === undefined) delete process.env.APP_BASE;
    else process.env.APP_BASE = before;
  }
}

/* ============================================ the worktrees stay apart === */

/**
 * Each worktree carries its own .env, and its own SQLite file follows from the
 * relative path inside it. Both are git-ignored, so neither can travel to the
 * other branch or to the client.
 */
{
  const ignore = read(".gitignore");
  ok("the environment file is never committed", /^\.env$/m.test(ignore));
  ok("nor the local database", /dev\.db/.test(ignore));
  ok("nor installed packages", /node_modules/.test(ignore));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
