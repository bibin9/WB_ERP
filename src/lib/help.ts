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
    id: "reports-centre", category: "Getting Started", screens: ["/reports", "/finance", "/hr"],
    title: "Finding the right report",
    summary: "One place that lists every report, searchable by what you want to know.",
    body: "Open Finance or HR, and click 'All reports' at the right-hand end of the row of tabs across the top. Every report you are allowed to open is there — from both areas, not only the one you came from — grouped by what it is about, and each card says the question it answers rather than only its official name. Search by the plain word you would use out loud: type 'owes' for the outstanding customer balances, 'expire' for visa and Emirates ID renewals, 'bounced' for returned cheques.",
    steps: [
      "Open Finance or HR from the left menu.",
      "Click 'All reports' at the far right of the tabs across the top.",
      "Type in the search box. It looks at the question on each card, not just the title.",
      "Use the round buttons beside it to show only Finance or only People.",
      "Click any card to open the report itself.",
    ],
    tip: "You only see the reports your role can open, so the list is shorter for some people than others. If a colleague can see one you cannot, ask an administrator to grant you that screen in Access Control.",
  },
  {
    id: "module-tabs", category: "Getting Started", screens: ["/finance", "/hr"],
    title: "The tabs across the top of Finance and HR",
    summary: "A top row of areas, and a second row for the screens inside the one you are in.",
    body: "Finance and HR each hold a lot of screens, so the tabs come in two levels. The top row is the area — Entry, Registers, Job Costing, Reports, Tax, Setup. When the area you have opened contains more than one screen, a smaller second row appears underneath listing them. Areas with only one screen, such as Job Costing, show no second row.",
    steps: [
      "Click an area in the top row. It opens the first screen in that area.",
      "Use the small round buttons underneath to move between the screens in that area.",
      "'All reports' at the right-hand end opens the full list across every module — it is the only way in, so it is worth remembering.",
    ],
    tip: "The company you are looking at travels with you between tabs, so you will not find yourself reading the wrong company's figures after clicking around.",
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
      "Click 'New journal entry' — it is at the top of Finance → Overview, and also at the top of Finance → Entry → Day Book, which is usually where you notice one is missing.",
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

  {
    id: "job-costing", category: "Finance & Accounting", screens: ["/finance/jobs"],
    title: "Job costing — did we make money on that job?",
    summary: "What a job earned, what it cost, and whether it stayed inside its budget.",
    body: "A job is one piece of work you are doing for a customer. When you post a voucher, each line can be charged to a job — so the revenue you invoiced and the costs you paid out both land against the same job, and the margin is worked out for you. A job and a project are the same record here: 'kind of work' is just the word you use for it.",
    steps: [
      "Open Finance -> Job Costing and click 'New job'. Give it a name and, if you know them, the contract value (what you sold it for) and the budget cost (what you expect it to cost you).",
      "When you post a voucher, use the 'Charge to' box on each line and pick the job. Do this for the sales invoice and for every supplier bill and expense that belongs to it.",
      "Come back to this screen to see Revenue, Cost and Margin for each job, for whatever date range you choose at the top.",
      "For a big contract split into packages or variations, create each one as its own job and set 'Part of' to the main contract. The main contract row then shows the whole picture.",
    ],
    tip: "Margin only tells the truth if every cost was charged to the job. If some were missed, the job looks more profitable than it really is — the Cost Centres screen shows you how much cost has nothing on it at all.",
  },
  {
    id: "retention", category: "Finance & Accounting", screens: ["/finance/retention"],
    title: "Retention \u2014 the money held back on your contracts",
    summary: "What clients are holding from you, what you are holding from subcontractors, and when it can be asked for.",
    body: "Almost every certificate has five or ten per cent held back, and it comes back in two pieces: half when the work is handed over, half once the maintenance period ends \u2014 usually a year later. It runs both ways at the same time, because your client holds it from you while you hold it from your own subcontractors. The register keeps track of all of it. Recording an entry does not change your accounts: the certificate that withheld the money already did that. What changes your accounts is releasing it.",
    steps: [
      "Open Finance -> Retention and click Record retention each time a certificate holds money back.",
      "Say which way it goes, put in the certificate number, and either type the amount or give the certified value and the rate and let it work the amount out.",
      "Choose which half it is and the date it can be released. For the defects half that is usually a year after handover.",
      "When the date comes, click Release. That moves the money into the ordinary receivable or payable so it shows up in Outstanding and gets chased or paid.",
    ],
    tip: "Watch the amber message at the top. Retention sits for a year at a time, so nothing else will remind you that a tranche became askable-for three months ago \u2014 and on most contracts this is five to ten per cent of the whole job.",
  },
  {
    id: "audit-search", category: "Administration & Security", screens: ["/audit"],
    title: "Finding something in the audit trail",
    summary: "Search by what was done, who did it, what it was done to, and when.",
    body: "The trail holds a year of activity on the Recent tab and everything older on the Archive tab, so scrolling is not a way to find anything. The search box looks at what was done and who did it. More filters adds the rest: one person, one kind of action, one kind of record, and a date range. They combine, so you can ask for everything one person deleted in a single week.",
    steps: [
      "Type into the search box for a quick look. It matches the description of what happened and the person's name.",
      "Click More filters for the rest. Who, did what, to what, and between which dates.",
      "The sentence above the list always says what you are looking at, so a filtered list is never mistaken for the whole trail.",
      "The dates include the whole of the last day, so asking up to the 14th includes everything done on the 14th.",
      "Clear resets everything. Switching between Recent and Archive keeps your filters.",
    ],
    tip: "The address of a filtered view carries the filters with it, so you can copy the link out of the address bar and send somebody exactly what you are looking at.",
  },
  {
    id: "wip", category: "Finance & Accounting", screens: ["/finance/wip"],
    title: "Work in Progress — where each contract really stands",
    summary: "How far through each contract is, what it has earned, and how that compares with what you have invoiced.",
    body: "Job Costing tells you what a job earned and cost in a period. This tells you something different and cumulative: how far through the contract is, and whether your invoicing has kept pace with the work. How far through is measured by cost, which is what you have spent against what the job was priced to cost. It uses figures already in your ledger and does not depend on anybody's opinion of how far along site looks. Once you know a contract is sixty per cent complete, you know it has earned sixty per cent of its value, and you can compare that with what you have actually billed.",
    steps: [
      "Open Finance -> Contracts -> Work in Progress.",
      "Read the sentence at the top. It leads with anything expected to lose money, because that is the only thing here you can still act on.",
      "Look at the Difference and Position columns. They say whether each contract is billed ahead of the work or behind it.",
      "Set a budget cost on any job showing 'budget not set'. Without one, nothing about that contract can be measured.",
      "Switch to All to include contracts that are already completed or closed.",
    ],
    tip: "This report is deliberately not filtered by period. A contract question is cumulative from the day the job started, and filtering to a financial year would report a two-year job as barely begun every January.",
  },
  {
    id: "wip-overbilling", category: "Finance & Accounting", screens: ["/finance/wip"],
    title: "Billed ahead of the work is not profit",
    summary: "Money invoiced before the work is done is held against work you still owe.",
    body: "On a long contract what you have invoiced and what you have earned are two different numbers, and they are almost never equal. If you have billed more than the work done, the surplus is not yours yet: it is money held against work still to do, and the client has a claim on it. If you have billed less, you are carrying work you have done and never asked to be paid for. Both are invisible in a profit and loss that simply totals what was invoiced, and both are the first thing a year-end audit asks about.",
    steps: [
      "Billed ahead of the work shows in the amber card at the top. Treat it as a liability, not as income you have banked.",
      "Done, not yet billed is the opposite. It is earned money nobody has asked the client for, so raise the certificate.",
      "The two are shown separately and never netted off. One contract a million ahead and another a million behind is not the same business as two sitting on plan.",
      "Advances are tracked separately on the Advances register, because an advance posts no revenue and so is not part of this comparison.",
    ],
    tip: "Persistent over-billing across several contracts usually means cash looks healthier than the business is. It is worth checking before committing to anything on the strength of the bank balance.",
  },
  {
    id: "wip-losses", category: "Finance & Accounting", screens: ["/finance/wip"],
    title: "A contract heading for a loss",
    summary: "When the expected cost passes the contract value, the whole loss belongs in this period.",
    body: "If a job is now expected to cost more than it will ever be paid, the entire expected loss is recognised straight away rather than spread over the months remaining. That is the accounting rule, and it is also the only sensible way to run the business: a loss you see in month three is still a decision you can act on, while one that surfaces in month eleven is only an explanation. The screen highlights these contracts and totals what needs providing for.",
    steps: [
      "Read the amber banner. It names how many contracts are affected and the total to provide for.",
      "Those rows are listed first and tinted, with the expected loss shown under their position.",
      "A contract counts as loss-making either because its budget already exceeds its value, or because spending has passed the contract value even though the budget did not.",
      "Once spending passes the budget, the budget stops being treated as the estimate and what has actually been spent is used instead.",
    ],
    tip: "The forecast margin column shows the same thing as a figure and a percentage. A margin drifting down month by month is the early warning; the amber banner is the late one.",
  },
  {
    id: "customer-supplier-advances", category: "Finance & Accounting", screens: ["/finance/advances"],
    title: "Advances — money paid before any work is billed",
    summary: "What a customer has paid you up front, what you have paid a supplier up front, and how much is left to recover.",
    body: "A mobilisation advance is normal on a UAE contract: ten or fifteen per cent arrives before anybody is on site, and comes back off the invoices a slice at a time. The same happens the other way, because a supplier will not order switchgear against a promise. It is important to understand that an advance is not income and it is not a cost. Nothing has been supplied when the money moves. Money a customer paid you is owed back until the work is billed, and money you paid a supplier is owed to you until they bill for it. Recording it as income would make one month look wonderful and every month afterwards look poor.",
    steps: [
      "Open Finance -> Advances and click Record advance when the money moves.",
      "Say which way it goes, choose the customer or supplier, and pick the bank account it went through.",
      "Either type the amount, or give the contract value and the percentage and let the screen work it out.",
      "Each time an invoice comes round, click Recover and enter the slice that comes off. What is left updates on its own.",
      "When nothing is left the advance closes itself, so you never have to remember to tidy it up.",
    ],
    tip: "Unlike the retention register, this one posts. Saving an advance puts it straight into your accounts, because the money really has moved and nothing else is going to record it.",
  },
  {
    id: "customer-supplier-advances-vat", category: "Finance & Accounting", screens: ["/finance/advances"],
    title: "VAT on an advance",
    summary: "Taking money for taxable work creates a tax point, so a tax invoice is due — but not from this screen.",
    body: "Under UAE rules the day you receive a payment for a taxable supply is a date of supply, which means VAT is due on an advance even though no work has been done. This screen deliberately charges no VAT. If it did, the tax could be declared twice: once here and once on the invoice you eventually raise. Instead VAT lives in exactly one place, the invoice, which is also where the VAT return reads it from.",
    steps: [
      "Record the advance here, with no VAT.",
      "Raise a tax invoice for the advance on Finance -> Invoices, with the correct treatment, and issue it.",
      "Come back to Advances and recover the advance against that invoice.",
      "The invoice carries the VAT onto your return; the advance register tracks the money.",
    ],
    tip: "If the work is zero-rated or out of scope there is no tax point to worry about, but recording the advance still matters — otherwise the balance sheet shows money as yours when it is not.",
  },
  {
    id: "customer-supplier-advances-recovering", category: "Finance & Accounting", screens: ["/finance/advances"],
    title: "Recovering an advance does not move money",
    summary: "It reduces what the other party owes, because they have already handed the money over.",
    body: "This catches people out. When you recover an advance against an invoice, nothing happens to your bank. The customer's invoice is settled in part by money the customer already gave you, so what they owe goes down and the amount you are holding for them goes down with it. The bank is untouched because the cash arrived months ago, when you recorded the advance.",
    steps: [
      "Click Recover on the advance and enter the amount coming off this certificate.",
      "Name the invoice it is being set against, so the set-off can still be explained a year later.",
      "The screen refuses an amount larger than what is left, because recovering more than was advanced would turn what you owe into an apparent asset.",
      "Use Refund instead when the money is genuinely going back, and Write off when it is not coming back at all.",
    ],
    tip: "If the register and the ledger stop agreeing, the screen says so with both figures. That almost always means a voucher was reversed in the Day Book without the register being told.",
  },
  {
    id: "retention-agrees", category: "Finance & Accounting", screens: ["/finance/retention"],
    title: "When the retention register and the accounts disagree",
    summary: "The register should equal the balance on the retention accounts. If it does not, something was missed.",
    body: "Two records hold the same money: this register, and accounts 1160 Retention Receivable and 2200 Retention Payable in your ledger. They should always show the same totals. The screen compares them and only says something when they differ.",
    steps: [
      "Read the message if one appears \u2014 it gives both figures and the difference.",
      "Usually it means a certificate withheld retention and nobody recorded it here, so add the missing entry.",
      "It can also mean the opposite: an entry was recorded here for a certificate that never actually held anything back.",
      "Once the two agree the message disappears on its own.",
    ],
    tip: "This matters most when you are chasing a client. If you claim retention the ledger does not support, the query comes straight back at you.",
  },
  {
    id: "bank-reconciliation", category: "Finance & Accounting", screens: ["/finance/bank-rec"],
    title: "Reconciling the bank",
    summary: "Explain the difference between your books and the bank statement, line by line.",
    body: "Your books and the bank almost never show the same figure, and usually for a perfectly good reason: a cheque written last week has not been presented, or a transfer banked yesterday has not been credited. The point of reconciling is not to make them equal, it is to explain the difference item by item \u2014 so that whatever is left over is a real problem. It is the check that proves your cash figure is true, and without it the bank balance can drift for a year before anyone notices.",
    steps: [
      "Open Finance -> Bank Rec and choose the account and the statement date.",
      "Type the closing balance printed on the statement, and give the statement a name like 'Aug-2026'.",
      "Tick every line the statement shows. If nearly all of them cleared, use 'Tick everything up to that date' and then untick the few that did not.",
      "Read the Difference box. Nil means the account is reconciled; anything else is still to be found.",
    ],
    tip: "'Not yet on the statement' should be a short list of recent items. If something has been sitting there for months the amber warning will say so \u2014 a cheque over six months old will generally be refused by the bank, so it is no longer a timing difference and needs writing back.",
  },
  {
    id: "cheque-register", category: "Finance & Accounting", screens: ["/finance/cheques"],
    title: "Post-dated cheques — keeping track of what is due to be banked",
    summary: "Record the cheques you hold and the ones you have written, and see what is coming.",
    body: "A customer hands you six cheques dated one a month. Until each date arrives you cannot bank them, but you still need to know they exist, what they are worth and when they land. The register holds them. Recording a cheque does not change your accounts at all — it is a promise, not money. Your accounts only change on the day you mark a cheque Cleared, because that is the day the bank actually paid it.",
    steps: [
      "Open Finance -> Cheques and click Record a cheque. Choose whether you received it or issued it, put in the number, the bank, the amount, and the date written on the cheque — not today's date.",
      "Say who is holding the paper. A cheque can be banked by whoever has it, so this matters.",
      "When you take it to the bank, click Update and mark it Deposited. When the bank pays it, mark it Cleared.",
      "Marking it Cleared posts the receipt or payment for you, dated the day it cleared.",
    ],
    tip: "Watch the amber box at the top. It counts cheques whose date has already passed that are still sitting with you — that is money nobody banked, and it will not remind you itself.",
  },
  {
    id: "cheque-bounced", category: "Finance & Accounting", screens: ["/finance/cheques"],
    title: "When a cheque bounces",
    summary: "Mark it Bounced. Nothing needs unwinding, because nothing was posted.",
    body: "If the bank returns a cheque unpaid, click Update on that cheque and mark it Bounced. Because the accounts were never touched when you recorded it, there is nothing to reverse — the invoice simply stays owed, which is the truth. If the customer gives you a replacement cheque, record that as a new one and mark the old one Returned.",
    steps: [
      "Find the cheque on Finance -> Cheques and click Update.",
      "Choose Bounced and give the date the bank returned it.",
      "The invoice stays outstanding on the Outstanding screen, because you have not been paid.",
      "Charge any bank fee as a normal expense voucher, and record a replacement cheque if you are given one.",
    ],
    tip: "A customer whose cheques bounce more than once is a credit decision, not just an accounting one. Set Show settled ones too on the register to see their history.",
  },
  {
    id: "corporate-tax-what", category: "Finance & Accounting", screens: ["/finance/corporate-tax"],
    title: "Corporate tax — what it is and when it is due",
    summary: "Nine per cent on profit above AED 375,000, once a year, filed within nine months of your year end.",
    body: "Since June 2023 every UAE company pays corporate tax on its profit. The first AED 375,000 of taxable income is taxed at nothing; anything above that is taxed at 9%. It is a band, not a cutoff — making AED 400,000 does not mean paying 9% on all of it, only on the AED 25,000 above the line. There is one return a year, covering your financial year, and both the return and the payment are due nine months after that year ends. A December year end means a 30 September deadline.",
    steps: [
      "Open Finance -> Corporate Tax and pick the company. Every company files its own return, so do this once for each.",
      "Click 'Open a tax period' and pick the financial year. The dates fill in from your year start, and the screen tells you the deadline.",
      "The profit comes straight from your ledger. You do not type it in.",
      "Add the adjustments (the next article explains those), then read the tax at the bottom.",
      "File the return in EmaraTax, then come back and click 'Mark as filed' with the reference, so the working paper is tied to the filing.",
    ],
    tip: "Filing late costs AED 500 a month for the first year and AED 1,000 a month after that, whether or not any tax is owed. Even a company with no profit has to file.",
  },
  {
    id: "corporate-tax-adjustments", category: "Finance & Accounting", screens: ["/finance/corporate-tax"],
    title: "Why the taxable profit is not the same as your accounts",
    summary: "The tax law disallows some costs and ignores some income. Each difference is an adjustment.",
    body: "Your accounts show what the business actually earned and spent. The tax law disagrees with them in a handful of places, and each disagreement is written down as an adjustment with a reason. The two that catch nearly everybody: fines and penalties are never deductible, so the whole amount is added back; and only half of client entertainment is deductible, so the other half is added back. Going the other way, a dividend from another UAE company is exempt income, so it comes out.",
    steps: [
      "Click 'Add an adjustment' and choose what it is. Each choice explains itself and gives an example.",
      "Enter the amount as a positive number — whether it is added back or taken off is the box beside it, not a minus sign.",
      "Write why in the note. In two years' time that note is the answer to the FTA's question.",
      "Watch the computation on the left update as you go.",
    ],
    tip: "For entertainment, type the total you spent into the box that appears and the form works out the half for you.",
  },
  {
    id: "corporate-tax-small-business", category: "Finance & Accounting", screens: ["/finance/corporate-tax"],
    title: "Small Business Relief — paying no tax at all",
    summary: "Turnover of AED 3 million or less can be treated as having no taxable income. You have to claim it.",
    body: "A business whose revenue is AED 3,000,000 or less can elect to be treated as having no taxable income, which means no corporate tax at all. It runs to tax periods ending on or before 31 December 2029. Two things matter: it is measured on revenue, not profit — a company turning over five million and making a small profit cannot claim — and it is not automatic. Somebody has to elect it on the return.",
    steps: [
      "Open the return and click 'Losses & relief'.",
      "The screen says whether the company qualifies on revenue, and what claiming it saves.",
      "Tick the box to claim it. The computation shows the relief on its own line, so it is clear what was given up.",
      "You still have to file the return, even though there is nothing to pay.",
    ],
    tip: "You cannot claim it if the company is a Qualifying Free Zone Person, or part of a group turning over more than AED 3.15 billion worldwide. The system cannot check either of those — you have to know, and your tax adviser will.",
  },
  {
    id: "corporate-tax-losses", category: "Finance & Accounting", screens: ["/finance/corporate-tax"],
    title: "Carrying a loss forward",
    summary: "A loss is not wasted. It reduces a later year's tax, but only three quarters of it at a time.",
    body: "If a year makes a loss, that loss can be set against a later year's profit. It carries forward for as long as it takes — there is no expiry. What it cannot do is wipe out a year completely: at most 75% of a year's taxable income can be covered by brought-forward losses, and the rest waits for the year after. When you open a new period the system carries the unused balance over for you.",
    steps: [
      "Open the return and click 'Losses & relief' to see or correct the amount brought in.",
      "The computation shows how much of it could be used this year and how much waits.",
      "Open next year's period from this screen and the leftover is carried over automatically.",
    ],
    tip: "Check the brought-forward figure the first time you use this screen — the system only knows about the years you have entered into it.",
  },
  {
    id: "trial-balance", category: "Finance & Accounting", screens: ["/finance/trial-balance"],
    title: "Trial balance \u2014 proving the books add up",
    summary: "Every account's opening, its movement in the period, and its closing, in four columns.",
    body: "The trial balance is the check that nothing is missing a side. Every entry has a debit and a credit, so when you add up all the debits and all the credits they must come to the same number. This screen does that for you and says at the top whether it balances. It is also the first report your auditor will ask for.",
    steps: [
      "Open Finance -> Trial Balance and choose the dates at the top.",
      "Read the green line: 'In balance' means every voucher has both sides.",
      "Opening is what each account brought in from before the period. 'In the period' is the total that went in and the total that went out \u2014 not the difference between them. Closing is where the account ended.",
      "Use Print for the auditor's file, or Export for a spreadsheet.",
    ],
    tip: "Opening plus what moved always equals closing, on every line. If a figure looks wrong, that is the quickest way to find which of the three is the odd one \u2014 then click through to Ledgers for that account to see the individual vouchers.",
  },
  {
    id: "vat-agrees-to-books", category: "Finance & Accounting", screens: ["/finance/vat"],
    title: "Checking the VAT return before you file it",
    summary: "The return and the accounts should show the same number. The screen tells you if they do not.",
    body: "The VAT return is worked out from the treatment you put on each voucher line. Your accounts hold the tax itself, on 2150 VAT Output (what you owe the FTA) and 1150 VAT Input (what you can reclaim). Those two ways of arriving at the figure should agree. The panel at the top of the VAT screen does that comparison for you.",
    steps: [
      "Open Finance -> VAT and pick the quarter.",
      "Read the panel at the top. 'Difference 0.00 \u2014 agreed' means the return matches your accounts and is safe to file.",
      "If there is a difference, look at the unclassified figure and the list of untreated vouchers further down the screen.",
      "Fix the vouchers, then check the panel again before you submit anything to the FTA.",
    ],
    tip: "The usual causes of a difference are tax posted to an account other than 1150 or 2150, a line given a VAT treatment but no tax, or tax entered on a voucher whose lines carry no treatment at all. Always post the VAT on an invoice to 1150 or 2150 and this stays at zero.",
  },
  {
    id: "labour-on-jobs", category: "Finance & Accounting", screens: ["/finance/jobs", "/hr/attendance"],
    title: "Putting your people's time onto a job",
    summary: "Log hours against a job, then charge them, so the margin includes the wages.",
    body: "Wages are usually the biggest cost on a job, but they only reach job costing if someone records who worked on what. Time is logged on HR -> Attendance & Timesheets, against a job from the list. Each entry stores an hourly cost at the moment it is saved, so a pay rise later does not change what last year's work cost. Recording the hours is not the same as charging them: the Job Costing screen has a Post labour button that turns the logged hours into cost on the jobs.",
    steps: [
      "Open HR -> Attendance & Timesheets and use the Job timesheets form. Pick the person, the job and the hours; the note underneath shows what that entry will cost the job.",
      "Open Finance -> Job Costing. If time is waiting, a message at the top says how many hours and how much.",
      "Click Post labour, check the figures it shows you, and confirm. It writes one voucher.",
      "The jobs now include their labour, and the message disappears until more time is logged.",
    ],
    tip: "Your profit does not change when you post labour, and that is correct: the wages were already in the accounts as Salaries & Wages. Posting only moves the cost onto the jobs that used it, so the pair 'Site Labour' and 'Labour Recovered' cancel out in the Profit & Loss. What the difference between Salaries & Wages and Labour Recovered tells you is how much wage cost was not charged to any job at all.",
  },
  {
    id: "timesheet-no-job", category: "Finance & Accounting", screens: ["/hr/attendance"],
    title: "Why time without a job matters",
    summary: "Hours logged with no job cost nothing on any job, so margins look better than they are.",
    body: "If a timesheet entry has no job on it, that work never reaches job costing. The wages are still paid and still appear in the Profit & Loss, but no job carries them, so every job margin reads better than the truth. The Attendance screen counts these for you.",
    steps: [
      "On HR -> Attendance & Timesheets, look for the note saying how many entries have no job on them.",
      "In the list, those rows show 'no job' in amber in the Job column.",
      "Delete and re-enter them against the right job. Once time has been charged to a job it can no longer be deleted \u2014 reverse the voucher in the Day Book instead.",
    ],
    tip: "If someone's time genuinely is not for a customer \u2014 workshop tidying, training, waiting for materials \u2014 that is real information, not a mistake. It is the gap between Salaries & Wages and Labour Recovered on the Profit & Loss, and it tells you what your unbilled time is costing.",
  },
  {
    id: "cost-centres", category: "Finance & Accounting", screens: ["/finance/cost-centres"],
    title: "Cost centres — what your own business costs to run",
    summary: "For costs no single customer job pays for: the workshop, the vehicles, the office.",
    body: "Not every cost belongs to a customer's job. The rent, the workshop, the vehicles and the office staff cost money whether or not you win any work. A cost centre is where you put those, so you can see what they add up to. A voucher line carries a job OR a cost centre, never both — otherwise the same cost would be counted twice when you read the two reports side by side.",
    steps: [
      "Open Finance -> Cost Centres and click 'New cost centre'. Start simple: Head office, Workshop, Vehicles.",
      "When you post a cost that is not for a customer job, use the 'Charge to' box on the line and pick the cost centre instead of a job.",
      "'Own cost' is what was posted to that centre itself. 'Including below' adds up anything sitting underneath it — useful if you put Cranes and Pickups under Vehicles.",
      "Watch the 'Cost with nothing on it' figure at the top. That is money spent with neither a job nor a cost centre against it.",
    ],
    tip: "While 'Cost with nothing on it' is above zero, your job margins are flattering — that cost has to belong somewhere. Click through to the Day Book to find the vouchers and tag them.",
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
    id: "midday-break", category: "Human Resources", screens: ["/hr/reports", "/hr/attendance"],
    title: "The summer midday break",
    summary: "No outdoor work 12:30\u201315:00, from 15 June to 15 September. Your punch data is the proof.",
    body: "Every summer MOHRE bans work in direct sun between 12:30 and 15:00, from 15 June to 15 September. It is the rule a site breaks by accident \u2014 on the first hot week, when somebody decides to push on through lunch \u2014 and the one an inspector asks about. The punch machine already knows who was on site and when, so the system reads it back: during the season, HR -> Compliance lists any day where somebody was on site right across the break.",
    steps: [
      "Import the punch log as usual on HR -> Attendance. The in and out times are kept, not just the hours.",
      "During the season, open HR -> Compliance. The midday panel lists the days to look at.",
      "If nobody appears, the panel says so \u2014 and that is the evidence, not merely the absence of a complaint.",
    ],
    tip: "These are days to look at, not breaches. The punches show a man was on site across the break; they cannot show whether he was outdoors in the sun. An electrician in a plant room is not in breach. Where the work was outdoors, he is.",
  },
  {
    id: "iloe", category: "Human Resources", screens: ["/hr/reports", "/hr"],
    title: "Unemployment insurance (ILOE)",
    summary: "Compulsory since 2023. AED 5 a month up to a 16,000 basic, AED 10 above it.",
    body: "ILOE pays an employee part of their salary for a few months if they lose their job through no fault of their own. Subscribing is compulsory and the employee pays: AED 5 a month where basic pay is AED 16,000 or less, AED 10 a month above that. Not subscribing is a AED 400 fine on them \u2014 but since 2026 an unpaid ILOE liability blocks a work permit or visa transaction, which makes it the employer's problem the next time a visa needs renewing.",
    steps: [
      "Tick 'ILOE subscribed' on the employee record, and put the renewal date in 'ILOE renews'.",
      "HR -> Compliance lists anybody not subscribed, and anybody whose cover renews within sixty days or has lapsed.",
      "Investors and owners, domestic workers, temporary staff, anybody under eighteen and a pensioner in a new job are outside the scheme. Tick 'Outside the ILOE scheme' and they stop appearing.",
    ],
    tip: "The band is measured on BASIC pay, not the package. A pay rise past AED 16,000 basic does not move an existing subscription by itself \u2014 the employee has to change the tier, so it is worth a reminder when you raise somebody.",
  },
  {
    id: "emiratisation", category: "Human Resources", screens: ["/hr/reports", "/companies"],
    title: "Emiratisation \u2014 how many UAE nationals you need",
    summary: "It starts at 20 employees. The bill for missing it is the size of a salary.",
    body: "Two rules, and which applies depends on headcount. Between 20 and 49 employees, a company in one of the fourteen sectors MOHRE has named \u2014 construction and real estate among them \u2014 must employ two UAE nationals by 2026, and the shortfall was collected in January 2026 as a one-off AED 108,000 per missing hire. At 50 employees and above the target is 2% growth a year in skilled roles, and an unfilled position costs AED 9,000 a month. Below 20 employees neither applies yet.",
    steps: [
      "On the company record, tick 'In an Emiratisation priority sector' if it trades in one of the named sectors. Nothing on a trade licence tells the system this.",
      "Tick 'Skilled role' on the employee records that count as skilled \u2014 that is what the 2% is measured against once you pass 50 staff.",
      "HR -> Compliance shows required against actual for each company, and what a shortfall would cost.",
    ],
    tip: "UAE nationals are counted from the nationality on each record, and the panel lists the names it counted. If somebody is missing from that list, their nationality is spelled in a way the system does not recognise \u2014 'Emirati', 'UAE' and 'United Arab Emirates' all work. Nafis pays a salary top-up of up to AED 7,000 a month towards a national's package, which changes the arithmetic of hiring one.",
  },
  {
    id: "payroll-journal", category: "Finance & Accounting", screens: ["/hr/payroll", "/finance/daybook"],
    title: "Payroll goes into the accounts by itself",
    summary: "Marking a run Paid posts the salary journal. Nobody re-keys it.",
    body: "When a payroll run is marked Paid, the month goes into the ledger as one voucher: the wage cost to 6000 Salaries & Wages, the money out of 1000 Cash at Bank, and any salary advance recovered against 1170 Employee Advances \u2014 because an advance is money the employee owes back, not a cost the month it is lent. The three lines balance by construction, and it is the same arithmetic the payslip shows.",
    steps: [
      "Run payroll, check the payslips, then Approve and Mark paid.",
      "The voucher appears in Finance -> Day Book with the period in its memo.",
      "If the company is missing account 6000 or 1000, the run says so instead of posting a half entry.",
    ],
    tip: "A run that has been posted cannot go back to being a draft \u2014 the voucher would still be sitting in the ledger and the two would disagree. To undo it, reverse the voucher in the Day Book first.",
  },
  {
    id: "hr-policy", category: "Human Resources", screens: ["/hr/policy", "/hr"],
    title: "Setting your own HR policy",
    summary: "Leave, notice, probation, overtime, sick pay, gratuity and the ticket \u2014 your handbook, not ours.",
    body: "UAE labour law is a floor, not a rule. Thirty days of annual leave is the least you may give and plenty of companies give more; the same goes for overtime rates, sick pay and gratuity. HR -> Policy is where you put what YOUR handbook says, per company \u2014 the three companies in a group do not have to match. Every other screen then follows it: leave balances, payslips, overtime, absence deductions, the final settlement.",
    steps: [
      "Open HR -> Policy and pick the company.",
      "Each box shows what the law requires beside it, so you can see whether a change is allowed before you make it.",
      "Fill in 'Where this comes from' \u2014 the handbook clause or the board minute. In two years somebody will ask why the notice period is sixty days.",
      "Save. Everything calculated from that moment uses your figures.",
      "'Copy this policy to' puts the same handbook onto another company, so a group does not key twenty numbers three times.",
    ],
    tip: "A company that never opens this screen runs on the statutory minimums, so it is compliant by default. Changing a figure does not rewrite payslips or settlements already produced \u2014 those are the record of what was actually paid.",
  },
  {
    id: "hr-policy-limits", category: "Human Resources", screens: ["/hr/policy"],
    title: "\u201cThat is below what the law allows\u201d",
    summary: "You can be more generous than the law. You cannot be less.",
    body: "Some settings have a floor and some have a ceiling, and both exist to protect the employee. You cannot set annual leave below 30 days, overtime below 125%, gratuity below 21 days a year, or notice below 30 days \u2014 those are minimums. You cannot set probation above six months or a normal working day above eight hours \u2014 those are maximums. If you try, the screen refuses and tells you which article says so. Saving is held until it is fixed.",
    steps: [
      "Read the message under the box. It names the limit and the reason.",
      "If your handbook genuinely says something the law does not allow, the handbook is the thing to change \u2014 an unlawful clause is unenforceable anyway.",
      "'Reset to the law' puts a company back on the statutory minimums if the settings have got into a mess.",
    ],
    tip: "The daily-wage divisor is a good example of a limit that looks backwards. It cannot go ABOVE 30, because a larger divisor makes every day of pay smaller \u2014 so 26 is allowed and generous, and 31 is not.",
  },
  {
    id: "leave-accrual", category: "Human Resources", screens: ["/hr/leave", "/hr"],
    title: "How annual leave builds up",
    summary: "Nothing for six months, then 2 days a month, then 30 days a year. It is worked out, not typed in.",
    body: "Annual leave is not a number somebody sets \u2014 it is earned. UAE law gives nothing for the first six months, two days for each month of service between six months and a year, and thirty days a year once a full year is complete. The system works the balance out from the join date and the leave that has actually been approved, so it can never drift from the records behind it. That matters more than it sounds: the leave balance is what gets paid out in cash when somebody leaves.",
    steps: [
      "Open Finance is not needed \u2014 go to HR -> Leave. Each person shows their balance and how it was arrived at.",
      "'16 accrued \u2212 4 taken' means exactly that. Nothing else is involved.",
      "A new joiner shows 'not yet' until six months are up, with a note saying so.",
      "Approving a request moves the balance by itself. There is no separate number to keep in step.",
    ],
    tip: "If somebody joined with leave already owed from a previous system, put that figure in 'Leave opening adjustment' on their record. It is added to what they accrue here.",
  },
  {
    id: "leave-ceiling", category: "Human Resources", screens: ["/hr/leave"],
    title: "Why some leave lapsed",
    summary: "A balance is held at 60 days \u2014 this year's 30 plus 30 carried over. Anything above that is lost.",
    body: "The law expects leave to be taken in the year it is earned and says nothing about hoarding it, so a ceiling is a company policy rather than a legal rule. Without one, somebody who never takes leave builds a balance that turns into a five-figure payout nobody budgeted for. The ceiling here is sixty days: this year's thirty, plus thirty carried over. Days above it are shown as lapsed rather than quietly dropped, so an employee asking where their leave went gets an answer.",
    steps: [
      "The balance line says '\u00b7 12 lapsed above the 60-day ceiling' when it applies.",
      "The fix is to get leave taken, not to raise the ceiling.",
    ],
    tip: "Somebody sitting near the ceiling is a planning problem, not an accounting one. It usually means one person is holding the job together and cannot be spared.",
  },
  {
    id: "probation", category: "Human Resources", screens: ["/hr", "/hr/reports"],
    title: "Probation \u2014 six months, and the date matters twice",
    summary: "Six months maximum, no extension. Notice is 14 days while it runs, the contract's figure after.",
    body: "Article 9 allows a probation period of six months at the very most, and it cannot be extended. The date matters in two ways that are both easy to miss: a confirm-or-release decision is due before it passes, and the moment it passes the notice period changes from fourteen days to whatever the contract says. Miss it and you have confirmed somebody by accident.",
    steps: [
      "Set 'Probation ends' on the employee record when you take somebody on. Six months from the join date at most.",
      "HR -> Compliance lists anybody whose probation ends within thirty days, and anybody whose date has passed with no decision recorded.",
      "When a decision is taken, tick 'Probation cleared'. They drop off the list.",
    ],
    tip: "During probation an employee leaving for another UAE job owes a month's notice, and one leaving the country owes fourteen days. The employer owes fourteen days either way.",
  },
  {
    id: "duplicate-employee", category: "Human Resources", screens: ["/hr"],
    title: "\u201cThat Emirates ID is already on someone else\u201d",
    summary: "Two records for one person means they get paid twice. The ID and the passport are checked.",
    body: "A duplicate employee record is not a tidiness problem. Both records go into the payroll run, both go into the bank's WPS file, and the same person is paid twice \u2014 which is discovered a month later by the accountant, not the day it happens. An Emirates ID and a passport number each identify exactly one human being, so the system will not let two records in the same company carry the same one.",
    steps: [
      "If you see this message, the person is already on the system. Search for the number in the box at the top of the employee list to find them.",
      "Update the record that already exists rather than making a second one.",
      "If someone genuinely was entered twice, set the spare to Inactive so it stays out of payroll, and keep whichever record has the history on it.",
    ],
    tip: "Names are not checked, because two men really can be called the same thing. The document numbers are what make somebody unique.",
  },
  {
    id: "payroll-overtime", category: "Human Resources", screens: ["/hr/payroll", "/hr/attendance"],
    title: "Overtime \u2014 the two rates, and where the hours come from",
    summary: "125% normally, 150% at night or on a rest day. Both are worked out on basic pay.",
    body: "UAE law pays overtime on the BASIC salary, not the whole package, and at two different rates. Ordinary extra hours are paid at 125%. Hours between 22:00 and 04:00 are paid at 150%, and so is work on a rest day or a public holiday when the man is not given a day off instead. The system keeps the two apart because they are priced differently and the payslip has to show which is which.",
    steps: [
      "Overtime is entered on Attendance, not on the payroll run \u2014 that way it is recorded once, on the day it happened.",
      "If you import the punch machine's log, the hours past the eighth are picked up automatically, and any that fall between 22:00 and 04:00 are put on the 150% line for you.",
      "For the days there are no punches for, use the 'OT hrs' and 'OT @150%' boxes when you mark the day.",
      "The payroll run adds up the month's overtime and prices it. The payslip shows the hours beside the money.",
    ],
    tip: "An hour of basic is the monthly basic divided by 30, then by 8. On a basic of AED 3,000 that is AED 12.50 \u2014 so an ordinary overtime hour is AED 15.63 and a night hour is AED 18.75.",
  },
  {
    id: "payroll-part-month", category: "Human Resources", screens: ["/hr/payroll", "/hr"],
    title: "Somebody joined or left in the middle of the month",
    summary: "They are paid for the days they were employed. Set the join date and the last working day.",
    body: "A man who starts on the 20th of a thirty-day month is paid eleven thirtieths of his salary, not all of it. A man who leaves on the 12th is paid twelve days, not nothing. The system works both out from the join date and the last working day on his record \u2014 so those two dates are the only thing you have to get right. A whole month is always a whole month's pay, whatever the month's length: February does not pay less than March.",
    steps: [
      "For a joiner, put the real join date on the employee record before running payroll.",
      "For a leaver, open their record and set 'Last working day'. Do not just mark them Inactive \u2014 that would leave them off the run entirely and they would be paid nothing for the days they worked.",
      "Run payroll as normal. The payslip shows '11/30' in the Days column and says 'joined 2026-09-20' under the name.",
      "The days figure also goes into the WPS file, so the bank's record matches what you paid.",
    ],
    tip: "Overtime is not reduced for a part month. An hour worked is an hour worked, whenever in the month somebody joined.",
  },
  {
    id: "payroll-deductions", category: "Human Resources", screens: ["/hr/payroll", "/hr/leave"],
    title: "What comes off a salary, and where each piece is entered",
    summary: "Unpaid leave, sick leave and absence come off by themselves. Fines you enter, with a reason.",
    body: "Most deductions are worked out for you, from records you have already made. Approved unpaid leave, days marked Absent on the muster, and the unpaid part of sick leave are all taken off automatically. The only figure you key is a fine or an agreed recovery \u2014 and the system will not save one without a note saying what it was for, because that note is the answer when the man asks a year later.",
    steps: [
      "Unpaid leave: approve it on the Leave screen. The days are deducted when payroll runs.",
      "Absence: mark the day Absent on Attendance. Same thing.",
      "Sick leave: approve it on the Leave screen and the pay ladder is applied for you (see the next article).",
      "A fine or a recovery: open the draft payroll run, click the pencil beside the man's payslip, enter the amount and say what it is for.",
      "A deduction can never take a payslip below nil, whatever is entered.",
    ],
    tip: "If a deducted figure looks wrong, fix it on Attendance or Leave rather than on the payslip \u2014 otherwise the payslip and the attendance record stop agreeing and neither can be trusted.",
  },
  {
    id: "payroll-sick-pay", category: "Human Resources", screens: ["/hr/leave", "/hr/payroll"],
    title: "How sick leave is paid",
    summary: "Ninety days a year: the first 15 at full pay, the next 30 at half, the last 45 unpaid.",
    body: "Sick leave is not simply paid or unpaid. UAE law gives ninety days in a year of service, in three bands: the first fifteen days at full pay, the next thirty at half pay, and the last forty-five with no pay at all. Beyond ninety there is no entitlement. The year the law means is the year of service \u2014 so a man who joined in March starts a fresh ninety days each March, not each January. The system tracks what has already been taken and applies the bands from where the year stands.",
    steps: [
      "Record every spell of sick leave on the Leave screen and approve it.",
      "Payroll works out which band each day falls into, using the sick leave already approved this service year.",
      "The payslip shows the unpaid part in the Days column as '\u2212 unpaid'.",
    ],
    tip: "Twenty sick days on a basic of AED 3,000 costs the man AED 250: fifteen days are at full pay and five at half, so two and a half days' pay is lost.",
  },
  {
    id: "payroll-not-ready", category: "Human Resources", screens: ["/hr/payroll", "/hr"],
    title: "Payroll says somebody is not ready",
    summary: "A record missing a salary, an IBAN or a labour-card number cannot go in the bank file.",
    body: "The WPS file the bank receives is all-or-nothing: one malformed row and the bank rejects the whole file, without telling you which row. So the check happens before the run, not at the bank. If any employee is missing a join date, a basic salary, an IBAN, a labour-card number or a bank routing code, the run stops and names them.",
    steps: [
      "Read the list. Each name says exactly what is missing.",
      "Open the employee and fill in what it asks for.",
      "If the person should not be paid at all \u2014 a half-finished record, or somebody who never started \u2014 set them to Inactive instead.",
      "Run payroll again.",
    ],
    tip: "This is worth doing properly once. A man with one wrong digit in his IBAN looks fine on screen, and before this check he would simply have been left out of the bank file and found out on payday.",
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
    id: "workforce-mix", category: "Human Resources", screens: ["/hr/workforce"],
    title: "Workforce mix — nationalities, and changing the balance",
    summary: "How many of each nationality you employ, and what it would take to shift it.",
    body: "MOHRE classifies each establishment, and that classification changes what every work permit costs. The mix of nationalities you employ is one of the things it looks at. This screen shows that mix for your own employees, largest nationality first, and measures it against the figure you are working to.",
    steps: [
      "Open HR → Reports → Workforce Mix. Each company is its own establishment, so pick the company at the top.",
      "The top row is the number that matters: your largest nationality as a share of your own staff.",
      "If it is over your target, the red panel gives three ways to close it — hires needed, the equivalent reduction, and how many of those visas fall due within 90 days.",
      "'Across the group' compares every company at a glance, so you can see which one needs attention.",
    ],
    tip: "The percentage is set on HR Policy and is yours, not ours. MOHRE sets the diversity figure and revises it, and this system does not claim to know today's — ask your PRO or typing centre what you should be working to, and put that number in.",
  },
  {
    id: "workforce-mix-counting", category: "Human Resources", screens: ["/hr/workforce", "/hr"],
    title: "Who counts in the workforce mix",
    summary: "Own employees only. Supplied labour and leavers are out.",
    body: "Only people your company sponsors are counted. Supplied labour is sponsored by the manpower supplier and sits on that supplier's establishment, so including them would give you a mix that belongs to somebody else. People who have left are excluded too.",
    steps: [
      "Mark a worker as 'Supplied' on their employee record and name the supplier — they are then kept out of this report, and out of payroll and WPS as well.",
      "Anybody with no nationality on file is counted in the headcount and shown as 'Not recorded'.",
    ],
    tip: "If some nationalities are missing, the screen gives a range instead of a single figure — for example 'between 61% and 64%'. Fill the blanks in before you quote a number to your PRO.",
  },
  {
    id: "overtime-report", category: "Human Resources", screens: ["/hr/overtime"],
    title: "Overtime — what it costs and where it broke the rules",
    summary: "Overtime by person, and the days somebody worked more of it than the law allows.",
    body: "Two different things on one screen. The money comes from approved payslips: how many overtime hours each person worked and what they were paid for them. The legality comes from the attendance record: UAE law allows two hours of overtime a day, and no more than 144 hours of work in any three weeks. Both counts are hours worked — paying some of them at the night rate does not make them fewer hours.",
    steps: [
      "Open HR → Reports → Overtime and set the dates at the top.",
      "Read the sentence at the top: it says whether anybody is over the legal cap.",
      "If a red panel appears, it lists exactly who, on which day, and by how much.",
      "The 'Of basic' column shows overtime as a share of a person's basic pay. Above half is legal but usually means the crew is short-handed.",
    ],
    tip: "A labour inspection reads the attendance record, not the payslip. If somebody is over the cap the fix is the roster, not the pay run — paying correctly for an over-long day does not make it lawful.",
  },
  {
    id: "manhours-report", category: "Human Resources", screens: ["/hr/manhours"],
    title: "Manhours — where the labour went",
    summary: "Hours on each job against the hours it was priced for.",
    body: "Job Costing tells you a job lost money, which you find out at the end. This tells you a job is eating its hours, which you find out while you can still do something. It reads the timesheets logged on Attendance, priced at the cost rate captured when each entry was made — so a pay rise later does not rewrite what last year's work cost.",
    steps: [
      "Open HR → Reports → Manhours and set the dates.",
      "The 'Used' column is hours spent as a share of the job's budget. Amber from 90%, red past 100%.",
      "Set a job's budget hours on Finance → Job Costing, edit the job, 'Budget manhours'. A job without one simply shows 'not set'.",
      "'By person' at the bottom shows who is carrying the hours and across how many jobs.",
    ],
    tip: "Watch two figures. 'Against no job' is time nobody booked to anything — it is missing from every job's cost. 'Not yet charged' is time booked to a job but not yet put into the accounts, so Job Costing's margin does not include it yet; run 'Post labour' on Job Costing to clear it.",
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
    body: "The audit log is a permanent record of key actions — created, updated, approved, deleted, posted — with the user, the time, and the address and device the person was using. Use it to answer 'who changed this?'.",
    steps: [
      "The newest entries are at the top. Each row is one thing that happened.",
      "'From' shows the internet address the request came from and the device, for example '86.98.x.x — Chrome on Windows'.",
      "Nothing here can be edited or deleted, by anyone, including an administrator. That is the point of it.",
    ],
    tip: "The address is the one the office or phone network was using at that moment, not a permanent label for a person. Two people in the same office share one.",
  },
  {
    id: "einvoicing", category: "Finance & Accounting", screens: ["/finance/einvoicing", "/finance/settings"],
    title: "Electronic invoicing — how it works",
    summary: "Your invoices reach the FTA through an accredited provider, not directly.",
    body: "UAE electronic invoicing has five corners: you, your Accredited Service Provider, your customer's provider, your customer, and the FTA. This system builds the document and hands it to your provider; they check it, sign it and transmit it. Nothing here talks to the FTA directly, and it is not supposed to — that is what accreditation is for.",
    steps: [
      "Appoint an Accredited Service Provider. The Ministry of Finance publishes who is accredited.",
      "Put their name and the two identifiers they give you on Finance → Setup → Finance Settings. Until those are filled in nothing is transmitted, and your invoices carry on working exactly as before.",
      "Issue invoices as usual. Then open Finance → Tax → e-Invoicing to send them and see what has got through.",
      "Use Preview first. It shows the exact document that would leave and lists anything a checker would refuse.",
    ],
    tip: "The status column has more than one kind of success on purpose. 'Sent' means your provider took it; 'Accepted' means they validated it; 'Delivered' means the customer's provider took it too. A document can be accepted by yours and refused by theirs hours later, and you need to be able to see which.",
  },
  {
    id: "einvoicing-refused", category: "Finance & Accounting", screens: ["/finance/einvoicing"],
    title: "When a document is refused",
    summary: "What the common refusals mean, and how to clear them.",
    body: "A document is checked here before it leaves, so most problems are caught before anybody else sees them. The screen lists every reason at once rather than one at a time.",
    steps: [
      "'The eInvoicing identifiers are not set' — your provider has not been recorded on Finance Settings yet.",
      "'Your VAT registration number is missing' — put it on Companies → edit the company. A tax invoice is not valid without it.",
      "'Your company address has no emirate' — a transmitted document carries the emirate as its own field, so one address line is not enough. Companies → edit the company.",
      "'The lines add to X but the document says Y' — the totals disagree, which a checker will refuse. Raise a credit note and re-issue rather than editing.",
    ],
    tip: "A zero-rated or exempt line has to say why it carries no tax. The system fills that in for you from the treatment on the line, which is one more reason to set the treatment per line rather than on the whole invoice.",
  },
  {
    id: "invoices", category: "Finance & Accounting", screens: ["/finance/invoices"],
    title: "Raising an invoice",
    summary: "Bill a customer, or record a supplier's bill, with proper lines.",
    body: "Finance → Entry → Invoices. An invoice you raise is saved as a draft first: nothing reaches the books, the VAT return or the customer until you issue it. Each line has a description, a quantity, a unit (metres, hours, lump sum), a rate and a VAT treatment — that detail is what makes it a tax invoice rather than a bookkeeping entry, and it is what the FTA will expect to be transmitted electronically.",
    steps: [
      "Click 'New invoice'. Choose the customer — payment terms come from their record, so the due date fills itself in.",
      "The date is today unless you change it. A back-dated invoice lands in that month on every report and on that quarter's VAT return — unless the books are closed up to a later date, in which case it will be refused.",
      "Add a line for each thing being billed. The totals at the bottom update as you type, VAT rate by VAT rate.",
      "Save as draft. Check it. Then 'Issue invoice' — that posts it and gives it its number for good.",
      "Once issued, use Print for the copy the customer receives.",
    ],
    tip: "For a supplier's bill switch to 'Suppliers billed us' first. Enter their invoice number, not one of ours — that is the number an auditor will look for when they match your input tax claim to the paperwork.",
  },
  {
    id: "invoices-issue", category: "Finance & Accounting", screens: ["/finance/invoices"],
    title: "Why an issued invoice cannot be edited",
    summary: "A draft is yours; an issued invoice is a legal document.",
    body: "Issuing does three things at once: it posts to the ledger, it takes the next number in a series that must have no gaps, and it produces a document the customer can claim VAT against. Letting it be edited afterwards would break all three — so the only way to change an issued invoice is a credit note, which leaves both halves on the record.",
    steps: [
      "To correct an issued invoice: raise a Credit Note and choose the invoice it adjusts.",
      "To cancel a draft you no longer want: it can simply be cancelled, because nothing was posted.",
      "If issuing is refused, the screen lists every reason at once — fix them all and try again.",
    ],
    tip: "The commonest refusal is your own VAT registration number missing. It goes on Companies → edit the company. A tax invoice is not valid without it, so the system will not issue one that lacks it.",
  },
  {
    id: "cash-flow", category: "Finance & Accounting", screens: ["/finance/cash-flow"],
    title: "Will we have the cash? — the forecast",
    summary: "What is in the bank now, what is due in and out, and whether it covers payroll.",
    body: "Every other finance report looks backwards. This one looks forward. It takes the balance on your bank accounts today, then lays out the money already dated to move — cheques you hold and cheques you have written, invoices on their due dates, retention on its release date, and wages on payday — week by week. The number to watch is the last column: what the bank looks like at the end of each week. Any week that goes below zero is shaded red.",
    steps: [
      "Open Finance, then Reports, then Cash Flow.",
      "Choose how far ahead to look: 4 weeks, 8, 13, or 6 months.",
      "Read the sentence at the top. It says in one line whether you are all right, getting tight, or heading for an overdraft — and in which week.",
      "Click into the week to see what is behind it: each cheque, invoice and payroll listed with its date.",
    ],
    tip: "Turn on 'Cautious view' before you promise anybody anything. It removes money you are owed but cannot be sure of — overdue invoices and retention still to be chased — while keeping every payment you have to make. If the answer is still yes with the cautious view on, it is a real yes.",
  },
  {
    id: "cash-flow-setup", category: "Finance & Accounting", screens: ["/finance/cash-flow", "/finance/settings", "/finance"],
    title: "Getting the cash flow forecast right",
    summary: "Two settings it depends on: which accounts are cash, and when you pay wages.",
    body: "The forecast can only count what it has been told about. If the opening figure looks too low, it is almost always one of these two.",
    steps: [
      "Mark every bank and petty cash account: Finance → Overview, edit the account, set 'Control account' to 'Cash or bank'. Miss one and the forecast starts short by that balance.",
      "Set payday: Finance → Setup → Finance Settings → 'Payday (day of the month)'. UAE law requires wages within 15 days of the month they cover, so most companies pay between the 25th and the 5th.",
      "The wage figure itself is not typed in — it is the total of your last approved payroll run, so it updates itself each month.",
    ],
    tip: "If a customer has given you a post-dated cheque against an invoice, the forecast counts the cheque and not the invoice as well. Counting both would show twice the money.",
  },
  {
    id: "audit-retention", category: "Administration & Security", screens: ["/audit"],
    title: "The Archive tab, and how far back this screen goes",
    summary: "Older entries move to an archive. Nothing is ever deleted.",
    body: "The audit trail collects an entry every time somebody creates, changes, approves or posts anything, and every time somebody signs in or fails to. After a year that is a lot of rows, and a screen that tries to show all of them gets slow. So entries older than the period you choose move to the Archive tab. They are still there, still readable, still unchangeable — they have simply moved off the front page. Nothing is deleted, by the system or by anyone.",
    steps: [
      "Recent / Archive: the two tabs at the top. The number beside each says how many entries it holds, so nothing ever looks lost.",
      "Use the arrows at the bottom to move through the pages, and 'Per page' to show more at a time.",
      "Administrators can change the period — 3 months up to 10 years. One year is the default.",
      "'Archive N now' does the move immediately. It also happens by itself every time the system is updated, so you rarely need the button.",
    ],
    tip: "The shortest period allowed is 30 days, so the current month is always on the first screen. Changing the period is itself written into the audit trail, along with who changed it — shortening it is not a way to make anything disappear.",
  },
  {
    id: "audit-signins", category: "Administration & Security", screens: ["/audit", "/users"],
    title: "Reading the sign-in records",
    summary: "Every sign-in, sign-out, failed password and lock-out is written down.",
    body: "Four kinds of entry appear alongside the normal ones. 'Signed in' and 'Signed out' are somebody arriving and leaving. 'Sign-in failed' is an attempt that did not work — a wrong password, a deactivated account, or an email address that has no account at all. 'Locked out' is the account being frozen for 15 minutes after three wrong passwords in a row.",
    steps: [
      "Somebody says they did not do something: find their name, check the time and the 'From' column against where they actually were.",
      "A user is being locked out repeatedly: look at the addresses. All the same one is usually a saved old password on a phone. Lots of different ones is somebody guessing.",
      "Names you do not recognise in a 'Sign-in failed' row are email addresses that were typed but have no account here. A few is ordinary internet background noise.",
    ],
    tip: "The sign-in page always says 'Invalid email or password', whether or not the account exists — deliberately, so a stranger cannot use it to find out who works here. The audit log is where the real reason is written, because only people you have granted access can read it.",
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
