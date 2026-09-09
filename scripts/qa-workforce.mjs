/**
 * The workforce mix screen, against the running application.
 *
 * The arithmetic is held in test-workforce.mjs. This exists for one claim that
 * only a real page can settle: that supplied labour is genuinely absent from
 * the mix. Thirty supplied workers of one nationality are created alongside
 * twelve of our own; if any of them leaked into the report the percentages
 * would be somebody else's, and the company would plan hiring from them.
 *
 * Named qa- because it drives the running app, like qa-smoke. Everything it
 * writes is removed again, whether it passes or not.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/qa-workforce.mjs
 */
import { PrismaClient } from "@prisma/client";
import { signSession, SESSION_COOKIE } from "../src/lib/session-token.ts";
import fs from "node:fs";
for (const l of fs.readFileSync(".env","utf8").split(/\r?\n/)) { const t=l.trim(); if(!t||t.startsWith("#"))continue; const i=t.indexOf("="); if(i<0)continue; const k=t.slice(0,i).trim(); if(!process.env[k])process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,""); }
const db = new PrismaClient(); let pass=0, fail=0;
const ok=(n,c,x="")=>{c?pass++:fail++;console.log(`  ${c?"PASS":"FAIL"} ${n}${x?"  — "+x:""}`);};
const tenant = await db.tenant.findFirst();
const co = await db.company.findFirst({ where: { code: "WBE" } });
const admin = await db.user.findFirst({ where: { tenantId: tenant.id, memberships: { some: { role: { approvalLevel: { gte: 80 } } } } } });
const t = await signSession({ uid: admin.id, tid: tenant.id, name: admin.name, email: admin.email });
const get = async (p) => { const r = await fetch("http://localhost:3000"+p, { headers: { cookie: `${SESSION_COOKIE}=${t}` }, redirect: "manual" });
  // React separates {expression} from adjacent text with comment markers,
  // so "15 own employees" is really "15<!-- --> own employees". Reading the
  // rendered words means removing them first.
  const raw = await r.text();
  return { status: r.status, html: raw, text: raw.replace(/<!--\s*-->/g, "") }; };

const MARK = "WFTEST";
const made = [];
const clean = async () => { if (made.length) await db.employee.deleteMany({ where: { id: { in: made } } }); made.length = 0; };
await clean();

try {
  const base = await get(`/hr/workforce?c=${co.id}`);
  ok("the screen renders", base.status === 200, String(base.status));
  ok("it says own employees only", base.html.includes("Own employees only"));
  ok("and names the target as the company's own", base.html.includes("is yours, not ours"));

  const before = await db.employee.count({ where: { companyId: co.id, status: { not: "Inactive" }, employmentType: { not: "Supplied" } } });
  const suppliedBefore = await db.employee.count({ where: { companyId: co.id, status: { not: "Inactive" }, employmentType: "Supplied" } });

  // Twelve of our own, plus thirty supplied. If supplied leaked in, the mix
  // would read 30-odd per cent Indian instead of the truth.
  for (let i = 0; i < 12; i++) {
    const e = await db.employee.create({ data: { companyId: co.id, empNo: `${MARK}-O${i}`, name: `Own ${i}`, nationality: "Nepali", employmentType: "Full-time", status: "Active", basicSalary: 2000 } });
    made.push(e.id);
  }
  for (let i = 0; i < 30; i++) {
    const e = await db.employee.create({ data: { companyId: co.id, empNo: `${MARK}-S${i}`, name: `Supplied ${i}`, nationality: "Bangladeshi", employmentType: "Supplied", supplier: "Test Manpower", status: "Active", basicSalary: 1500 } });
    made.push(e.id);
  }

  const after = await get(`/hr/workforce?c=${co.id}`);
  const total = before + 12;
  ok("only our own employees are counted", after.text.includes(`${total} own employees`), `expected ${total}`);
  ok("every supplied worker is reported as excluded",
    after.text.includes(`${suppliedBefore + 30} workers are excluded`), `${suppliedBefore} were already there`);
  ok("and their nationality is not in the mix table",
    !new RegExp(`>Bangladeshi<`).test(after.html), "Bangladeshi appeared only among supplied labour");
  ok("our own Nepali staff are", after.html.includes(">Nepali<"));

  // Now push one nationality over the target and check the hiring gap appears.
  for (let i = 0; i < 40; i++) {
    const e = await db.employee.create({ data: { companyId: co.id, empNo: `${MARK}-D${i}`, name: `Dom ${i}`, nationality: "Nepali", employmentType: "Full-time", status: "Active", basicSalary: 2000 } });
    made.push(e.id);
  }
  const over = await get(`/hr/workforce?c=${co.id}`);
  ok("going over the target is reported", over.html.includes("What would bring it under"));
  ok("with the hires needed", /more employees of other nationalities/.test(over.html));
  ok("and the equivalent reduction", /fewer Nepali nationals/.test(over.html));
  ok("and the visas falling due, which move it without dismissing anybody",
    /visas expiring within 90 days/.test(over.html));
  ok("the wording never calls the target a legal limit",
    !/legal limit|required by law|the law requires/i.test(over.html));

  // Somebody with no nationality must turn the figure into a range.
  const blank = await db.employee.create({ data: { companyId: co.id, empNo: `${MARK}-B`, name: "No nationality", employmentType: "Full-time", status: "Active", basicSalary: 2000 } });
  made.push(blank.id);
  const ranged = await get(`/hr/workforce?c=${co.id}`);
  ok("a missing nationality is shown, not hidden", ranged.html.includes("Not recorded"));
  ok("and turns the share into a range", /is between [\d.]+% and [\d.]+%/.test(ranged.text),
    (ranged.text.match(/is between [\d.]+% and [\d.]+%/) ?? ["not shown"])[0]);
} finally {
  await clean();
}
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
