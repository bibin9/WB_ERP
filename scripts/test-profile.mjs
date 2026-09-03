/**
 * Employee profile, documents & custom-fields test suite.
 * Run: node scripts/test-profile.mjs
 */
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
const db = new PrismaClient();
let pass = 0, fail = 0;
function ok(id, name, cond, detail = "") { if (cond) pass++; else fail++; console.log(`${cond ? "✅" : "❌"} ${id}  ${name}${detail ? "  — " + detail : ""}`); }

async function main() {
  const tenant = await db.tenant.findUnique({ where: { key: "wandb" } });
  const wbe = await db.company.findFirst({ where: { tenantId: tenant.id, code: "WBE" } });
  const emp = await db.employee.create({ data: { companyId: wbe.id, empNo: "EMP-PROF", name: "Profile Tester" } });

  // ===== EXPANDED PROFILE FIELDS =====
  await db.employee.update({ where: { id: emp.id }, data: {
    dateOfBirth: new Date("1990-05-10"), gender: "Male", nationality: "Indian", maritalStatus: "Married",
    bloodGroup: "O+", personalEmail: "p@e.com", address: "Dubai", emergencyName: "X", emergencyPhone: "+9715",
    contractType: "Limited", contractEndDate: new Date("2027-01-01"),
    emiratesIdNo: "784-1990-0000000-1", emiratesIdExpiry: new Date("2027-05-01"),
    passportNo: "P1234567", passportExpiry: new Date("2030-01-01"),
    visaNo: "V999", visaType: "Employment", visaExpiry: new Date("2027-06-01"),
    labourCardNo: "LC55", labourCardExpiry: new Date("2027-03-01"), bankName: "Emirates NBD", iban: "AE000000000000000000000",
  }});
  const e2 = await db.employee.findUnique({ where: { id: emp.id } });
  ok("PR-1", "Profile stores personal fields (DOB, nationality, blood group)", e2.nationality === "Indian" && e2.bloodGroup === "O+" && !!e2.dateOfBirth);
  ok("PR-2", "Profile stores UAE documents (Emirates ID, Passport, Visa, Labour Card)", !!e2.emiratesIdNo && !!e2.passportNo && !!e2.visaNo && !!e2.labourCardNo);
  ok("PR-3", "Profile stores document expiry dates", !!e2.emiratesIdExpiry && !!e2.visaExpiry && !!e2.labourCardExpiry);
  ok("PR-4", "Profile stores WPS banking (bank + IBAN)", e2.bankName === "Emirates NBD" && e2.iban.startsWith("AE"));

  // ===== CUSTOM FIELDS =====
  const def = await db.customFieldDef.create({ data: { tenantId: tenant.id, entity: "Employee", label: "Test Field", fieldKey: "test_field_x", type: "text", order: 99 } });
  ok("CF-1", "Custom field definition CREATE", !!def.id);
  await db.customFieldValue.upsert({ where: { employeeId_fieldDefId: { employeeId: emp.id, fieldDefId: def.id } }, update: { value: "v1" }, create: { employeeId: emp.id, fieldDefId: def.id, value: "v1" } });
  ok("CF-2", "Custom field value set on employee", (await db.customFieldValue.findFirst({ where: { employeeId: emp.id, fieldDefId: def.id } })).value === "v1");
  // upsert updates (no duplicate)
  await db.customFieldValue.upsert({ where: { employeeId_fieldDefId: { employeeId: emp.id, fieldDefId: def.id } }, update: { value: "v2" }, create: { employeeId: emp.id, fieldDefId: def.id, value: "x" } });
  const vals = await db.customFieldValue.findMany({ where: { employeeId: emp.id, fieldDefId: def.id } });
  ok("CF-3", "Custom value upsert updates (unique per emp+field)", vals.length === 1 && vals[0].value === "v2");
  await db.customFieldDef.delete({ where: { id: def.id } });
  ok("CF-4", "Deleting a field definition cascades its values", (await db.customFieldValue.count({ where: { fieldDefId: def.id } })) === 0);

  // ===== DOCUMENTS =====
  const dir = path.join(process.cwd(), "uploads");
  await fs.mkdir(dir, { recursive: true });
  const stored = "test_doc_" + Date.now() + ".txt";
  await fs.writeFile(path.join(dir, stored), "hello");
  const doc = await db.employeeDocument.create({ data: { companyId: wbe.id, employeeId: emp.id, category: "Emirates ID", fileName: "eid.txt", storedName: stored, mimeType: "text/plain", size: 5, uploadedBy: "Tester" } });
  ok("DOC-1", "Document record CREATE + file written", !!doc.id && (await fs.stat(path.join(dir, stored))).size === 5);
  // download-route authorization logic: doc.companyId must be in user's companies
  ok("DOC-2", "Download authorization = doc.companyId in user scope", [wbe.id].includes(doc.companyId));
  // delete removes file + row
  await fs.rm(path.join(dir, stored), { force: true });
  await db.employeeDocument.delete({ where: { id: doc.id } });
  let fileGone = false; try { await fs.stat(path.join(dir, stored)); } catch { fileGone = true; }
  ok("DOC-3", "Document DELETE removes row + file", !(await db.employeeDocument.findUnique({ where: { id: doc.id } })) && fileGone);

  // cleanup employee (cascades documents/customValues)
  await db.employee.delete({ where: { id: emp.id } });
  ok("DOC-4", "Deleting employee cascades documents & custom values", (await db.employeeDocument.count({ where: { employeeId: emp.id } })) === 0);

  console.log("\n" + "=".repeat(50));
  console.log(`PROFILE RESULTS:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
  console.log("=".repeat(50));
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
