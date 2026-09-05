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
    tip: "If you type or bookmark the address of a screen you are not allowed to open, you are simply sent back to your dashboard. Nothing is broken — it just isn't yours to see.",
  },
  {
    id: "why-no-button", category: "Getting Started", screens: [],
    title: "Why a button is missing",
    summary: "Being allowed to see a screen and being allowed to change it are two different things.",
    body: "Every screen is granted separately for View, Create, Edit, Delete and Approve. So a project manager may be allowed to look at the employee list but not to change it — for them the delete and edit buttons are simply not shown, rather than appearing and then refusing.",
    steps: [
      "If you can see a record but cannot change it, you have View only on that screen.",
      "If a button you expected is missing, ask an administrator to check your role in Administration → Access Control.",
      "The tick boxes there are per screen: View, Create, Edit, Delete, Approve.",
    ],
    tip: "This is deliberate, and it is what keeps payroll, settlements and journals trustworthy — the people allowed to look at a figure are not automatically the people allowed to change it.",
  },
  {
    id: "export-data", category: "Getting Started", screens: [],
    title: "Getting your data out",
    summary: "Download any list as a spreadsheet, or the whole company's records as one file.",
    body: "Most list screens have an Export button that downloads what you are looking at as a spreadsheet you can open in Excel. It is the quickest way to send figures to an auditor, work on them offline, or keep your own copy.",
    steps: [
      "Open the screen you want — Employees, Payroll, Leave, Attendance, Certifications, Settlements or Finance.",
      "Click Export. The file downloads to your computer and opens in Excel.",
      "You only ever export what you are allowed to see: your own companies, and only the screens your role can open.",
      "Administrators can also go to Companies & Group and click Export for a company, which downloads every record as one ZIP file of spreadsheets.",
    ],
    tip: "This is not the system backup. It is a copy of your records for your own use — it cannot be loaded back in to restore the system. Ask your administrator about the backup schedule. Exported files contain salaries, passport numbers and bank details, so store them somewhere safe and delete copies you no longer need.",
  },
  {
    id: "day-night", category: "Getting Started", screens: [],
    title: "Day mode and night mode",
    summary: "Switch the whole app to a dark colour scheme, easier on the eyes in low light.",
    body: "The sun/moon button in the top bar switches between the normal light appearance (day) and a dark one (night). Night mode is easier to look at in a dim office or late in the evening, and on a phone it uses less battery.",
    steps: [
      "Click the moon icon in the top bar to switch to night mode.",
      "Click the sun icon to go back to day mode.",
      "Your choice is remembered on that device and applies to every screen.",
    ],
    tip: "If you have never chosen, the app follows your computer or phone's own setting — so if your device switches to dark in the evening, the ERP follows. Printed documents, such as the settlement statement, always print on white paper whichever mode you are in.",
  },
  {
    id: "dashboard-adapts", category: "Getting Started", screens: ["/dashboard"],
    title: "Your dashboard fits your job",
    summary: "The dashboard shows only the areas you actually work in.",
    body: "There is one dashboard and it arranges itself around your access. An HR officer sees headcount, leave and expiring documents. An accountant sees cash, VAT and pending journals. A group administrator sees all of it, titled 'Group Dashboard'.",
    steps: [
      "Each panel appears only if you have access to the screen behind it.",
      "Every figure is clickable and takes you straight to the records behind it.",
      "If your role covers a single screen you get a short focused dashboard instead of empty boxes.",
    ],
    tip: "There is nothing to set up here — grant or remove a screen in Access Control and the dashboard follows automatically.",
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
    summary: "How to add a voucher — the date, the accounts, the amounts and the VAT.",
    steps: [
      "On Finance → Overview, click 'New journal entry'.",
      "Choose the voucher type — there are eight, listed in the next article.",
      "Set the date. It starts on today, but you can change it: an invoice dated last month will land in last month on every report.",
      "Choose the customer or supplier if there is one, and write a narration saying what the transaction was.",
      "On each line, start typing an account name or code and pick it from the list that appears.",
      "Set the VAT treatment on lines that are a supply or an expense; leave it blank on the others.",
      "Enter the debits and credits. The totals must match — the Post button stays disabled until they do.",
    ],
    tip: "You do not need the mouse. Type a few letters of an account name, use the arrow keys, press Enter, then Tab to the amount. The reference number is created for you and restarts each financial year — WBE/SI/26-27/0001 is company, type, year, sequence.",
  },
  {
    id: "voucher-types", category: "Finance & Accounting", screens: ["/finance"],
    title: "Which voucher type should I use?",
    summary: "A quick guide to the eight types.",
    body: "Payment = money going out, you paid someone. Receipt = money coming in, someone paid you. Sales = an invoice raised to a customer. Purchase = a bill received from a supplier. Credit Note = reduces an invoice you raised. Debit Note = reduces a bill from a supplier. Contra = moving money between your own cash and bank. Journal = adjustments and anything that doesn't fit the others.",
    tip: "Credit notes come up constantly on a contract — an agreed rate variation, work returned, a retention release. Raise one rather than editing the original invoice: the invoice has already been sent and already counted towards your VAT return.",
  },
  {
    id: "opening-balances", category: "Finance & Accounting", screens: ["/finance"],
    title: "Opening balances — moving from your old system",
    summary: "Carry your existing balances in, so the books start from where you really are.",
    body: "When you move onto this system your accounts already have balances — money in the bank, money customers owe you, money you owe suppliers. An opening balance is that starting figure. Enter it once per account and every report picks it up from then on.",
    steps: [
      "First set the date: Companies & Group → edit the company → 'Opening balances as at'. This is normally the first day of your financial year, and it is the date you moved onto the system.",
      "Then, on Finance → Overview, click the pencil on an account (or add a new one).",
      "Type the amount and choose Dr or Cr.",
      "Repeat for every account that had a balance. Your opening figures should total zero — the debits equal the credits, exactly as in your old system's trial balance.",
    ],
    tip: "Which side? Things you have or are owed are Dr — cash, bank, stock, customers who owe you, equipment. Things you owe are Cr — suppliers, loans, and the owners' capital. If you have a trial balance from your old system or your accountant, copy it straight across; the totals should match.",
  },
  {
    id: "periods", category: "Finance & Accounting", screens: ["/finance", "/finance/daybook", "/finance/ledgers", "/finance/reports", "/finance/vat"],
    title: "Choosing the dates a report covers",
    summary: "Every finance screen has a From and To. It opens on the current financial year.",
    body: "The Period bar at the top of each finance screen decides what you are looking at. It opens showing the current financial year, so most of the time you can ignore it.",
    steps: [
      "Change From and To to look at any stretch of time — a month, a quarter, last year.",
      "On the VAT report there are quarter buttons that match the FTA return periods.",
      "The dates are in the web address, so you can bookmark a period or send someone the exact view you are looking at.",
    ],
    tip: "The two headline reports answer different questions, and the dates mean different things in each. Profit & Loss covers what happened between the two dates. The Balance Sheet is a snapshot on the To date — what the company owns and owes at that moment — so changing From does not affect it.",
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
    title: "The VAT return (VAT 201)",
    summary: "The figures for your FTA return, box by box, for whichever period you choose.",
    body: "This screen is the return itself. Each box is numbered the way the FTA numbers it, so you can read the figures straight onto form VAT 201 instead of working them out.",
    steps: [
      "Pick the period — the quarter buttons match the FTA return periods.",
      "Box 1 is your standard-rated sales, with the 5% on them. Box 4 is zero-rated, box 5 exempt.",
      "Box 9 is standard-rated purchases, and the tax there is what you can reclaim.",
      "Box 14 is the answer: what you pay the FTA, or what they owe you.",
    ],
    tip: "If the screen says an amount is not on the return, some voucher lines have no VAT treatment set. Fix those before you file — a supply missing from a filed return is a much bigger problem than a warning on screen.",
  },
  {
    id: "vat-treatment", category: "Finance & Accounting", screens: ["/finance", "/finance/vat"],
    title: "Choosing the VAT treatment on a line",
    summary: "Why VAT sits on each line of a voucher rather than on the voucher as a whole.",
    body: "One invoice often mixes them. You might bill 200,000 of work in Dubai at the standard 5%, and 60,000 exported outside the GCC at 0%, on the same invoice. A single VAT box on the voucher could not describe that, so the treatment goes on each line.",
    steps: [
      "Standard — the normal 5%. Most work billed inside the UAE.",
      "Zero-rated — 0%, but still a taxable supply you must declare: exports outside the GCC, international transport.",
      "Exempt — no VAT and none to reclaim: some financial services, bare land, local passenger transport.",
      "Out of scope — nothing to do with UAE VAT at all.",
      "Reverse charge — you account for the tax yourself on something bought from abroad.",
    ],
    tip: "Only tag the lines that are a sale or a cost. Leave it blank on the bank line, the customer line and the VAT account itself — those are not supplies, they are just the other side of the entry.",
  },
  {
    id: "reverse-charge", category: "Finance & Accounting", screens: ["/finance", "/finance/vat"],
    title: "Reverse charge — buying services from abroad",
    summary: "When you import a service, you account for the UAE VAT yourself.",
    body: "If you buy design or engineering services from a company outside the UAE, they do not charge you UAE VAT — so the FTA asks you to charge it to yourself and reclaim it in the same breath. It costs you nothing, but it must be declared.",
    steps: [
      "Post the purchase as normal and set the cost line's VAT treatment to 'Reverse charge'.",
      "On the return it appears twice: in box 3 as a supply, and in box 10 as an expense.",
      "The two cancel out, so your net payable does not change.",
    ],
    tip: "Worked example: 40,000 of imported design work. Box 3 shows 40,000 with 2,000 of tax, box 10 shows the same, and box 14 is exactly what it would have been without the import. That is correct — the point is that it is declared, not that you pay more.",
  },
  {
    id: "parties", category: "Finance & Accounting", screens: ["/finance/parties", "/finance"],
    title: "Customers and suppliers",
    summary: "Record each one once, then pick them from a list when you post.",
    body: "Every customer and supplier is set up once on Finance → Parties. If people type the name freehand on each invoice you end up with 'Al Habtoor Construction LLC' and 'Al Habtoor Const. LLC' as two different customers, and then nobody can tell you what they actually owe.",
    steps: [
      "Finance → Parties → Add party.",
      "Give it a code — C0001 for a customer, S0001 for a supplier — and the name.",
      "Say whether it is a customer, a supplier, or both.",
      "Enter the TRN, their Tax Registration Number. A UAE tax invoice has to show it, and it appears on your VAT return.",
      "Set the credit days you agreed, so the system knows when an invoice becomes overdue.",
    ],
    tip: "Credit days are what turns 'unpaid' into 'overdue'. With 30 days agreed, an invoice from 45 days ago is chased; one from last week is not.",
  },
  {
    id: "outstanding", category: "Finance & Accounting", screens: ["/finance/outstanding"],
    title: "Who owes us, and what we owe",
    summary: "Every customer and supplier balance, sorted by how old it is.",
    body: "Finance → Outstanding answers the two questions you are asked most: how much is owed to us, and how much do we owe. Each balance is split by age — not yet due, 1–30 days, 31–60, 61–90, and over 90 — so you can see at a glance which debts are going stale.",
    steps: [
      "Open Finance → Outstanding.",
      "Customers are listed first, then suppliers. They are kept apart and never netted off against each other.",
      "The ageing comes from each invoice's date and the credit days on that party.",
    ],
    tip: "This is the report to run before a payment run or before you start chasing money. It is built from the ledgers, so it always agrees with the accounts — if it did not, one of them would be wrong.",
  },
  {
    id: "reversal", category: "Finance & Accounting", screens: ["/finance/daybook", "/finance"],
    title: "Correcting a mistake",
    summary: "Posted vouchers are never edited or deleted — you post the opposite entry instead.",
    body: "Once a voucher is posted it stays exactly as it is. That is deliberate: a record anyone can quietly rewrite is not worth having, and an auditor will ask. A mistake is corrected the way an accountant corrects one — by posting the reverse.",
    steps: [
      "Find the voucher in the Day Book.",
      "Click the reverse icon at the end of its row.",
      "Choose the date for the correction — usually today, or the month you are putting right.",
      "Post it. Every debit becomes a credit and every credit a debit, so the two cancel out.",
      "Then post the correct voucher.",
    ],
    tip: "The original and the reversal are linked, and the original row then reads 'Reversed' so nobody does it twice. Both stay visible, which is exactly what you want when someone asks what happened.",
  },
  {
    id: "period-lock", category: "Finance & Accounting", screens: ["/finance", "/companies"],
    title: "Closing a period",
    summary: "Stop anyone posting into a month you have already filed.",
    body: "Once you have filed a VAT return or closed a month, the figures behind it must not move — otherwise the return you filed no longer matches your books. An administrator sets a date, and nothing can be posted on or before it.",
    steps: [
      "Companies & Group → click the pencil on the company.",
      "Set 'Books closed up to' — usually the last day of the month you have finished with.",
      "Save. Anyone who tries to post into that period is told why, and which date to use instead.",
    ],
    tip: "Leave it blank while a month is still open. Set it as soon as you have filed, and move it forward each month.",
  },
  {
    id: "drill-down", category: "Finance & Accounting", screens: ["/finance/reports", "/finance", "/finance/ledgers"],
    title: "Following a figure back to its source",
    summary: "Click any number on a report to see what it is made of.",
    body: "No figure on a report is a dead end. If the Profit & Loss shows 130,000 of expenses and you want to know why, you click it.",
    steps: [
      "On the Profit & Loss, Balance Sheet or trial balance, click any account line.",
      "Its ledger opens, showing the same dates as the report you came from.",
      "In the ledger, click a voucher reference to see that entry in the Day Book.",
    ],
    tip: "Totals are not clickable, because there is no single ledger behind them — click the lines that make up the total instead.",
  },
  {
    id: "printing", category: "Finance & Accounting", screens: ["/finance/reports", "/finance", "/finance/ledgers", "/finance/vat"],
    title: "Printing a report",
    summary: "The version that goes in the file, signed.",
    body: "Every finance report has a Print button. It produces a clean A4 page with the company name, the report and the period at the top, and without the menus and buttons.",
    steps: [
      "Open the report and set the period you want.",
      "Click Print.",
      "Choose your printer, or 'Save as PDF' if you want a file.",
    ],
    tip: "Print and Export do different jobs. Export gives you the figures as a spreadsheet to work on. Print gives you the document to sign and hand to the auditor. It prints on white paper even if you are using night mode.",
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
    summary: "Create a run, generate payslips, recover advances, approve and mark paid.",
    body: "A payroll run is one month of salaries for one company. The system reads each employee's salary structure and builds a payslip for every active employee, so you never type the figures in yourself.",
    steps: [
      "Click 'Run payroll' and pick the month — for example September 2026.",
      "Payslips are generated automatically: Basic + Allowances, minus any salary advance instalment due, gives Net Pay.",
      "Check the list. The Advance column shows what is being recovered this month.",
      "Move the run from Draft → Approved → Paid. Advance balances only reduce when you mark the run Paid.",
      "Once the run exists you can click 'Download WPS file' to produce the file your bank needs.",
    ],
    tip: "Only one payroll run is allowed per company per month. If you made a mistake, delete the Draft run and create it again — Approved and Paid runs cannot be deleted, on purpose, so the history stays trustworthy.",
  },
  {
    id: "advances", category: "Human Resources", screens: ["/hr/payroll"],
    title: "Salary advances and loans",
    summary: "Pay an employee money up front, then recover it automatically from later payslips.",
    body: "An advance is money given to an employee before payday — for a flight home, a deposit, an emergency. Instead of remembering to deduct it every month, you record it once and the system takes a fixed amount off each payslip until it is repaid.",
    steps: [
      "On the Payroll screen click 'New advance'.",
      "Pick the employee, enter the total amount given (say AED 6,000) and how much to recover each month (say AED 1,000).",
      "Add a reason if you want it on record — 'Air ticket', 'Medical', and so on.",
      "The advance appears under 'Active salary advances' with the outstanding balance.",
      "Every payroll run then deducts the monthly amount by itself. In this example the balance reaches zero after six runs and the advance is marked Cleared.",
    ],
    tip: "Worked example: an AED 6,000 advance recovered at AED 1,000 a month. An employee on AED 18,000 basic + AED 4,000 allowances takes home 18,000 + 4,000 − 1,000 = AED 21,000 that month, and the balance drops to AED 5,000 once the run is marked Paid.",
  },
  {
    id: "wps-sif", category: "Human Resources", screens: ["/hr/payroll"],
    title: "The WPS file for the bank",
    summary: "The UAE Wage Protection System file your bank needs in order to pay everyone.",
    body: "In the UAE salaries must be paid through the Wage Protection System (WPS). Your bank needs a file called a SIF — Salary Information File — listing who is paid, how much, and into which account. The system builds it from your payroll run, so nobody has to format it by hand.",
    steps: [
      "One-time setup: at the bottom of the Payroll screen fill in 'WPS employer ID' and 'Bank routing code'. Your bank gives you both — ask your relationship manager if you don't have them.",
      "Each employee also needs three details on their profile: labour card number, IBAN, and their own bank routing code (HR → Employees → open the employee → Banking).",
      "Open a payroll run and click 'Download WPS file'.",
      "Upload the downloaded .sif file to your bank's portal.",
    ],
    tip: "If someone is missing a labour card number, IBAN or routing code, the system names them for you — and still produces the file for everyone else, so one incomplete record never holds up the whole payroll.",
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
    id: "separation", category: "Human Resources", screens: ["/hr/separation"],
    title: "Separation & end-of-service settlement",
    summary: "Resignation/termination with an automatic UAE gratuity calculation.",
    body: "When an employee resigns or is terminated, record it here and the system calculates their final settlement per UAE Labour Law (Decree-Law 33/2021): end-of-service gratuity, unused-leave encashment, plus any pending salary, notice pay or air ticket, minus deductions. The figures update live as you type, and HR can adjust any of them.",
    steps: [
      "Pick the employee and their last working day, and choose Resignation or Termination.",
      "Review the live settlement: gratuity, leave encashment and the net amount.",
      "Add any pending salary, notice pay, air ticket, deductions or a manual adjustment.",
      "Save — the employee is marked inactive and the settlement statement is stored.",
    ],
    tip: "Gratuity = 21 days' basic pay per year for the first 5 years, 30 days per year after that, minimum 1 year of service, capped at 2 years' basic pay. Under the current law resignation and termination earn the same gratuity; gross-misconduct dismissal can forfeit it.",
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
    // An exact match beats a parent screen: on /finance/vat, an article about
    // the VAT return should come before one about Finance generally.
    const best = a.screens.reduce((m, s) => {
      if (pathname === s) return Math.max(m, 1000 + s.length);
      if (pathname.startsWith(s + "/") || pathname.startsWith(s)) return Math.max(m, s.length);
      return m;
    }, 0);
    return { a, score: best };
  }).filter((x) => x.score > 0);

  // Where two articles match equally well, the one written about fewer screens
  // is the more specific: "The Day Book" lists only the Day Book, while
  // "Choosing the dates" lists every report, so the first is what the reader
  // standing on the Day Book wants.
  scored.sort((x, y) => y.score - x.score || x.a.screens.length - y.a.screens.length);
  return scored.map((x) => x.a);
}

