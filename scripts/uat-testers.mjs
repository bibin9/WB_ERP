/**
 * Roles, access rights and logins for the business acceptance testers (BAT/UAT).
 *
 * Two jobs, both against Pre-Prod only:
 *
 *   --report                 read every role on Pre-Prod with the screens and
 *                            actions it really has, and the users already set
 *                            up, into perf-results/bat-roles.json — the source
 *                            for the Roles & Access Rights sheet, so the sheet
 *                            says what Pre-Prod does rather than what the seed
 *                            was meant to do.
 *
 *   --create=<testers.csv>   one login per tester on their real role. The CSV
 *                            has a header row: name,email,role,companies — with
 *                            companies as codes separated by ";" (e.g. WBE;WBTS).
 *                            Each gets a temporary password that must be changed
 *                            at first sign-in. The passwords are written ONLY to
 *                            tester-logins/ (git-ignored) on this PC — never
 *                            printed — for the administrator to hand over one by
 *                            one. An email already in use is skipped, not changed.
 *
 *   node scripts/uat-testers.mjs --confirm-host=<host:port> --report
 *   node scripts/uat-testers.mjs --confirm-host=<host:port> --create=testers.csv
 *
 * Uses UAT_DATABASE_URL from .env (never printed). Refuses production, and
 * anything whose host was not confirmed on the command line. Puts the local
 * setup back to SQLite afterwards, as the performance wrapper does.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const hostPort = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port || "5432"}`.toLowerCase(); } catch { return ""; } };
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3);
const redact = (s) => String(s).replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^\s]+@/gi, "$1:****@");

/* ================================================================ outer === */
if (!process.argv.includes("--inner")) {
  const env = loadEnvFile(".env");
  const url = env.UAT_DATABASE_URL || "";
  const prod = process.env.PROD_DATABASE_URL || env.PROD_DATABASE_URL || "";
  if (!/^postgres(ql)?:\/\//i.test(url)) { console.error("\nUAT_DATABASE_URL (Pre-Prod) is not in .env.\n"); process.exit(1); }
  if (prod && hostPort(url) === hostPort(prod)) { console.error("\nThat is the production database. Tester logins are made on Pre-Prod only. Refusing.\n"); process.exit(1); }
  const confirm = arg("confirm-host");
  if (confirm.toLowerCase() !== hostPort(url)) {
    console.error(`\nThis reads${process.argv.some((a) => a.startsWith("--create=")) ? " and writes" : ""} Pre-Prod at ${hostPort(url)}.\nIf that is right, run again with --confirm-host=${hostPort(url)}\n`);
    process.exit(1);
  }
  if (!process.argv.includes("--report") && !arg("create")) { console.error("\nChoose --report or --create=<testers.csv>.\n"); process.exit(1); }

  const SCHEMA = "prisma/schema.prisma";
  const original = readFileSync(SCHEMA, "utf8");
  const pgEnv = { ...process.env, DATABASE_URL: url, PRISMA_PROVIDER: "postgresql", BAT_CONFIRM_HOST: confirm };
  const run = (cmd, args, e) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: e });
  let failed = false;
  try {
    run("node", ["scripts/set-db-provider.mjs"], pgEnv);
    run("npx", ["prisma", "generate"], pgEnv);
    const r = spawnSync("node", ["--experimental-strip-types", "scripts/uat-testers.mjs", "--inner", ...process.argv.slice(2)], { stdio: "inherit", env: pgEnv, shell: process.platform === "win32" });
    failed = r.status !== 0;
  } catch (err) {
    failed = true;
    console.error("\n" + redact(err?.message ?? err));
  } finally {
    writeFileSync(SCHEMA, original);
    const localEnv = { ...process.env };
    delete localEnv.PRISMA_PROVIDER;
    run("node", ["scripts/set-db-provider.mjs"], localEnv);
    run("npx", ["prisma", "generate"], localEnv);
    console.log("Local setup put back to SQLite.");
  }
  process.exit(failed ? 1 : 0);
}

