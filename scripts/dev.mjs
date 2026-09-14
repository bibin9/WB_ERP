/**
 * Start the dev server on the port this worktree is meant to use.
 *
 * `next dev` reads PORT from the real process environment, not from .env, so
 * setting it there did nothing. What it does instead is quietly take the next
 * free port when its default is busy — which meant phase 2 landed on 3001 only
 * because phase 1 happened to be holding 3000 at that moment. Stop phase 1 and
 * phase 2 takes 3000, while every QA script goes on looking at 3001 and finds
 * nothing there.
 *
 * Working by coincidence is worse than not working, because it works right up
 * until the day it matters. The port is read from .env here and passed to Next
 * explicitly, so each worktree lands where it says it will or fails saying why.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split(/\r?\n/) : []) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const port = Number(process.env.PORT) || 3000;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`PORT is "${process.env.PORT}", which is not a port.`);
  process.exit(1);
}

console.log(`Starting on port ${port} (set PORT in .env to change it).`);

/**
 * Next's own entry point, run through node.
 *
 * Not `npx`: on Windows that resolves to npx.cmd, which cannot be spawned
 * without a shell and fails with EINVAL. Going straight to the binary needs no
 * shell on any platform, and uses the copy installed in this worktree rather
 * than whatever a lookup happens to find.
 */
const NEXT = "node_modules/next/dist/bin/next";
if (!existsSync(NEXT)) {
  console.error("Next is not installed in this worktree. Run npm install first.");
  process.exit(1);
}

// Inherited stdio so Next's own output is the output, and the exit code is
// passed through so a failed start is a failed command.
const child = spawn(process.execPath, [NEXT, "dev", "-p", String(port)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
