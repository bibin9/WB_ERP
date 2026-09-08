import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const db = new PrismaClient();
// First-run admin password. Set ADMIN_PASSWORD in the host env for the pilot/production;
// falls back to a demo value for local dev. Only applied when the admin is first created.
/**
 * The first administrator's password.
 *
 * "admin123" is fine for a laptop and indefensible on a public URL, so in
 * production it is only used when somebody has deliberately set it. Otherwise a
 * random one is generated, printed once into the deploy log, and the account is
 * marked as needing a reset — an install nobody configured ends up with a
 * password nobody can guess rather than one everybody knows.
 *
 * An administrator that already exists is never touched either way.
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const GENERATED_PASSWORD = !process.env.ADMIN_PASSWORD && IS_PRODUCTION
  ? randomBytes(12).toString("base64url")
  : null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || GENERATED_PASSWORD || "admin123";

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
  // Every finance screen, so a new one is granted to the finance roles rather
  // than silently reaching only the admin roles that bypass this list.
  finance: [
    "finance.overview", "finance.daybook", "finance.ledgers", "finance.reports",
    "finance.parties", "finance.outstanding", "finance.cheques", "finance.retention", "finance.bankrec", "finance.jobs", "finance.costcentres",
    "finance.vat", "finance.corptax", "finance.tally", "finance.settings",
  ],
  hr: ["hr.employees", "hr.onboarding", "hr.payroll", "hr.leave", "hr.attendance", "hr.certifications", "hr.separation", "hr.reports", "hr.policy", "hr.tasks"],
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
      // Books opened on 1 January of the current year, so the demo opening
      // balances sit in the right financial year.
      create: {
        tenantId: tenant.id, code: c.code, name: c.name, baseCurrency: "AED",
        fyStartMonth: 1,
        openingAsOf: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
      },
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
    create: {
      tenantId: tenant.id,
      email: "admin@wandb.ae",
      name: "Administrator",
      passwordHash,
      // A generated password is a first-login credential, not a permanent one.
      mustReset: !!GENERATED_PASSWORD,
    },
  });
  if (GENERATED_PASSWORD && admin.mustReset) {
    console.log("\n" + "=".repeat(64));
    console.log("  ADMIN_PASSWORD was not set, so one was generated for this install.");
    console.log("  Sign in once with it, then change it — you will be asked to.");
    console.log(`  admin@wandb.ae  /  ${GENERATED_PASSWORD}`);
    console.log("  This is the only time it is printed.");
    console.log("=".repeat(64) + "\n");
  }
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
  // Opening balances demonstrate migrating onto the system mid-life: debit
  // positive, credit negative, and the set balances to zero.
  const COA = [
    ["1000", "Cash at Bank", "Asset", 150000],
    ["1100", "Accounts Receivable", "Asset", 0, "Receivable"],
    ["1200", "Inventory", "Asset"],
    // VAT is held on its own two accounts, not netted into one. A VAT 201 is
    // filed as output tax due less input tax recoverable, and the only way to
    // prove the return before sending it to the FTA is to agree box 12 and
    // box 13 back to these balances. Without them the accountant has nowhere
    // correct to post the tax on an invoice.
    ["1150", "VAT Input (Recoverable)", "Asset"],
    ["1500", "Plant & Equipment", "Asset"],
    ["2000", "Accounts Payable", "Liability", -50000, "Payable"],
    ["2100", "Accruals & Provisions", "Liability"],
    ["2150", "VAT Output (Payable)", "Liability"],
    // Retention runs both ways on a contract at the same time: the client
    // holds it from us, and we hold it from our subcontractors.
    ["1160", "Retention Receivable", "Asset"],
    ["2200", "Retention Payable", "Liability"],
    ["3000", "Share Capital", "Equity", -100000],
    ["3100", "Retained Earnings", "Equity"],
    ["4000", "Contract Revenue", "Income"],
    ["4100", "Other Income", "Income"],
    ["5000", "Cost of Sales", "Expense"],
    // The absorption pair. Timesheet hours are debited to 5100 against the job
    // they were worked on and credited to 6900, so the P&L is unchanged while
    // job costing finally sees the labour. The gap between 6000 and 6900 is
    // wage cost that was never charged to any job.
    ["5100", "Site Labour", "Expense"],
    // Salary advances are a debt the employee owes back, so they sit as an
    // asset until payroll recovers them — not as a cost the month they are paid.
    ["1170", "Employee Advances", "Asset"],
    ["6000", "Salaries & Wages", "Expense"],
    ["6900", "Labour Recovered", "Expense"],
    ["6100", "Rent", "Expense"],
    ["6200", "Utilities", "Expense"],
  ];
  for (const company of companies) {
    for (const [code, name, type, opening, controlType] of COA) {
      const openingBalance = opening ?? 0;
      await db.chartOfAccount.upsert({
        where: { companyId_code: { companyId: company.id, code } },
        update: { name, type, controlType: controlType ?? null },
        create: { companyId: company.id, code, name, type, openingBalance, controlType: controlType ?? null },
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
    { empNo: "EMP-0001", name: "Rajesh Kumar", phone: "0504128837", department: "Projects", designation: "Project Manager", grade: "M2", basicSalary: 18000, allowances: 6000,
      biometricId: "101", nationality: "Indian",
      emiratesIdNo: "784-1988-1234567-1", emiratesIdExpiry: d(45),   // amber
      visaNo: "VIS-2024-0091", visaType: "Employment", visaExpiry: d(500),
      labourCardNo: "78412345601234", labourCardExpiry: d(500),
      passportNo: "Z1234567", passportExpiry: d(900) },
    { empNo: "EMP-0002", name: "Ahmed Al Balushi", phone: "0526631140", department: "Operations", designation: "Operations Manager", grade: "M3", basicSalary: 22000, allowances: 8000,
      biometricId: "102", nationality: "Omani",
      emiratesIdNo: "784-1985-7654321-2", emiratesIdExpiry: d(700),
      visaNo: "VIS-2023-0042", visaType: "Employment", visaExpiry: d(650),
      labourCardNo: "78412345602345", labourCardExpiry: d(650),
      passportNo: "OM998877", passportExpiry: d(1200) },
    { empNo: "EMP-0003", name: "Maria Santos", phone: "0552087742", department: "Finance", designation: "Accountant", grade: "S2", basicSalary: 9000, allowances: 3000,
      biometricId: "103", nationality: "Filipino",
      emiratesIdNo: "784-1990-2223334-3", emiratesIdExpiry: d(-8),    // expired
      visaNo: "VIS-2022-0310", visaType: "Employment", visaExpiry: d(-5),   // expired
      labourCardNo: "78412345603456", labourCardExpiry: d(20),   // amber
      passportNo: "P7788990", passportExpiry: d(55) },       // amber
    { empNo: "EMP-0004", name: "John Mathew", phone: "0567713908", department: "Fabrication", designation: "6G Welder", grade: "W1", employmentType: "Contract", basicSalary: 4500, allowances: 1500,
      biometricId: "104", nationality: "Indian",
      emiratesIdNo: "784-1992-4445556-4", emiratesIdExpiry: d(320),
      visaNo: "VIS-2024-0155", visaType: "Employment", visaExpiry: d(300),
      labourCardNo: "78412345604567", labourCardExpiry: d(18),   // amber
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
    labourCardNo: "78412345605678", labourCardExpiry: d(30),
    passportNo: "S1122334", passportExpiry: d(600),
  };
  await db.employee.upsert({
    where: { companyId_empNo: { companyId: wbeCo.id, empNo: "SUP-0001" } },
    update: { ...supDocs },
    create: { companyId: wbeCo.id, empNo: "SUP-0001", name: "Salim Ansari", phone: "0583309165", department: "Fabrication", designation: "Helper",
      employmentType: "Supplied", supplier: "Gulf Manpower Supply LLC", basicSalary: 2500, allowances: 500, ...supDocs },
  });

  // WPS demo data: employer config, employee bank details, a sample advance
  const WPS_IBANS = [
    "AE060331234567890100000",
    "AE760331234567890100001",
    "AE490331234567890100002",
    "AE220331234567890100003",
    "AE920331234567890100004",
    "AE650331234567890100005",
  ];
  await db.company.update({ where: { id: wbeCo.id }, data: { wpsEmployerId: "1234567890123", wpsBankRouting: "302460010" } });
  const wbeAll = await db.employee.findMany({ where: { companyId: wbeCo.id }, orderBy: { empNo: "asc" } });
  for (const [i, e] of wbeAll.entries()) {
    await db.employee.update({ where: { id: e.id }, data: {
      bankName: e.bankName ?? "Emirates NBD",
      // Real UAE IBANs: AE, ISO 7064 check digits, 3-digit bank, 16-digit
      // account. Arbitrary digits would fail the checksum the moment anyone
      // tried the WPS export, so the demo would never produce a usable file.
      iban: e.iban ?? WPS_IBANS[i % WPS_IBANS.length],
      bankRoutingCode: e.bankRoutingCode ?? "302460010",
    } });
  }

  // Repair identifiers left by an earlier seed. These placeholders passed the
  // old presence-only check but are not valid: the IBANs carry wrong ISO 7064
  // check digits and the labour cards are not numeric, so every employee would
  // now be held back from the WPS file. Matched exactly, so anything a user
  // typed is left alone.
  for (const [i, e] of wbeAll.entries()) {
    const patch = {};
    if (e.iban && /^AE070331234567890\d{6}$/.test(e.iban)) patch.iban = WPS_IBANS[i % WPS_IBANS.length];
    if (e.labourCardNo && /^LC-\d+$/.test(e.labourCardNo)) {
      patch.labourCardNo = `7841234560${String(1234 + i).slice(-4)}`;
    }
    if (Object.keys(patch).length) await db.employee.update({ where: { id: e.id }, data: patch });
  }
  if ((await db.advance.count({ where: { companyId: wbeCo.id } })) === 0) {
    const rajesh = wbeAll.find((e) => e.empNo === "EMP-0001");
    if (rajesh) await db.advance.create({ data: { companyId: wbeCo.id, employeeId: rajesh.id, employeeName: rajesh.name, amount: 6000, monthlyRecovery: 2000, balance: 6000, reason: "Ramadan advance" } });
  }

  // The sample vouchers, declared once so the same description both creates
  // them and repairs them.
  //
  // They used to sit behind `if (nothing has been seeded yet)`, which asks the
  // wrong question: an install made by an older version is never revisited, so
  // a voucher added to this list later never appears there and a field added
  // later is never filled in. That one line caused four separate defects, the
  // worst of them a live VAT return reading nil while the ledger held tax.
  const SAMPLE_VOUCHERS = [
    // Sales invoice: revenue 200,000 + 5% output VAT 10,000 -> receivable 210,000
    {
      reference: "SAL/WBE/0001", voucherType: "Sales", partyName: "Al Habtoor Construction LLC",
      vatAmount: 10000, memo: "Fabrication & erection \u2014 progress invoice #1", days: -25,
      lines: [["1100", 210000, 0], ["4000", 0, 200000, "Standard"], ["2150", 0, 10000]],
    },
    // Purchase: cost of sales 80,000 + 5% input VAT 4,000 -> payable 84,000
    {
      reference: "PUR/WBE/0001", voucherType: "Purchase", partyName: "Emirates Steel Industries",
      vatAmount: 4000, memo: "Structural steel supply", days: -20,
      lines: [["5000", 80000, 0, "Standard"], ["1150", 4000, 0], ["2000", 0, 84000]],
    },
    // Zero-rated export: work billed outside the GCC. A taxable supply,
    // declared in box 4, but no tax charged.
    {
      reference: "SAL/WBE/0002", voucherType: "Sales", partyName: "Emaar Properties PJSC",
      vatAmount: 0, memo: "Offshore fabrication \u2014 export, zero-rated", days: -18,
      lines: [["1100", 60000, 0], ["4000", 0, 60000, "Zero-rated"]],
    },
    // Reverse charge: design services bought from abroad. The company accounts
    // for the tax itself, in box 3 and box 10, netting to nil.
    {
      reference: "PUR/WBE/0002", voucherType: "Purchase", partyName: "Overseas Design Consultants",
      vatAmount: 0, memo: "Imported design services \u2014 reverse charge", days: -12,
      lines: [["5000", 40000, 0, "Reverse charge"], ["2000", 0, 40000]],
    },
    // Credit note: a rate variation agreed after invoicing. Reduces the supply
    // already declared rather than adding to it.
    {
      reference: "CN/WBE/0001", voucherType: "Credit Note", partyName: "Al Habtoor Construction LLC",
      vatAmount: 500, memo: "Rate variation on progress invoice #1", days: -8,
      lines: [["4000", 10000, 0, "Standard"], ["2150", 500, 0], ["1100", 0, 10500]],
    },
    // Retention withheld to date, moved out of the ordinary receivable and
    // payable into the retention accounts. A reclassification, so it changes no
    // revenue and no tax — it just puts the money where the retention register
    // says it is, which is what lets that screen reconcile.
    {
      reference: "JV/WBE/RET1", voucherType: "Journal", partyName: null,
      vatAmount: 0, memo: "Retention withheld on certificates to date", days: -6,
      lines: [["1160", 55000, 0], ["2000", 6300, 0], ["1100", 0, 55000], ["2200", 0, 6300]],
    },
    // Salary payment: a settlement, so no VAT treatment on any line.
    {
      reference: "PAY/WBE/0001", voucherType: "Payment", partyName: "Payroll \u2014 Aug 2026",
      vatAmount: 0, memo: "Monthly salaries", days: -3,
      lines: [["6000", 50000, 0], ["1000", 0, 50000]],
    },
  ];

  {
    const wbeAccts = await db.chartOfAccount.findMany({ where: { companyId: wbeCo.id } });
    const acct = (code) => wbeAccts.find((a) => a.code === code)?.id;

    for (const v of SAMPLE_VOUCHERS) {
      const existing = await db.journalEntry.findFirst({
        where: { companyId: wbeCo.id, reference: v.reference, source: "seed" },
        include: { lines: true },
      });

      if (!existing) {
        await db.journalEntry.create({
          data: {
            companyId: wbeCo.id, reference: v.reference, voucherType: v.voucherType,
            partyName: v.partyName, vatAmount: v.vatAmount ?? 0, memo: v.memo, date: d(v.days),
            source: "seed", postedBy: admin.id,
            lines: {
              create: v.lines.map(([code, debit, credit, vatTreatment]) => ({
                accountId: acct(code), debit, credit, vatTreatment: vatTreatment ?? null,
              })),
            },
          },
        });
        continue;
      }

      // Already present: fill in what an older version of this seed could not
      // know about. Lines are matched on their amounts, which are distinct
      // within each of these vouchers. Only a blank treatment is filled and
      // only a line on the wrong account is moved, so anything already correct
      // is left alone. Only vouchers marked source "seed" are candidates, and
      // a voucher cannot be edited from the interface at all, so this can never
      // touch something a user entered.
      for (const [code, debit, credit, vatTreatment] of v.lines) {
        const want = acct(code);
        const line = existing.lines.find((l) => l.debit === debit && l.credit === credit);
        if (!line) continue;
        const patch = {};
        if (want && line.accountId !== want) patch.accountId = want;
        if (vatTreatment && line.vatTreatment === null) patch.vatTreatment = vatTreatment;
        if (Object.keys(patch).length) await db.journalLine.update({ where: { id: line.id }, data: patch });
      }
    }
  }

  // Customers and suppliers, so the outstanding report has real parties behind it.
  const PARTIES = [
    ["C0001", "Al Habtoor Construction LLC", "Customer", "100123456700003", 30],
    ["C0002", "Emaar Properties PJSC", "Customer", "100987654300003", 60],
    ["S0001", "Emirates Steel Industries", "Supplier", "100555666700003", 45],
    ["S0002", "Gulf Manpower Supply LLC", "Supplier", null, 30],
  ];
  for (const company of companies) {
    for (const [code, name, type, trn, creditDays] of PARTIES) {
      await db.party.upsert({
        where: { companyId_code: { companyId: company.id, code } },
        update: { name, type, trn, creditDays },
        create: { companyId: company.id, code, name, type, trn, creditDays },
      });
    }
  }
  // Jobs, so job costing has something to cost. Two open contracts, with the
  // sample vouchers tagged to the first one.
  //
  // A job and a project are the same record; `type` is only the word for it.
  // J-0003 sits under J-0001 as a package, so the roll-up on the job screen has
  // something to demonstrate on a fresh install.
  const JOBS = [
    ["J-0001", "ADNOC pipeline fabrication", "C0001", 450000, 300000, "Contract", null],
    ["J-0002", "Emaar tower MEP fit-out", "C0002", 280000, 210000, "Project", null],
    ["J-0003", "ADNOC — variation 1: extra spools", "C0001", 60000, 42000, "Contract", "J-0001"],
  ];
  for (const company of companies) {
    for (const [code, name, partyCode, contractValue, budgetCost, type, parentCode] of JOBS) {
      const party = await db.party.findFirst({ where: { companyId: company.id, code: partyCode } });
      // The parent is seeded before its child, so this always resolves.
      const parent = parentCode
        ? await db.job.findFirst({ where: { companyId: company.id, code: parentCode } })
        : null;
      await db.job.upsert({
        where: { companyId_code: { companyId: company.id, code } },
        update: { name, contractValue, budgetCost, type, parentId: parent?.id ?? null },
        create: {
          companyId: company.id, code, name, contractValue, budgetCost, type,
          parentId: parent?.id ?? null,
          partyId: party?.id ?? null, status: "Open",
          startDate: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 15)),
        },
      });
    }
  }

  // Cost centres — the other dimension, for what the business carries itself.
  const CENTRES = [
    ["CC-01", "Head office", null],
    ["CC-02", "Workshop — Al Quoz", null],
    ["CC-03", "Vehicles", null],
    ["CC-04", "Cranes & lifting", "CC-03"],
  ];
  for (const company of companies) {
    for (const [code, name, parentCode] of CENTRES) {
      const parent = parentCode
        ? await db.costCentre.findFirst({ where: { companyId: company.id, code: parentCode } })
        : null;
      await db.costCentre.upsert({
        where: { companyId_code: { companyId: company.id, code } },
        update: { name, parentId: parent?.id ?? null },
        create: { companyId: company.id, code, name, parentId: parent?.id ?? null },
      });
    }
  }
  // Tag the seeded revenue and cost lines to the first job, so the report opens
  // with real figures rather than zeroes.
  for (const company of companies) {
    const job = await db.job.findFirst({ where: { companyId: company.id, code: "J-0001" } });
    if (!job) continue;
    const lines = await db.journalLine.findMany({
      where: { entry: { companyId: company.id, source: "seed" }, jobId: null },
      include: { account: { select: { type: true } } },
    });
    for (const l of lines) {
      if (l.account.type === "Income" || l.account.type === "Expense") {
        await db.journalLine.update({ where: { id: l.id }, data: { jobId: job.id } });
      }
    }
  }

  // Point the sample vouchers at those parties, so ageing has something to age.
  for (const company of companies) {
    const ps = await db.party.findMany({ where: { companyId: company.id } });
    for (const p of ps) {
      await db.journalEntry.updateMany({
        where: { companyId: company.id, partyName: p.name, partyId: null },
        data: { partyId: p.id },
      });
    }
  }

  // Demo time against the first job, left uncharged on purpose so the warning
  // on the Job Costing screen and the "Post labour" step are both visible on a
  // fresh install.
  if ((await db.timesheet.count({ where: { companyId: wbeCo.id, jobId: { not: null } } })) === 0) {
    const job = await db.job.findFirst({ where: { companyId: wbeCo.id, code: "J-0001" } });
    const crew = await db.employee.findMany({ where: { companyId: wbeCo.id }, orderBy: { empNo: "asc" }, take: 3 });
    if (job && crew.length) {
      const day = (back) => new Date(Date.now() - back * 86400000);
      for (const [i, e] of crew.entries()) {
        // The same derivation the app uses: whole package over 208 standard hours.
        const rate = Math.round((((e.basicSalary || 0) + (e.allowances || 0)) / 208) * 100) / 100;
        for (const back of [3, 2, 1]) {
          await db.timesheet.create({
            data: {
              companyId: wbeCo.id, employeeId: e.id, jobId: job.id,
              date: day(back), hours: 8, costRate: rate,
              notes: i === 0 && back === 3 ? "Spool fabrication" : null,
            },
          });
        }
      }
    }
  }

  // A handful of post-dated cheques, the way a UAE client actually settles: one
  // already past its date and still in the drawer, so the register opens with
  // the warning it exists to give. Declared per cheque, so an install made by an
  // older version picks up any added later.
  {
    const customer = await db.party.findFirst({ where: { companyId: wbeCo.id, code: "C0001" } });
    const supplier = await db.party.findFirst({ where: { companyId: wbeCo.id, code: "S0001" } });
    const day = (n) => new Date(Date.now() + n * 86400000);
    const CHEQUES = [
      ["Received", "000451", "Emirates NBD", -4, 60000, customer, "Accounts safe"],
      ["Received", "000452", "Emirates NBD", 9, 60000, customer, "Accounts safe"],
      ["Received", "000453", "Emirates NBD", 40, 60000, customer, "Accounts safe"],
      ["Issued", "778001", "Mashreq Bank", 12, 42000, supplier, "Sent to supplier"],
    ];
    for (const [direction, chequeNo, bankName, days, amount, party, heldBy] of CHEQUES) {
      const exists = await db.cheque.findFirst({
        where: { companyId: wbeCo.id, direction, bankName, chequeNo },
      });
      if (exists) continue;
      await db.cheque.create({
        data: {
          companyId: wbeCo.id, direction, chequeNo, bankName, chequeDate: day(days), amount,
          partyId: party?.id ?? null, partyName: party?.name ?? null, status: "In hand", heldBy,
        },
      });
    }
  }

  // Retention on the ADNOC job, the way a real contract runs it: ten per cent
  // withheld on each certificate, half releasable at handover and half a year
  // after. One tranche is deliberately past its date, so the register opens
  // showing the thing it exists to catch.
  {
    const job = await db.job.findFirst({ where: { companyId: wbeCo.id, code: "J-0001" } });
    const client = await db.party.findFirst({ where: { companyId: wbeCo.id, code: "C0001" } });
    const sub = await db.party.findFirst({ where: { companyId: wbeCo.id, code: "S0001" } });
    const day = (n) => new Date(Date.now() + n * 86400000);
    const HELD = [
      ["Receivable", "IPC-03", -20, 20000, 10, "Practical completion", client],
      ["Receivable", "IPC-03", 330, 20000, 10, "Defects liability", client],
      ["Receivable", "IPC-04", 400, 15000, 10, "Defects liability", client],
      ["Payable", "SUB-INV-011", 120, 6300, 5, "Defects liability", sub],
    ];
    for (const [direction, reference, days, amount, percent, stage, party] of HELD) {
      const exists = await db.retention.findFirst({
        where: { companyId: wbeCo.id, direction, reference, stage },
      });
      if (exists) continue;
      await db.retention.create({
        data: {
          companyId: wbeCo.id, direction, reference, amount, percent, stage,
          dueDate: day(days), jobId: job?.id ?? null,
          partyId: party?.id ?? null, partyName: party?.name ?? null, status: "Held",
        },
      });
    }
  }

  // A corporate tax period for the year just gone, so the screen opens showing
  // the shape of the thing rather than an empty page. Two adjustments, because
  // fines and entertainment are the two every UAE company meets and nobody
  // expects until somebody explains them.
  //
  // Reconciled rather than created blindly: an established database gets the
  // period added if it is missing, and each adjustment added if it is missing,
  // without ever duplicating one that is already there.
  {
    // The year now running, rather than the one just gone: the sample vouchers
    // are dated relative to today, so a finished year would compute a nil
    // profit and show nothing. An accountant building the computation as the
    // year goes along is the ordinary case anyway.
    const taxYear = new Date().getUTCFullYear();
    // The financial year, worked out here rather than imported: this file runs
    // under plain node on the host, which cannot load a TypeScript module.
    const m = Math.min(12, Math.max(1, wbeCo.fyStartMonth || 1));
    const startYear = m === 1 ? taxYear : taxYear - 1;
    const period = {
      from: new Date(Date.UTC(startYear, m - 1, 1)),
      to: new Date(Date.UTC(startYear + 1, m - 1, 0)),
    };
    let ret = await db.corporateTaxReturn.findFirst({
      where: { companyId: wbeCo.id, periodFrom: period.from, periodTo: period.to },
    });
    if (!ret) {
      ret = await db.corporateTaxReturn.create({
        data: {
          companyId: wbeCo.id,
          periodFrom: period.from,
          periodTo: period.to,
          status: "Draft",
          notes: "Sample working paper. Check every figure before anything is filed.",
        },
      });
    }
    const ADJUSTMENTS = [
      ["Add back", "Fines and penalties", "Municipality and traffic fines", 3000,
        "Never deductible, so the whole amount is added back."],
      ["Add back", "Entertainment (50%)", "Half of client entertainment", 10000,
        "AED 20,000 spent; only half is deductible."],
    ];
    for (const [kind, category, label, amount, notes] of ADJUSTMENTS) {
      const exists = await db.corporateTaxAdjustment.findFirst({
        where: { returnId: ret.id, category, label },
      });
      if (exists) continue;
      await db.corporateTaxAdjustment.create({
        data: { returnId: ret.id, kind, category, label, amount, notes },
      });
    }
  }

  // A fortnight of site attendance with real overtime on it, so a payroll run
  // on the demo data shows the thing the screen is for rather than a flat
  // salary. The welder works a shutdown; the helper does two night shifts.
  {
    const crew = await db.employee.findMany({
      where: { companyId: wbeCo.id, empNo: { in: ["EMP-0004", "SUP-0001", "EMP-0003"] } },
    });
    const byNo = Object.fromEntries(crew.map((e) => [e.empNo, e]));
    const now = new Date();
    const dayOf = (n) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), n));

    // [employee, day of month, status, hours, ordinary OT, OT at 150%]
    const MUSTER = [
      ["EMP-0004", 1, "Present", 8, 0, 0],
      ["EMP-0004", 2, "Present", 12, 4, 0],
      ["EMP-0004", 3, "Present", 12, 4, 0],
      ["EMP-0004", 4, "Present", 12, 0, 4],
      ["EMP-0004", 5, "Present", 8, 0, 0],
      ["SUP-0001", 1, "Present", 8, 0, 0],
      ["SUP-0001", 2, "Present", 10, 0, 2],
      ["SUP-0001", 3, "Present", 10, 0, 2],
      ["EMP-0003", 1, "Present", 8, 0, 0],
      ["EMP-0003", 2, "Absent", 0, 0, 0],
    ];
    for (const [empNo, dom, status, hours, otHours, otPremiumHours] of MUSTER) {
      const e = byNo[empNo];
      if (!e) continue;
      const date = dayOf(dom);
      const exists = await db.attendance.findFirst({ where: { employeeId: e.id, date } });
      if (exists) continue;
      await db.attendance.create({
        data: { companyId: wbeCo.id, employeeId: e.id, date, status, hours, otHours, otPremiumHours },
      });
    }

    // Two days of approved unpaid leave, so the deduction has something to bite
    // on and the payslip shows how it reads.
    const maria = byNo["EMP-0003"];
    if (maria) {
      const from = dayOf(10);
      const exists = await db.leaveRequest.findFirst({
        where: { employeeId: maria.id, type: "Unpaid", fromDate: from },
      });
      if (!exists) {
        await db.leaveRequest.create({
          data: {
            companyId: wbeCo.id, employeeId: maria.id, type: "Unpaid",
            fromDate: from, toDate: dayOf(11), days: 2,
            reason: "Personal, agreed with the department", status: "Approved",
            decidedBy: "Administrator",
          },
        });
      }
    }
  }

  // Payslips written before payroll knew about part months and overtime carry
  // nil in the new columns, which would read on screen as "0/30 days" — as
  // though nobody had been paid for anything. They were full months, so they
  // are restated as full months.
  //
  // This is the fourth time a column added after a database was seeded has
  // needed exactly this, so it is done unconditionally rather than behind a
  // "only on a fresh install" guard: the guard is what caused the other three.
  {
    const stale = await db.payslip.findMany({ where: { daysPaid: 0 } });
    for (const s of stale) {
      await db.payslip.update({
        where: { id: s.id },
        data: {
          daysPaid: s.daysInPeriod || 30,
          contractBasic: s.contractBasic || s.basic,
          contractAllowances: s.contractAllowances || s.allowances,
        },
      });
    }
    if (stale.length) console.log(`Restated ${stale.length} payslip(s) written before part months were tracked.`);
  }

  // The annual leave balance used to be a stored number, set to 30 when a
  // record was created and decremented on approval. It is now an opening
  // adjustment — a figure a company carries across from whatever it used
  // before — and the real balance is worked out from the join date and the
  // leave actually approved.
  //
  // So a row still holding exactly 30 with no approved leave behind it is the
  // old default, not a migrated balance, and leaving it there would hand
  // everybody thirty free days on top of what they have earned. Anything else
  // is left alone: it might be a real figure somebody typed.
  {
    const suspects = await db.employee.findMany({ where: { annualLeaveBalance: 30 } });
    let cleared = 0;
    for (const e of suspects) {
      const taken = await db.leaveRequest.count({
        where: { employeeId: e.id, type: "Annual", status: "Approved" },
      });
      if (taken > 0) continue; // the number has been used; it may be deliberate
      await db.employee.update({ where: { id: e.id }, data: { annualLeaveBalance: 0 } });
      cleared++;
    }
    if (cleared) console.log(`Cleared the old default leave balance on ${cleared} employee(s); balances now accrue from the join date.`);
  }

  // A probation date on the newest joiner, so the watchlist has something to
  // show and the six-month rule is visible rather than theoretical.
  {
    const e = await db.employee.findFirst({ where: { companyId: wbeCo.id, empNo: "EMP-0004" } });
    if (e && e.joinDate && !e.probationEndDate) {
      const j = e.joinDate;
      await db.employee.update({
        where: { id: e.id },
        data: {
          probationEndDate: new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + 6, j.getUTCDate())),
          probationCleared: true,
          noticePeriodDays: 30,
          airTicketAllowance: 1800,
        },
      });
    }
  }

  // Compliance demo data. An engineering contractor is in one of the fourteen
  // Emiratisation sectors, so the panel shows the rule that will apply as the
  // company grows rather than an empty box. ILOE is set on most of the sample
  // staff and left off one, so the chase list has something in it.
  {
    for (const co of companies) {
      if (!co.emiratisationSector) {
        await db.company.update({ where: { id: co.id }, data: { emiratisationSector: true } });
      }
    }

    const SKILLED = ["EMP-0001", "EMP-0002", "EMP-0003", "EMP-0004"];
    const NO_ILOE = ["EMP-0004"]; // one left unsubscribed, so the list is not empty
    for (const e of await db.employee.findMany({ where: { companyId: wbeCo.id } })) {
      const supplied = e.employmentType === "Supplied";
      await db.employee.update({
        where: { id: e.id },
        data: {
          skilledRole: SKILLED.includes(e.empNo),
          // Supplied labour sits outside the scheme; it is the agency's to hold.
          iloeExempt: supplied,
          iloeSubscribed: !supplied && !NO_ILOE.includes(e.empNo),
          iloeExpiry:
            !supplied && !NO_ILOE.includes(e.empNo) && !e.iloeExpiry
              ? new Date(Date.now() + 200 * 86400000)
              : e.iloeExpiry,
        },
      });
    }
  }

  console.log("Seeded tenant, companies, roles, admin, tasks, chart of accounts, approval routes, employees, certs, supplied worker, sample vouchers, jobs, cost centres, timesheets, cheques, retention, corporate tax, site attendance, compliance.");
  console.log("Login:  admin@wandb.ae  /  " + ADMIN_PASSWORD);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