/* ================================================================ inner === */
if (hostPort(process.env.DATABASE_URL || "") !== (process.env.BAT_CONFIRM_HOST || "").toLowerCase()) {
  console.error("Run this without --inner; the outer step confirms the target first.");
  process.exit(1);
}
const { PrismaClient } = await import("@prisma/client");
const { SCREENS } = await import("../src/lib/rbac.ts");
const { temporaryPassword } = await import("../src/lib/password-policy.ts");
const bcrypt = (await import("bcryptjs")).default;
const db = new PrismaClient();
const parse = (json) => { try { const v = JSON.parse(json || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };

const tenant = await db.tenant.findFirst({ where: { key: "wandb" } }) ?? await db.tenant.findFirst();
const companies = await db.company.findMany({ where: { tenantId: tenant.id }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, isActive: true } });
const roles = await db.role.findMany({ where: { tenantId: tenant.id }, orderBy: [{ approvalLevel: "desc" }, { name: "asc" }] });

if (process.argv.includes("--report")) {
  const users = await db.user.findMany({
    where: { tenantId: tenant.id },
    select: { name: true, email: true, isActive: true, mustReset: true, lockedUntil: true, memberships: { select: { company: { select: { code: true } }, role: { select: { name: true } } } } },
    orderBy: { name: "asc" },
  });
  // What each role can really do, screen by screen. Level 80 and above, and the
  // Group Admin role, are given everything by the access check itself.
  const report = {
    at: new Date().toISOString(),
    companies: companies.map((c) => ({ code: c.code, name: c.name, active: c.isActive })),
    roles: roles.map((r) => {
      const perms = parse(r.permissions);
      const everything = r.approvalLevel >= 80 || r.name === "Group Admin";
      const screens = SCREENS.map((s) => {
        const acts = new Set([...(perms[s.key] ?? []), ...(perms[s.module] ?? [])]);
        return { key: s.key, module: s.module, label: s.label, actions: everything ? ["view", "create", "edit", "delete", "approve"] : ["view", "create", "edit", "delete", "approve"].filter((a) => acts.has(a)) };
      }).filter((s) => s.actions.length);
      return { name: r.name, level: r.approvalLevel, everything, screens, users: users.filter((u) => u.memberships.some((m) => m.role.name === r.name)).length };
    }),
    users: users.map((u) => ({
      name: u.name,
      active: u.isActive,
      mustReset: u.mustReset,
      roles: [...new Set(u.memberships.map((m) => m.role.name))],
      companies: u.memberships.map((m) => m.company.code),
    })),
  };
  mkdirSync("perf-results", { recursive: true });
  writeFileSync("perf-results/bat-roles.json", JSON.stringify(report, null, 2));
  console.log(`\n${roles.length} roles, ${users.length} users, ${companies.length} companies on Pre-Prod.`);
  for (const r of report.roles) console.log(`  L${String(r.level).padStart(3)}  ${r.name.padEnd(30)} ${r.everything ? "everything" : `${r.screens.length} screens`}   ${r.users} user(s)`);
  console.log("\nWritten to perf-results/bat-roles.json (git-ignored).");
}

const createFrom = (process.argv.find((a) => a.startsWith("--create=")) ?? "").slice("--create=".length);
if (createFrom) {
  const rows = readFileSync(createFrom, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = rows.shift().toLowerCase().split(",").map((h) => h.trim());
  const need = ["name", "email", "role", "companies"];
  if (!need.every((h) => head.includes(h))) { console.error(`The CSV needs a header row: ${need.join(",")}`); process.exit(1); }
  const col = (cells, h) => (cells[head.indexOf(h)] ?? "").trim();

  const made = [], skipped = [];
  for (const line of rows) {
    const cells = line.split(",");
    const name = col(cells, "name"), email = col(cells, "email").toLowerCase(), roleName = col(cells, "role");
    const codes = col(cells, "companies").split(";").map((c) => c.trim().toUpperCase()).filter(Boolean);
    const role = roles.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
    const picked = companies.filter((c) => codes.includes(c.code));
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped.push(`${name || "(no name)"}: name and a valid email are needed`); continue; }
    if (!role) { skipped.push(`${name}: no role called "${roleName}" on Pre-Prod`); continue; }
    if (picked.length !== codes.length || !codes.length) { skipped.push(`${name}: unknown company in "${codes.join(";")}"`); continue; }
    if (await db.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } })) { skipped.push(`${name}: ${email} already has a login — left as it is`); continue; }

    const password = temporaryPassword();
    const user = await db.user.create({
      data: { tenantId: tenant.id, name, email, passwordHash: await bcrypt.hash(password, 10), mustReset: true },
    });
    await db.companyMembership.createMany({ data: picked.map((c) => ({ userId: user.id, companyId: c.id, roleId: role.id })) });
    await db.auditLog.create({
      data: { tenantId: tenant.id, userName: "BAT setup (script)", action: "Created", entity: "User", entityId: user.id, summary: `Added tester ${name} (${email}) as ${role.name} in ${picked.map((c) => c.code).join(", ")} — must set own password at first sign-in` },
    });
    made.push({ name, email, role: role.name, companies: picked.map((c) => c.code).join(";"), password });
  }

  if (made.length) {
    mkdirSync("tester-logins", { recursive: true });
    const file = `tester-logins/pre-prod-logins-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-5)}.csv`;
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    writeFileSync(file, ["name,email,role,companies,temporary password", ...made.map((m) => [m.name, m.email, m.role, m.companies, m.password].map(q).join(","))].join("\r\n") + "\r\n");
    console.log(`\nCreated ${made.length} login(s):`);
    for (const m of made) console.log(`  ${m.name.padEnd(28)} ${m.email.padEnd(34)} ${m.role} · ${m.companies}`);
    console.log(`\nTemporary passwords are in ${file} — git-ignored, on this PC only.`);
    console.log("Hand each one over privately, then delete the file. Each tester must choose their own password at first sign-in.");
  }
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  if (!made.length && !skipped.length) console.log("\nThe CSV had no testers in it.");
}

await db.$disconnect();
