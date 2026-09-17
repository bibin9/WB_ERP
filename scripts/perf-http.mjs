/**
 * Web-tier load test against a deployed environment, without signing in.
 *
 *   node scripts/perf-http.mjs https://wberp-pre-prod.up.railway.app [--seconds=20]
 *
 * Only requests that need no login and write nothing: the sign-in page, a
 * protected page (which must redirect), the PDF endpoint (which must refuse),
 * and a static script file. Each level runs for a fixed time; the run stops
 * early if more than a fifth of requests fail, rather than pushing a struggling
 * server harder. Production is refused.
 */
import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) { console.error("Give the environment's https address."); process.exit(1); }
if (!/pre-prod|uat|staging|localhost/i.test(base)) { console.error("That does not look like a test environment. Refusing."); process.exit(1); }
const SECONDS = Number((process.argv.find((a) => a.startsWith("--seconds=")) ?? "").split("=")[1]) || 20;
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

// A real script file from the sign-in page, so the static path is exercised.
const loginHtml = await (await fetch(`${base}/login`)).text();
const asset = (loginHtml.match(/\/_next\/static\/chunks\/[^"']+\.js/) || [])[0];

const TARGETS = [
  { name: "sign-in page", path: "/login", ok: (s) => s === 200 },
  { name: "protected page, signed out", path: "/dashboard", ok: (s) => s === 307 || s === 302, redirect: "manual" },
  { name: "PDF endpoint, signed out", path: "/api/pdf/quotation/does-not-exist", ok: (s) => s === 401 || s === 307 || s === 302, redirect: "manual" },
  ...(asset ? [{ name: "static script file", path: asset, ok: (s) => s === 200 }] : []),
];

const results = { base, seconds: SECONDS, levels: [] };
console.log(`\n${base} · ${SECONDS}s per level · ${TARGETS.map((t) => t.name).join(", ")}\n`);

for (const users of [10, 50, 100]) {
  const stats = Object.fromEntries(TARGETS.map((t) => [t.name, { t: [], bad: 0, codes: {}, errors: {} }]));
  const stopAt = performance.now() + SECONDS * 1000;
  let total = 0;
  await Promise.all(Array.from({ length: users }, async (_, u) => {
    let i = u;
    while (performance.now() < stopAt) {
      const target = TARGETS[i++ % TARGETS.length];
      const s = stats[target.name];
      const t0 = performance.now();
      try {
        const res = await fetch(base + target.path, { redirect: target.redirect ?? "follow", signal: AbortSignal.timeout(30_000) });
        await res.arrayBuffer();
        s.codes[res.status] = (s.codes[res.status] ?? 0) + 1;
        if (!target.ok(res.status)) s.bad++;
      } catch (e) {
        s.bad++;
        const key = String(e?.name === "TimeoutError" ? "timeout (30s)" : e?.cause?.code ?? e?.message ?? e).slice(0, 60);
        s.errors[key] = (s.errors[key] ?? 0) + 1;
      }
      s.t.push(performance.now() - t0);
      total++;
    }
  }));
  const bad = Object.values(stats).reduce((a, s) => a + s.bad, 0);
  const level = { users, requests: total, perSecond: Number((total / SECONDS).toFixed(1)), failed: bad, failureRate: Number((bad / Math.max(total, 1)).toFixed(4)), targets: {} };
  console.log(`${String(users).padStart(3)} concurrent · ${total.toLocaleString()} requests · ${level.perSecond}/s · ${bad} failed (${(level.failureRate * 100).toFixed(1)}%)`);
  for (const [name, s] of Object.entries(stats)) {
    level.targets[name] = { count: s.t.length, p50: Math.round(pct(s.t, 0.5)), p95: Math.round(pct(s.t, 0.95)), p99: Math.round(pct(s.t, 0.99)), failed: s.bad, statuses: s.codes, errors: s.errors };
    console.log(`    ${name.padEnd(28)} ${String(s.t.length).padStart(6)}   p50 ${String(level.targets[name].p50).padStart(5)} ms   p95 ${String(level.targets[name].p95).padStart(5)} ms   p99 ${String(level.targets[name].p99).padStart(5)} ms   ${JSON.stringify(s.codes)}${Object.keys(s.errors).length ? "  " + JSON.stringify(s.errors) : ""}`);
  }
  results.levels.push(level);
  if (level.failureRate > 0.2) { console.log("\nMore than a fifth failed at this level. Stopping rather than pushing harder."); break; }
}

// Nothing to clean up: every request here is a read that writes nothing.
mkdirSync("perf-results", { recursive: true });
const out = `perf-results/http-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nResults written to ${out}`);
