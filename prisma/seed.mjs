import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
// First-run admin password. Set ADMIN_PASSWORD in the host env for the pilot/production;
// falls back to a demo value for local dev. Only applied when the admin is first created.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Mirrors src/config/tenant.ts (White & Bright default tenant)
const TENANT = { key: "wandb", name: "White & Bright Group" };
const COMPANIES = [
  { code: "WBE", name: "WB Engineering" },
  { code: "WBTS", name: "WB Technical Services" },
  { code: "VTS", name: "Voice Technical Services" },
];
const V = ["view"], VC = ["view", "create"], VCE = ["view", "create", "edit"], VCED = ["view", "create", "edit", "delete"];
const FULL = ["view", "create", "edit", "delete", "approve"];

// Screen taxonomy (mirrors src/lib/rbac.ts). Role permissions below are authored at MODULE
// level for brevity, then expanded to per-SCREEN keys so access is stored screen-by-screen.
const MODULE_SCREENS = {
  dashboard: ["dashboard.home"],
  companies: ["companies.list"],
  finance: ["finance.overview", "finance.daybook", "finance.ledgers", "finance.reports", "finance.vat", "finance.tally"],
  hr: ["hr.employees", "hr.onboarding", "hr.payroll", "hr.leave", "hr.attendance", "hr.certifications", "hr.reports", "hr.tasks"],
  approvals: ["approvals.inbox"],
  users: ["users.list", "users.access"],
  inventory: ["inventory.items"],
  crm: ["crm.leads"],
  projects: ["projects.list"],
  hse: ["hse.register"],
  audit: ["audit.log"],
  settings: ["settings.general", "settings.master", "settings.approvals", "settings.custom"],
};
const expandPerms = (modulePerms) => {
  const out = {};
  for (const [mod, acts] of Object.entries(modulePerms || {})) {
    for (const scr of MODULE_SCREENS[mod] || [mod]) out[scr] = acts;
  }
  return out;
};
const ROLES = [
  // Admin-level roles (approvalLevel >= 80 get full access automatically)
  { name: "Group Admin", approvalLevel: 100, permissions: {} },
  { name: "Managing Director", approvalLevel: 90, permissions: {} },
  { name: "Director", approvalLevel: 80, permissions: {} },
  // Scoped roles — explicit permissions
  { name: "Operations Manager", approvalLevel: 70, permissions: { dashboard: V, companies: V, finance: V, hr: V, approvals: ["view", "approve"], inventory: ["view", "approve"], crm: V, projects: VCE, hse: V, audit: V } },
  { name: "Finance Controller", approvalLevel: 60, permissions: { dashboard: V, companies: V, finance: FULL, approvals: ["view", "approve"], audit: V } },
  { name: "Project Manager", approvalLevel: 50, permissions: { dashboard: V, projects: VCED, hr: V, inventory: VC, crm: V, approvals: V, hse: V } },
  { name: "Estimation / Sales Engineer", approvalLevel: 40, permissions: { dashboard: V, crm: VCE, projects: V } },
  { name: "Site Engineer / Planner", approvalLevel: 35, permissions: { dashboard: V, inventory: VC, projects: VCE, hr: V, hse: V } },
  { name: "Procurement Officer", approvalLevel: 45, permissions: { dashboard: V, inventory: ["view", "create", "edit", "approve"], crm: V } },
  { name: "Storekeeper", approvalLevel: 20, permissions: { dashboard: V, inventory: VCE } },
  { name: "QA/QC & Calibration", approvalLevel: 40, permissions: { dashboard: V, inventory: ["view", "edit"], hse: V } },
  { name: "HSE Officer", approvalLevel: 45, permissions: { dashboard: V, hse: FULL, hr: V } },
  { name: "HR Officer", approvalLevel: 30, permissions: { dashboard: V, hr: FULL, approvals: V } },
  { name: "Finance / Accounts", approvalLevel: 45, permissions: { dashboard: V, finance: VCE, approvals: V } },
  { name: "Vendor (external)", approvalLevel: 0, permissions: {} },
  { name: "Customer (external)", approvalLevel: 0, permissions: {} },
];

