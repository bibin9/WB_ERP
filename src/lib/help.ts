/**
 * In-app help content. Plain-English guides so a user with zero finance/HR-systems
 * background can self-serve any doubt. Data-driven so it's easy to extend and white-label.
 * Not server-only — imported by client help components.
 */

export type HelpArticle = {
  id: string;
  category: string;
  title: string;
  summary: string;
  /** Route prefixes this article relates to (for context-aware help). [] = general. */
  screens: string[];
  steps?: string[];
  tip?: string;
  body?: string;
};

export const HELP_CATEGORIES = [
  "Getting Started",
  "Finance & Accounting",
  "Human Resources",
  "Approvals",
  "Administration & Security",
  "Notifications",
] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  // ===== GETTING STARTED =====
  {
    id: "welcome", category: "Getting Started", screens: ["/dashboard"],
    title: "Finding your way around",
    summary: "The sidebar, top bar, company switcher and your account menu.",
    body: "The left sidebar lists everything you can open, grouped by area (Finance, Human Resources, and so on). The top bar has the company switcher (left), search, the notifications bell, and your account menu (right).",
    steps: [
      "Use the left sidebar to move between modules. Click a group heading to collapse or expand it.",
      "You only see the screens your role is allowed to open — if a menu item is missing, you don't have access to it.",
      "Click the arrow icon at the top of the sidebar to shrink it to icons and get more space.",
    ],
    tip: "Lost? Click the '?' in the top bar on any screen — it shows help for exactly the page you're looking at.",
  },
  {
    id: "companies-switch", category: "Getting Started", screens: ["/dashboard", "/finance", "/hr", "/companies"],
    title: "Switching between group companies",
    summary: "Each company keeps its own books; the switcher changes which one you're viewing.",
    body: "The dropdown at the top-left (e.g. 'WB Engineering') controls which company's records you see. Each company has separate accounts, employees and documents. Group-level reports combine them.",
    tip: "If a screen looks empty, check the company switcher — you may be looking at a company that has no data yet.",
  },
  {
    id: "roles-access", category: "Getting Started", screens: [],
    title: "Why some screens are hidden",
    summary: "Your role decides what you can see and do.",
    body: "Access is granted per screen. A site storekeeper might see only Inventory; an accountant sees Finance. If you need a screen you can't see, ask an administrator to grant your role access to it (Administration → Access Control).",
  },

  // ===== FINANCE =====
  {
    id: "finance-basics", category: "Finance & Accounting", screens: ["/finance"],
    title: "Accounting terms in plain English",
    summary: "Debit, credit, ledger, voucher — what they actually mean.",
    body: "A ledger (or 'account') is a bucket for one kind of money — e.g. 'Cash at Bank' or 'Salaries'. A voucher (or journal entry) records one transaction. Every transaction has two sides: a Debit and a Credit, and they must be equal — that's what keeps the books balanced. Roughly: money coming into an asset is a debit; money going out is a credit.",
    tip: "You don't need to be an accountant — pick the right voucher type (below) and the system handles the debits and credits for you.",
  },
  {
    id: "finance-journal", category: "Finance & Accounting", screens: ["/finance"],
    title: "Recording a transaction",
    summary: "How to add a voucher (journal entry).",
    steps: [
      "On Finance → Overview, click 'New journal entry'.",
      "Choose the voucher type (Payment, Receipt, Sales, Purchase, Contra or Journal).",
      "Pick the accounts and enter the amounts — the debit and credit totals must match.",
      "Add the party (customer/supplier) and VAT amount if relevant, then save.",
    ],
    tip: "The reference number is created for you with a prefix that matches the type (PAY, RCP, SAL, PUR…).",
  },
  {
    id: "voucher-types", category: "Finance & Accounting", screens: ["/finance"],
    title: "Which voucher type should I use?",
    summary: "A quick guide to the six types.",
    body: "Payment = money going out (you paid someone). Receipt = money coming in (someone paid you). Sales = an invoice raised to a customer. Purchase = a bill received from a supplier. Contra = moving money between your own cash and bank. Journal = adjustments and anything that doesn't fit the others.",
  },
  {
    id: "daybook", category: "Finance & Accounting", screens: ["/finance/daybook"],
    title: "The Day Book",
    summary: "Every voucher in date order.",
    body: "The Day Book is a running list of all transactions for the selected company, newest activity grouped by date — the same idea as Tally's Day Book. Use it to see everything that was posted on a given day.",
  },
  {
    id: "ledgers", category: "Finance & Accounting", screens: ["/finance/ledgers"],
    title: "Ledgers and account statements",
    summary: "See every entry for one account, with a running balance.",
    steps: [
      "Open Finance → Ledgers.",
      "Pick an account from the list (e.g. 'Cash at Bank').",
      "You'll see every entry that touched it, with the balance after each — Dr means it's a debit balance, Cr a credit balance.",
    ],
  },
  {
    id: "reports-pl-bs", category: "Finance & Accounting", screens: ["/finance/reports"],
    title: "Profit & Loss and Balance Sheet",
    summary: "The two headline financial reports, explained simply.",
    body: "Profit & Loss answers 'did we make money?' — income minus expenses over a period. The Balance Sheet answers 'what do we own and owe right now?' — assets on one side, liabilities plus equity on the other. The Balance Sheet always balances; a '✓ Balanced' tick confirms the books are consistent.",
  },
  {
    id: "vat", category: "Finance & Accounting", screens: ["/finance/vat"],
    title: "VAT report (UAE 5%)",
    summary: "Output vs input VAT and what you owe the FTA.",
    body: "Output VAT is the 5% you charge customers on sales. Input VAT is the 5% you pay suppliers on purchases (which you can reclaim). Net VAT payable = output minus input. The figures come from the VAT amount you enter on each Sales or Purchase voucher.",
    tip: "To make the VAT report accurate, always fill the VAT amount when posting a Sales or Purchase voucher.",
  },
  {
    id: "tally", category: "Finance & Accounting", screens: ["/finance/tally"],
    title: "Connecting your existing Tally",
    summary: "Import ledgers from Tally over its built-in gateway.",
    steps: [
      "In Tally, enable the HTTP gateway: Gateway of Tally → F1 → Connectivity → set 'Act as: Both/Server', port 9000.",
      "In the ERP, open Finance → Tally Sync and enter the Tally computer's host/IP, port and the exact company name.",
      "Click 'Test connection' to confirm the ERP can reach Tally.",
      "Click 'Import ledgers from Tally' to pull your accounts in.",
    ],
    tip: "The ERP and Tally must be on the same network. If 'Test connection' fails, it tells you exactly what's wrong (usually Tally isn't running or the gateway is off).",
  },

  // ===== HR =====
  {
    id: "hr-employees", category: "Human Resources", screens: ["/hr"],
    title: "Employee records",
    summary: "Add staff and open a full profile.",
    steps: [
      "On HR → Employees, click 'Add employee' and fill the basics (name, department, designation, salary).",
      "Click any employee's name to open their full profile.",
    ],
    tip: "Departments, designations and grades come from Master Data — set those up first so the dropdowns are ready.",
  },
  {
    id: "hr-profile-docs", category: "Human Resources", screens: ["/hr/employees", "/hr"],
    title: "UAE documents & custom fields",
    summary: "Store Emirates ID, visa, labour card and upload files.",
    body: "An employee profile holds their personal details, UAE documents (Emirates ID, passport, visa, labour card) with expiry dates, banking/WPS details, uploaded files, and any custom fields your admin has added. Filling the expiry dates is what powers the compliance and expiry alerts.",
  },
  {
    id: "onboarding", category: "Human Resources", screens: ["/hr/onboarding"],
    title: "Hiring & onboarding",
    summary: "From job requisition to a hired employee.",
    steps: [
      "Raise a requisition for the role you need to fill.",
      "Add candidates and move them through the stages.",
      "When you hire a candidate, an employee record and a joining checklist are created automatically.",
    ],
  },
  {
    id: "payroll", category: "Human Resources", screens: ["/hr/payroll"],
    title: "Running payroll",
    summary: "Create a run, generate payslips, approve and mark paid.",
    steps: [
      "Create a payroll run for the period.",
      "Payslips are generated from each employee's salary structure (basic + allowances).",
      "Review, then move the run from Draft → Approved → Paid.",
    ],
  },
  {
    id: "leave", category: "Human Resources", screens: ["/hr/leave"],
    title: "Leave requests",
    summary: "Request and approve leave; balances update automatically.",
    body: "An employee (or HR on their behalf) submits a leave request. When it's approved, the days are deducted from that employee's annual leave balance.",
  },
  {
    id: "attendance-muster", category: "Human Resources", screens: ["/hr/attendance"],
    title: "Daily attendance (the Muster)",
    summary: "Mark a whole site in a few taps.",
    body: "The Daily Muster assumes everyone is Present. You only tap the exceptions — who is Absent, on Leave, Half-day or Off — then click Save. This matches how a paper attendance sheet works, so marking a large crew takes a few taps instead of a row each.",
    steps: [
      "Open HR → Attendance and check the date at the top.",
      "Use the department chips to filter to your crew if needed.",
      "Tap A / L / ½ / Off only for people who aren't fully present.",
      "Click 'Save muster'.",
    ],
  },
  {
    id: "punch-import", category: "Human Resources", screens: ["/hr/attendance"],
    title: "Importing from a punch machine",
    summary: "Upload the biometric device log and fill attendance automatically.",
    steps: [
      "Give each employee their device enrolment number in the 'Biometric ID' field on their profile.",
      "Export the day's punch log from your device (CSV or text).",
      "On HR → Attendance, use 'Import from punch machine' to upload it.",
      "The system matches each punch to an employee, takes first-in/last-out, and fills their hours and status.",
    ],
    tip: "Works with most devices (ZKTeco, eSSL, Matrix, Suprema). Any device IDs it can't match are listed so you can fix the biometric ID.",
  },
  {
    id: "certifications", category: "Human Resources", screens: ["/hr/certifications"],
    title: "Certificates & medicals",
    summary: "Track competency, safety and medical certificates with expiry.",
    body: "Record each certificate with its expiry date. Anything within 60 days shows amber, expired shows red, and it appears in the notifications and the compliance report so nothing lapses unnoticed.",
  },
  {
    id: "compliance", category: "Human Resources", screens: ["/hr/reports"],
    title: "Compliance & expiry report",
    summary: "All expiring visas, IDs and cards in one place.",
    body: "This report lists every employee's Emirates ID, visa, labour card and passport expiry, sorted soonest-first and colour-coded: red = expired, amber = due within 60 days, green = valid. It also shows headcount (own vs supplied manpower).",
    tip: "In the UAE, working on an expired visa or labour card carries fines — renew items before they turn red and update the expiry on the profile to clear the alert.",
  },

  // ===== APPROVALS =====
  {
    id: "approvals-raise", category: "Approvals", screens: ["/approvals"],
    title: "Sending something for approval",
    summary: "Raise a request that routes to the right people.",
    body: "When you raise a request (for example a purchase or an expense), it's sent to the approvers defined for that document type. You can track its progress on the Approvals screen.",
  },
  {
    id: "approvals-act", category: "Approvals", screens: ["/approvals"],
    title: "Approving or rejecting",
    summary: "Act on requests waiting for you.",
    steps: [
      "Open Approvals — requests waiting for your sign-off are listed.",
      "Review the details and choose Approve or Reject.",
      "On approval it moves to the next approver; when the last one approves, it's fully approved.",
    ],
    tip: "You'll get a notification when something needs your sign-off — click it to jump straight here.",
  },
  {
    id: "approvals-routes", category: "Approvals", screens: ["/settings/approvals"],
    title: "Setting up approval levels",
    summary: "Define who signs off, and above what amount.",
    body: "Administrators define the approval chain per document type — for example Project Manager → Operations Manager → Director → Managing Director. You can make a step apply only above a value (e.g. the Managing Director only needs to approve amounts over AED 50,000).",
  },

  // ===== ADMINISTRATION & SECURITY =====
  {
    id: "access-control", category: "Administration & Security", screens: ["/settings/roles"],
    title: "Access Control: granting rights per screen",
    summary: "Choose exactly which screens each role can use.",
    steps: [
      "Open Administration → Access Control and find the role.",
      "Click a module to expand it into its individual screens.",
      "Tick View / Create / Edit / Delete / Approve per screen, or use the module header to grant a whole module at once.",
    ],
    tip: "The badge next to each module shows the state at a glance: 'No access', 'N/N screens', or 'Full module'.",
  },
  {
    id: "users-security", category: "Administration & Security", screens: ["/users"],
    title: "Managing users: reset, lock, unlock",
    summary: "Add users and handle password/lock issues.",
    body: "On the Users screen, admins can add users, reset a password (a temporary one is shown to hand over — the user must set their own on next sign-in), and lock or unlock an account. Accounts also auto-lock for 15 minutes after 3 wrong passwords.",
    steps: [
      "Reset password: click the key icon — copy the temporary password and give it to the user.",
      "Lock/unlock: click the lock icon. A red 'Locked' badge shows blocked accounts.",
    ],
  },
  {
    id: "change-password", category: "Administration & Security", screens: ["/account"],
    title: "Changing your own password",
    summary: "Update your password from My Account.",
    steps: [
      "Open the account menu (top-right) → 'My Account & Password'.",
      "Enter your current password, then your new one twice, and save.",
    ],
    tip: "If an admin reset your password, you'll be asked to set a new one the moment you sign in.",
  },
  {
    id: "master-data", category: "Administration & Security", screens: ["/settings/master-data"],
    title: "Master data (the dropdown lists)",
    summary: "Departments, designations, grades and more.",
    body: "Master Data holds the standard lists used across the app — departments, designations, grades, leave types, nationalities. Keeping these tidy means clean, consistent dropdowns everywhere (for example when adding an employee).",
  },
  {
    id: "custom-fields", category: "Administration & Security", screens: ["/settings/custom-fields"],
    title: "Custom fields",
    summary: "Add your own fields to employee profiles.",
    body: "If you need to capture something the standard profile doesn't have, add a custom field here. It then appears on every employee profile for you to fill in.",
  },
  {
    id: "audit", category: "Administration & Security", screens: ["/audit"],
    title: "Audit log",
    summary: "Who did what, and when.",
    body: "The audit log is a permanent record of key actions — created, updated, approved, deleted — with the user and time. Use it to answer 'who changed this?'.",
  },

  // ===== NOTIFICATIONS =====
  {
    id: "notifications", category: "Notifications", screens: ["/notifications"],
    title: "Notifications & alerts",
    summary: "The bell, and the live alerts.",
    body: "The bell in the top bar shows how many unread notifications you have. The Notifications screen also computes live alerts — expiring documents and certificates, overdue and urgent tasks, and approvals waiting on you. Every alert is clickable and jumps to the right screen.",
  },
];

/** Articles most relevant to a given route, best match first. */
export function articlesForPath(pathname: string): HelpArticle[] {
  const scored = HELP_ARTICLES.map((a) => {
    const best = a.screens.reduce((m, s) => (pathname === s || pathname.startsWith(s + "/") || pathname.startsWith(s) ? Math.max(m, s.length) : m), 0);
    return { a, score: best };
  }).filter((x) => x.score > 0);
  scored.sort((x, y) => y.score - x.score);
  return scored.map((x) => x.a);
}

/** Simple full-text search across articles. */
export function searchArticles(q: string): HelpArticle[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return HELP_ARTICLES.filter((a) =>
    [a.title, a.summary, a.body ?? "", (a.steps ?? []).join(" "), a.tip ?? "", a.category].join(" ").toLowerCase().includes(t)
  );
}
