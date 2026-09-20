/**
 * The sign-in throttle under load, on the database the app really uses.
 *
 * scripts/perf.mjs races vouchers, stock and numbering. It does not touch
 * sign-in, because sign-in is a server action and the harness calls libraries.
 * The throttle is the one piece of the September security work whose whole
 * purpose is to behave under simultaneous requests (lib/signin-throttle.ts),
 * so it is measured here against the same PostgreSQL, through the same
 * library the sign-in screen calls.
 *
 * It writes only SignInThrottle rows under keys carrying this run's stamp,
 * never touches a real account, and deletes every row it made — then counts
 * the table before and after to prove it.
 *
 * Run through the same wrapper as the stress test, which confirms the target
 * and refuses production:
 *
 *   node scripts/perf-uat.mjs --target=uat --confirm-host=<host:port> --signin
 */
import { performance } from "node:perf_hooks";
import { importLibs } from "./lib-shim.mjs";

const url = process.env.DATABASE_URL || "";
const hostPort = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port || "5432"}`.toLowerCase(); } catch { return ""; } };
if (!/^postgres(ql)?:\/\//i.test(url) || !process.env.PERF_CONFIRM_HOST || hostPort(url) !== process.env.PERF_CONFIRM_HOST.toLowerCase()) {
  console.error("Run this through scripts/perf-uat.mjs, which confirms the target first.");
  process.exit(1);
}

const libs = await importLibs(["db", "signin-throttle"]);
const { db } = libs.db;
const T = libs["signin-throttle"];

const ms = (n) => `${Math.round(n)} ms`;
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const log = (s = "") => console.log(s);
const stamp = `PS${String(Date.now()).slice(-6)}`;
const results = { target: process.env.PERF_CONFIRM_HOST, startedAt: new Date().toISOString(), sections: {} };

log(`\nSIGN-IN THROTTLE · ${results.target}\n`);
const before = await db.signInThrottle.count();
log(`  ${before.toLocaleString()} throttle rows before this run`);

let failure = null;
try {
  /* ---------------------------------- one machine, guesses all at once -- */
  // What an attacker does: fire everything at the same instant and hope the
  // counter is read before it is written. Only three may reach a password.
  for (const workers of [10, 30, 60]) {
    const keys = T.keysFor(`${stamp}-a${workers}`, `198.51.100.${workers}`);
    const t = performance.now();
    const rs = await Promise.all(Array.from({ length: workers }, () => T.reserveAttempt(keys).catch((e) => ({ allowed: true, error: String(e?.message ?? e) }))));
    const took = performance.now() - t;
    const allowed = rs.filter((r) => r.allowed).length;
    const errors = rs.filter((r) => r.error).length;
    results.sections[`${workers} at once`] = { allowed, limit: T.LIMITS.pair, ms: Math.round(took), errors };
    log(`  ${String(workers).padStart(2)} guesses at once   ${ms(took).padStart(8)}   ${allowed} reached a password check (limit ${T.LIMITS.pair})${errors ? `   ${errors} error(s)` : ""}`);
  }

  /* ------------------------------ a spraying machine, many accounts ----- */
  const sprayer = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  const t2 = performance.now();
  const spray = await Promise.all(Array.from({ length: 40 }, (_, i) => T.reserveAttempt(T.keysFor(`${stamp}-s${i}`, sprayer))));
  results.sections["one machine, 40 accounts"] = { allowed: spray.filter((r) => r.allowed).length, limit: T.LIMITS.address, ms: Math.round(performance.now() - t2) };
  log(`  one machine trying 40 accounts   ${ms(performance.now() - t2).padStart(8)}   ${spray.filter((r) => r.allowed).length} allowed (limit ${T.LIMITS.address})`);

  /* --------------------------- what it costs an ordinary sign-in -------- */
  // The price of the fix on the path everybody uses: count, then hand back.
  const times = [];
  for (let i = 0; i < 20; i++) {
    const keys = T.keysFor(`${stamp}-ok${i}`, "192.0.2.77");
    const t = performance.now();
    await T.reserveAttempt(keys);
    await T.releaseAttempt(keys);
    times.push(performance.now() - t);
  }
  results.sections["an ordinary sign-in"] = { p50: Math.round(pct(times, 0.5)), p95: Math.round(pct(times, 0.95)) };
  log(`  what the throttle adds to one sign-in    p50 ${ms(pct(times, 0.5)).padStart(8)}   p95 ${ms(pct(times, 0.95)).padStart(8)}`);

  /* ------------------------------------------- a crowd signing in ------- */
  // Monday morning: everybody arrives at once, all with the right password.
  const t3 = performance.now();
  await Promise.all(Array.from({ length: 50 }, async (_, i) => {
    const keys = T.keysFor(`${stamp}-crowd${i}`, `192.0.2.${(i % 200) + 1}`);
    const r = await T.reserveAttempt(keys);
    if (r.allowed) await T.releaseAttempt(keys);
    return r.allowed;
  })).then((rs) => {
    const through = rs.filter(Boolean).length;
    results.sections["50 signing in at once"] = { through, ms: Math.round(performance.now() - t3) };
    log(`  50 people signing in at once     ${ms(performance.now() - t3).padStart(8)}   ${through}/50 got through`);
  });
} catch (e) {
  failure = e;
} finally {
  /* ----------------------------------------------------------- clean up -- */
  const removed = await db.signInThrottle.deleteMany({ where: { key: { contains: stamp } } });
  // The spraying and crowd tests also make one row per address.
  await db.signInThrottle.deleteMany({ where: { key: { in: [...Array.from({ length: 200 }, (_, i) => `ip:192.0.2.${i + 1}`), ...Array.from({ length: 200 }, (_, i) => `ip:203.0.113.${i + 1}`), ...[10, 30, 60].map((w) => `ip:198.51.100.${w}`)] } } });
  const after = await db.signInThrottle.count();
  results.cleanup = { before, after, removed: removed.count };
  log(`\n  removed ${removed.count} rows · table ${before} before, ${after} after ${after === before ? "— nothing left behind" : "— ROWS LEFT BEHIND"}`);
  if (process.env.PERF_OUT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.PERF_OUT.replace(/\.json$/, "-signin.json"), JSON.stringify(results, null, 2));
  }
  await db.$disconnect();
  if (failure) { console.error(failure); process.exit(1); }
  process.exit(after === before ? 0 : 1);
}