async function main() {
  const tenant = await db.tenant.upsert({
    where: { key: TENANT.key },
    update: { name: TENANT.name },
    create: { key: TENANT.key, name: TENANT.name },
  });

  const companies = [];
  for (const c of COMPANIES) {
    const company = await db.company.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: { name: c.name },
      create: { tenantId: tenant.id, code: c.code, name: c.name, baseCurrency: "AED" },
    });
    companies.push(company);
  }

  for (const r of ROLES) {
    const permissions = JSON.stringify(expandPerms(r.permissions ?? {}));
    await db.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: r.name } },
      update: { approvalLevel: r.approvalLevel, permissions },
      create: { tenantId: tenant.id, name: r.name, approvalLevel: r.approvalLevel, permissions },
    });
  }

  // Master data lists
  const MASTER = {
    Department: ["Projects", "Operations", "Finance", "Fabrication", "HR", "Procurement", "Stores", "QA/QC", "HSE", "Estimation"],
    Designation: ["Project Manager", "Site Engineer", "Estimation Engineer", "Operations Manager", "Accountant", "Storekeeper", "QA/QC Inspector", "HSE Officer", "6G Welder", "Rigger", "Helper", "Procurement Officer"],
    Grade: ["M1", "M2", "M3", "S1", "S2", "S3", "W1", "W2"],
    "Leave Type": ["Annual", "Sick", "Unpaid", "Comp-Off"],
    Nationality: ["Emirati", "Indian", "Pakistani", "Filipino", "Egyptian", "British", "Nepali"],
  };
  for (const [type, values] of Object.entries(MASTER)) {
    for (let i = 0; i < values.length; i++) {
      await db.masterItem.upsert({
        where: { tenantId_type_value: { tenantId: tenant.id, type, value: values[i] } },
        update: {}, create: { tenantId: tenant.id, type, value: values[i], order: i + 1 },
      });
    }
  }

  const adminRole = await db.role.findFirst({ where: { tenantId: tenant.id, name: "Group Admin" } });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await db.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "admin@wandb.ae" } },
    update: {}, // never reset an existing admin's password on redeploy
    create: { tenantId: tenant.id, email: "admin@wandb.ae", name: "Administrator", passwordHash },
  });
  for (const company of companies) {
    await db.companyMembership.upsert({
      where: { userId_companyId: { userId: admin.id, companyId: company.id } },
      update: {},
      create: { userId: admin.id, companyId: company.id, roleId: adminRole.id },
    });
  }

  // A couple of sample job assignments so the HR module isn't empty
  const wbe = companies[0];
  const count = await db.jobAssignment.count({ where: { companyId: wbe.id } });
  if (count === 0) {
    await db.jobAssignment.createMany({
      data: [
        {
          companyId: wbe.id, ticketNo: "JOB/WBE/0001", title: "Prepare monthly stock reconciliation",
          description: "Reconcile main store stock against the system for month-end.",
          priority: "High", assignedToType: "department", assignedTo: "Stores",
          assignedBy: "Administrator", timeAllocation: "2d", status: "In Progress",
        },
        {
          companyId: wbe.id, ticketNo: "JOB/WBE/0002", title: "Renew crane operator certificates",
          description: "Three operators' certificates expire next month.",
          priority: "Urgent", assignedToType: "person", assignedTo: "HR Officer",
          assignedBy: "Administrator", timeAllocation: "1w", status: "Open",
        },
      ],
    });
  }

  // Standard chart of accounts per company
  const COA = [
    ["1000", "Cash at Bank", "Asset"],
    ["1100", "Accounts Receivable", "Asset"],
    ["1200", "Inventory", "Asset"],
    ["1500", "Plant & Equipment", "Asset"],
    ["2000", "Accounts Payable", "Liability"],
    ["2100", "Accruals & Provisions", "Liability"],
    ["2200", "Retention Payable", "Liability"],
    ["3000", "Share Capital", "Equity"],
    ["3100", "Retained Earnings", "Equity"],
    ["4000", "Contract Revenue", "Income"],
    ["4100", "Other Income", "Income"],
    ["5000", "Cost of Sales", "Expense"],
    ["6000", "Salaries & Wages", "Expense"],
    ["6100", "Rent", "Expense"],
    ["6200", "Utilities", "Expense"],
  ];
  for (const company of companies) {
    for (const [code, name, type] of COA) {
      await db.chartOfAccount.upsert({
        where: { companyId_code: { companyId: company.id, code } },
        update: { name, type },
        create: { companyId: company.id, code, name, type },
      });
    }
  }

  // Default approval routes (admin-configurable afterwards via the UI)
  const ROUTES = {
    "Purchase Order": [
      { role: "Project Manager", level: 50, minAmount: null },
      { role: "Operations Manager", level: 70, minAmount: null },
      { role: "Director", level: 80, minAmount: null },
      { role: "Managing Director", level: 90, minAmount: 50000 },
    ],
    Expense: [
      { role: "Operations Manager", level: 70, minAmount: null },
      { role: "Director", level: 80, minAmount: null },
    ],
    "Company Onboarding": [
      { role: "Director", level: 80, minAmount: null },
      { role: "Managing Director", level: 90, minAmount: null },
    ],
    "Leave Request": [{ role: "Operations Manager", level: 70, minAmount: null }],
  };
  for (const [docType, steps] of Object.entries(ROUTES)) {
    const existing = await db.approvalRoute.findUnique({
      where: { tenantId_docType: { tenantId: tenant.id, docType } },
    });
    if (existing) continue; // don't overwrite admin edits
    await db.approvalRoute.create({
      data: {
        tenantId: tenant.id,
        docType,
        steps: {
          create: steps.map((s, i) => ({
            order: i + 1,
            roleName: s.role,
            requiredLevel: s.level,
            minAmount: s.minAmount,
          })),
        },
      },
    });
  }

  // Sample employees (master data) for the first company.
  // UAE document expiries use a spread of statuses (expired / expiring ≤60d / valid) for the compliance report.
  const d = (days) => new Date(Date.now() + days * 86400000);
  const EMPLOYEES = [
    { empNo: "EMP-0001", name: "Rajesh Kumar", department: "Projects", designation: "Project Manager", grade: "M2", basicSalary: 18000, allowances: 6000,
      biometricId: "101", nationality: "Indian",
      emiratesIdNo: "784-1988-1234567-1", emiratesIdExpiry: d(45),   // amber
      visaNo: "VIS-2024-0091", visaType: "Employment", visaExpiry: d(500),
      labourCardNo: "LC-77120", labourCardExpiry: d(500),
      passportNo: "Z1234567", passportExpiry: d(900) },
    { empNo: "EMP-0002", name: "Ahmed Al Balushi", department: "Operations", designation: "Operations Manager", grade: "M3", basicSalary: 22000, allowances: 8000,
      biometricId: "102", nationality: "Omani",
      emiratesIdNo: "784-1985-7654321-2", emiratesIdExpiry: d(700),
      visaNo: "VIS-2023-0042", visaType: "Employment", visaExpiry: d(650),
      labourCardNo: "LC-55201", labourCardExpiry: d(650),
      passportNo: "OM998877", passportExpiry: d(1200) },
    { empNo: "EMP-0003", name: "Maria Santos", department: "Finance", designation: "Accountant", grade: "S2", basicSalary: 9000, allowances: 3000,
      biometricId: "103", nationality: "Filipino",
      emiratesIdNo: "784-1990-2223334-3", emiratesIdExpiry: d(-8),    // expired
      visaNo: "VIS-2022-0310", visaType: "Employment", visaExpiry: d(-5),   // expired
      labourCardNo: "LC-33940", labourCardExpiry: d(20),   // amber
      passportNo: "P7788990", passportExpiry: d(55) },       // amber
    { empNo: "EMP-0004", name: "John Mathew", department: "Fabrication", designation: "6G Welder", grade: "W1", employmentType: "Contract", basicSalary: 4500, allowances: 1500,
      biometricId: "104", nationality: "Indian",
      emiratesIdNo: "784-1992-4445556-4", emiratesIdExpiry: d(320),
      visaNo: "VIS-2024-0155", visaType: "Employment", visaExpiry: d(300),
      labourCardNo: "LC-88410", labourCardExpiry: d(18),   // amber
      passportNo: "N5566778", passportExpiry: d(400) },
  ];
  const wbeCo = companies[0];
  for (const e of EMPLOYEES) {
    await db.employee.upsert({
      where: { companyId_empNo: { companyId: wbeCo.id, empNo: e.empNo } },
      update: { ...e },
      create: { companyId: wbeCo.id, joinDate: new Date("2024-01-15"), ...e },
    });
  }

  // Sample certifications (incl. expiring) + a supplied worker — for demo
  const wbeEmps = await db.employee.findMany({ where: { companyId: wbeCo.id }, orderBy: { empNo: "asc" } });
  const certCount = await db.certification.count({ where: { companyId: wbeCo.id } });
  if (certCount === 0 && wbeEmps.length >= 2) {
    const soon = new Date(Date.now() + 15 * 86400000);
    const past = new Date(Date.now() - 10 * 86400000);
    const far = new Date(Date.now() + 400 * 86400000);
    await db.certification.createMany({
      data: [
        { companyId: wbeCo.id, employeeId: wbeEmps[3].id, name: "6G Welder Certificate", category: "Competency", expiryDate: soon },
        { companyId: wbeCo.id, employeeId: wbeEmps[3].id, name: "Fitness-to-Work Medical", category: "Medical", expiryDate: past },
        { companyId: wbeCo.id, employeeId: wbeEmps[1].id, name: "Rigger Level 1", category: "Safety", expiryDate: far },
      ],
    });
  }
  const supDocs = {
    biometricId: "201", nationality: "Indian",
    emiratesIdNo: "784-1995-9990001-5", emiratesIdExpiry: d(120),
    visaNo: "VIS-2024-0400", visaType: "Employment", visaExpiry: d(30),   // amber
    labourCardNo: "LC-91002", labourCardExpiry: d(30),
    passportNo: "S1122334", passportExpiry: d(600),
  };
  await db.employee.upsert({
    where: { companyId_empNo: { companyId: wbeCo.id, empNo: "SUP-0001" } },
    update: { ...supDocs },
    create: { companyId: wbeCo.id, empNo: "SUP-0001", name: "Salim Ansari", department: "Fabrication", designation: "Helper",
      employmentType: "Supplied", supplier: "Gulf Manpower Supply LLC", basicSalary: 2500, allowances: 500, ...supDocs },
  });

  // Sample finance vouchers for WBE (Tally-style, with UAE VAT) — powers Day Book, P&L, VAT report & dashboard KPIs
  const seededVouchers = await db.journalEntry.count({ where: { companyId: wbeCo.id, source: "seed" } });
  if (seededVouchers === 0) {
    const wbeAccts = await db.chartOfAccount.findMany({ where: { companyId: wbeCo.id } });
    const acct = (code) => wbeAccts.find((a) => a.code === code)?.id;
    const postVoucher = async ({ reference, voucherType, partyName, vatAmount, memo, date, lines }) => {
      await db.journalEntry.create({
        data: {
          companyId: wbeCo.id, reference, voucherType, partyName, vatAmount: vatAmount ?? 0,
          memo, date, source: "seed", postedBy: admin.id,
          lines: { create: lines.map(([code, debit, credit]) => ({ accountId: acct(code), debit, credit })) },
        },
      });
    };
    // Sales invoice: revenue 200,000 + 5% output VAT 10,000 → receivable 210,000
    await postVoucher({
      reference: "SAL/WBE/0001", voucherType: "Sales", partyName: "Al Habtoor Construction LLC", vatAmount: 10000,
      memo: "Fabrication & erection — progress invoice #1", date: d(-25),
      lines: [["1100", 210000, 0], ["4000", 0, 200000], ["2100", 0, 10000]],
    });
    // Purchase: cost of sales 80,000 + 5% input VAT 4,000 → payable 84,000
    await postVoucher({
      reference: "PUR/WBE/0001", voucherType: "Purchase", partyName: "Emirates Steel Industries", vatAmount: 4000,
      memo: "Structural steel supply", date: d(-20),
      lines: [["5000", 80000, 0], ["2100", 4000, 0], ["2000", 0, 84000]],
    });
    // Salary payment (no VAT)
    await postVoucher({
      reference: "PAY/WBE/0001", voucherType: "Payment", partyName: "Payroll — Aug 2026", vatAmount: 0,
      memo: "Monthly salaries", date: d(-3),
      lines: [["6000", 50000, 0], ["1000", 0, 50000]],
    });
  }

  console.log("Seeded tenant, companies, roles, admin, tasks, chart of accounts, approval routes, employees, certs, supplied worker, sample vouchers.");
  console.log("Login:  admin@wandb.ae  /  " + ADMIN_PASSWORD);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
