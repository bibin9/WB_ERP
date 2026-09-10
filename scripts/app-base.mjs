/**
 * Where the running application is, for the scripts that drive it in a browser.
 *
 * Four of the QA scripts had "http://localhost:3000" written into them. That
 * was fine while one copy of the project existed. It stopped being fine the
 * moment phase 2 got its own worktree: the second copy runs on another port,
 * and a hardcoded 3000 would have pointed its QA at the *other* branch's
 * application — passing happily while testing code that was not under test.
 *
 * A wrong answer that looks like a right one is the worst kind, so the base
 * address is worked out in one place and read from the environment.
 *
 * PORT is the same variable the dev server itself takes, so setting it once
 * moves both the server and the checks that drive it.
 */
import fs from "node:fs";

/**
 * Load .env the way the server does.
 *
 * AUTH_SECRET has to match or a signed session will not verify, and each
 * worktree carries its own file. Anything already in the real environment
 * wins, so a command-line override still works.
 */
export function loadEnv() {
  const lines = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split(/\r?\n/) : [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

loadEnv();

/** The address this worktree's application is served on. */
export const APP_BASE =
  process.env.APP_BASE ||
  process.env.SMOKE_BASE ||
  `http://localhost:${process.env.PORT || 3000}`;
