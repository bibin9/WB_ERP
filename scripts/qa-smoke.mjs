/**
 * Live smoke of every screen, as two different roles.
 *
 * A page that throws at render still returns a shell in dev, so this checks the
 * status AND the body: a Next.js error page, an unhandled digest, or an empty
 * main all count as a failure. Run against the dev server.
 *
 *   node --experimental-strip-types scripts/qa-smoke.mjs
 *
 * Sessions are minted with the app's own signing key rather than by driving the
 * login form, so the sweep does not depend on the browser.
 */
import { PrismaClient } from "@prisma/client";
import { signSession, SESSION_COOKIE } from "../src/lib/session-token.ts";
import { SCREENS } from "../src/lib/rbac.ts";
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";
const db = new PrismaClient();

// Load AUTH_SECRET the way the server does, or the signature will not verify.
for (const line of fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split(/\r?\n/) : []) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const EXTRA = ["/dashboard", "/account", "/help", "/notifications", "/companies", "/audit", "/settings"];
const paths = [...new Set([...SCREENS.map((s) => s.href), ...EXTRA])].sort();

async function sweep(label, user) {
  const token = await signSession({ uid: user.id, tid: user.tenantId, name: user.name, email: user.email });
  const cookie = `${SESSION_COOKIE}=${token}`;
  const rows = [];
  for (const p of paths) {
    let status = 0, body = "", err = "";
    try {
      const res = await fetch(BASE + p, { headers: { cookie }, redirect: "manual" });
      status = res.status;
      body = await res.text();
    } catch (e) {
      err = String(e.message || e);
    }
    // Next renders a digest'd error page rather than a 500 in some cases.
    const crashed =
      /Application error: a server-side exception|__NEXT_ERROR_CODE|Internal Server Error/i.test(body) ||
      status >= 500;
    const redirected = status >= 300 && status < 400;
    rows.push({ path: p, status, crashed, redirected, err, bytes: body.length });
  }
  return { label, rows };
}

const admin = await db.user.findFirst({ where: { email: "admin@wandb.ae" } });
if (!admin) {
  console.error("No admin@wandb.ae in the database — run the seed first.");
  process.exit(1);
}

// A deliberately narrow role, to check the gates actually bite.
const narrow = await db.user.findFirst({
  where: { email: { not: "admin@wandb.ae" } },
  include: { memberships: { include: { role: true } } },
});

const runs = [await sweep("Group Admin", admin)];
if (narrow) runs.push(await sweep(`${narrow.name} (${narrow.memberships[0]?.role.name ?? "no role"})`, narrow));

let crashes = 0;
for (const run of runs) {
  console.log(`\n=== ${run.label} ===`);
  for (const r of run.rows) {
    const mark = r.err ? "ERR " : r.crashed ? "CRASH" : r.redirected ? "gate" : "ok  ";
    if (r.crashed || r.err) crashes++;
    console.log(`  ${mark}  ${String(r.status).padEnd(3)}  ${r.path.padEnd(26)} ${r.err || `${r.bytes}b`}`);
  }
  const okCount = run.rows.filter((r) => !r.crashed && !r.err && !r.redirected).length;
  const gated = run.rows.filter((r) => r.redirected).length;
  console.log(`  -> ${okCount} rendered, ${gated} gated/redirected, ${run.rows.filter((r) => r.crashed || r.err).length} broken`);
}

console.log(`\nTotal broken screens: ${crashes}`);
await db.$disconnect();
process.exit(crashes ? 1 : 0);
