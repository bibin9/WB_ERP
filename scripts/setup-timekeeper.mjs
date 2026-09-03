// Creates a restricted "Site Timekeeper" role + user with access to ONLY the HR Attendance screen.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();

const tenant = await db.tenant.findFirst({ where: { key: "wandb" } });
const wbe = await db.company.findFirst({ where: { tenantId: tenant.id, code: "WBE" } });

const perms = JSON.stringify({ "hr.attendance": ["view", "create", "edit"] });
const role = await db.role.upsert({
  where: { tenantId_name: { tenantId: tenant.id, name: "Site Timekeeper" } },
  update: { approvalLevel: 10, permissions: perms },
  create: { tenantId: tenant.id, name: "Site Timekeeper", approvalLevel: 10, permissions: perms },
});

const passwordHash = await bcrypt.hash("test123", 10);
const user = await db.user.upsert({
  where: { tenantId_email: { tenantId: tenant.id, email: "timekeeper@wandb.ae" } },
  update: { passwordHash },
  create: { tenantId: tenant.id, email: "timekeeper@wandb.ae", name: "Site Timekeeper", passwordHash },
});
await db.companyMembership.upsert({
  where: { userId_companyId: { userId: user.id, companyId: wbe.id } },
  update: { roleId: role.id },
  create: { userId: user.id, companyId: wbe.id, roleId: role.id },
});

console.log("Created timekeeper@wandb.ae / test123 — access: HR › Attendance only");
await db.$disconnect();
