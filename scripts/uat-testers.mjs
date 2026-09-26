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
 *   --reset=<logins.csv>     a fresh temporary password for logins that already
 *                            exist, for handing over before acceptance testing.
 *                            The CSV needs only an "email" column — the sheet
 *                            written by --create will do. Administrator logins
 *                            are refused: a bulk reset that locks out the only
 *                            administrator has nobody left to undo it.
 *
 *   node scripts/uat-testers.mjs --confirm-host=<host:port> --create=testers.csv
 *   node scripts/uat-testers.mjs --confirm-host=<host:port> --reset=logins.csv
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
  if (!process.argv.includes("--report") && !arg("create") && !arg("reset")) { console.error("\nChoose --report, --create=<testers.csv> or --reset=<logins.csv>.\n"); process.exit(1); }

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
    select: { name: true, email: true, isActive: true, mustReset: true, lockedUntil: true, createdAt: true, passwordChangedAt: true, memberships: { select: { company: { select: { code: true } }, role: { select: { name: true } } } } },
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
      createdAt: u.createdAt,
      passwordChangedAt: u.passwordChangedAt,
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

const resetFrom = (process.argv.find((a) => a.startsWith("--reset=")) ?? "").slice("--reset=".length);
if (resetFrom) {
  // Handing over a sheet of passwords somebody else already knows is not a
  // handover. Testers whose accounts were driven by an automated run, or whose
  // temporary password has been sitting in a file for a fortnight, get a fresh
  // one and are made to choose their own at first sign-in — otherwise "raised
  // by Procurement, approved by the Director" records two accounts rather than
  // two people, and the four-eyes rule is decoration.
  const rows = readFileSync(resetFrom, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = rows.shift().toLowerCase().split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  if (!head.includes("email")) { console.error("The CSV needs a header row with an email column."); process.exit(1); }
  const emailAt = head.indexOf("email");

  const done = [], skipped = [];
  for (const line of rows) {
    const email = (line.split(",")[emailAt] ?? "").trim().replace(/^"|"$/g, "").toLowerCase();
    if (!email) continue;
    const user = await db.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      select: { id: true, name: true, memberships: { select: { company: { select: { code: true } }, role: { select: { name: true, approvalLevel: true } } } } },
    });
    if (!user) { skipped.push(`${email}: no such login on Pre-Prod`); continue; }
    // An administrator locked out by a bulk reset has nobody to let them back
    // in. Those are changed one at a time, by the person who owns them.
    if (user.memberships.some((m) => m.role.name === "Group Admin")) {
      skipped.push(`${email}: an administrator login — reset it yourself, not from a list`);
      continue;
    }

    const password = temporaryPassword();
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustReset: true, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
    });
    await db.auditLog.create({
      data: { tenantId: tenant.id, userName: "BAT setup (script)", action: "Updated", entity: "User", entityId: user.id, summary: `Reissued the temporary password for ${user.name} (${email}) before acceptance testing — must choose their own at first sign-in` },
    });
    const roleName = user.memberships[0]?.role.name ?? "";
    const codes = [...new Set(user.memberships.map((m) => m.company.code))].join(";");
    done.push({ name: user.name, email, role: roleName, companies: codes, password });
  }

  if (done.length) {
    mkdirSync("tester-logins", { recursive: true });
    const file = `tester-logins/pre-prod-logins-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-5)}.csv`;
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    writeFileSync(file, ["name,email,role,companies,temporary password", ...done.map((m) => [m.name, m.email, m.role, m.companies, m.password].map(q).join(","))].join("\r\n") + "\r\n");
    console.log(`\nReissued ${done.length} password(s):`);
    for (const m of done) console.log(`  ${m.name.padEnd(28)} ${m.email.padEnd(34)} ${m.role} · ${m.companies}`);
    console.log(`\nThe new temporary passwords are in ${file} — git-ignored, on this PC only, never printed above.`);
    console.log("Hand each tester their own line privately, then delete the file and every earlier one.");
    console.log("Each must choose their own password at first sign-in; after that nobody else knows it.");
  }
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const x of skipped) console.log(`  ${x}`);
  }
  if (!done.length && !skipped.length) console.log("\nThe CSV had no logins in it.");
}

await db.$disconnect();