/**
 * Search across articles.
 *
 * Matches on each word rather than the whole phrase, and on word stems, so
 * someone typing "correct a mistake" finds "Correcting a mistake" and "closed
 * period" finds "Closing a period". People search for what they want to do, not
 * for the title someone chose.
 */
export function searchArticles(q: string): HelpArticle[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];

  /** "correcting" and "corrected" both reduce to "correct". */
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
  const stems = words.map(stem);

  const scored = HELP_ARTICLES.map((a) => {
    const title = a.title.toLowerCase();
    const haystack = [a.title, a.summary, a.body ?? "", (a.steps ?? []).join(" "), a.tip ?? "", a.category]
      .join(" ")
      .toLowerCase();
    // Compare word by word. Matching on the raw string would let a short stem
    // like "age" hit inside "manage" and "page", which is how a search for
    // "ageing" ended up offering an article about the sidebar.
    const bag = haystack.split(/[^a-z0-9]+/).filter(Boolean).map(stem);
    const titleBag = title.split(/[^a-z0-9]+/).filter(Boolean).map(stem);
    const hits = (w: string) => bag.some((t) => t === w || t.startsWith(w));

    let score = 0;
    for (const w of stems) {
      if (titleBag.some((t) => t === w || t.startsWith(w))) score += 10;
      else if (hits(w)) score += 3;
    }
    // Every word matching somewhere beats one strong hit on a single word.
    const allMatch = stems.every(hits);
    return { a, score: score + (allMatch ? 5 : 0) };
  }).filter((x) => x.score > 0);

  scored.sort((x, y) => y.score - x.score);
  return scored.map((x) => x.a);
}
