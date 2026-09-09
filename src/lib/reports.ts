import {
  Scale, FileBarChart, Clock, HardHat, Building2, Receipt, Percent,
  ShieldAlert, BadgeCheck, Wallet, CalendarCheck, Banknote, Lock, Landmark,
  BookOpen, ScrollText, Users, TrendingUp, type LucideIcon,
} from "lucide-react";

/**
 * Every report in the system, in one list.
 *
 * There are two ways in — the Reports tab inside a module, and the Report
 * Centre in the sidebar — and they read from here rather than each keeping
 * their own list. Two lists would agree on the day they were written and not
 * afterwards, which is how a report ends up reachable from one place and
 * invisible from the other.
 *
 * `screen` is the existing RBAC key of the page it opens, so nothing new has to
 * be granted: if you may open the screen, you see the card; if not, you do not.
 */
export type ReportDef = {
  key: string;
  label: string;
  href: string;
  /** The RBAC screen key that already guards the page this opens. */
  screen: string;
  /** Which module's Reports tab it belongs to. */
  module: string;
  /** Heading it sits under in the Report Centre. */
  area: string;
  /**
   * What question it answers, in the words somebody would actually ask.
   *
   * This is the whole point of the index. "Outstanding & Ageing" means nothing
   * to a site engineer; "who owes us money, and for how long?" means exactly
   * one thing. A person who does not know the accounting word for what they
   * want can still find the report that has it.
   */
  question: string;
  icon: LucideIcon;
};

export const REPORT_AREAS = [
  "Money coming in and going out",
  "Performance",
  "Jobs and sites",
  "People",
  "Tax and statutory",
  "Records",
] as const;

export const REPORTS: ReportDef[] = [
  // ===== Money in / money out =====
  {
    key: "cash-flow", label: "Cash Flow Forecast", href: "/finance/cash-flow",
    screen: "finance.cashflow", module: "finance", area: "Money coming in and going out",
    question: "Will there be enough in the bank to cover the next payroll?", icon: TrendingUp,
  },
  {
    key: "outstanding", label: "Outstanding & Ageing", href: "/finance/outstanding",
    screen: "finance.outstanding", module: "finance", area: "Money coming in and going out",
    question: "Who owes us money, who do we owe, and how overdue is it?", icon: Clock,
  },
  {
    key: "cheques", label: "Cheque Register (PDC)", href: "/finance/cheques",
    screen: "finance.cheques", module: "finance", area: "Money coming in and going out",
    question: "Which post-dated cheques clear this month, and which have bounced?", icon: Banknote,
  },
  {
    key: "retention", label: "Retention Register", href: "/finance/retention",
    screen: "finance.retention", module: "finance", area: "Money coming in and going out",
    question: "How much of our money is being held back, and when is it released?", icon: Lock,
  },
  {
    key: "bank-rec", label: "Bank Reconciliation", href: "/finance/bank-rec",
    screen: "finance.bankrec", module: "finance", area: "Money coming in and going out",
    question: "Does our cash book agree with the bank statement?", icon: Landmark,
  },

  // ===== Performance =====
  {
    key: "pnl", label: "Profit & Loss / Balance Sheet", href: "/finance/reports",
    screen: "finance.reports", module: "finance", area: "Performance",
    question: "Did we make money this period, and what do we own and owe?", icon: FileBarChart,
  },
  {
    key: "trial-balance", label: "Trial Balance", href: "/finance/trial-balance",
    screen: "finance.reports", module: "finance", area: "Performance",
    question: "Do the books balance, account by account?", icon: Scale,
  },
  {
    key: "cost-centres", label: "Cost Centres", href: "/finance/cost-centres",
    screen: "finance.costcentres", module: "finance", area: "Performance",
    question: "What is each department or site costing us?", icon: Building2,
  },

  // ===== Jobs and sites =====
  {
    key: "jobs", label: "Job Costing", href: "/finance/jobs",
    screen: "finance.jobs", module: "finance", area: "Jobs and sites",
    question: "What did each job earn, what did it cost, and is it inside its budget?", icon: HardHat,
  },
  {
    key: "timesheets", label: "Job Timesheets", href: "/hr/attendance",
    screen: "hr.attendance", module: "hr", area: "Jobs and sites",
    question: "How many hours have gone onto each job?", icon: CalendarCheck,
  },

  // ===== People =====
  {
    key: "hr-compliance", label: "Compliance & Expiry", href: "/hr/reports",
    screen: "hr.reports", module: "hr", area: "People",
    question: "Whose visa, Emirates ID, labour card or passport is about to expire?", icon: ShieldAlert,
  },
  {
    key: "certifications", label: "Certifications", href: "/hr/certifications",
    screen: "hr.certifications", module: "hr", area: "People",
    question: "Which trade tickets and medicals need renewing?", icon: BadgeCheck,
  },
  {
    key: "payroll", label: "Payroll & Payslips", href: "/hr/payroll",
    screen: "hr.payroll", module: "hr", area: "People",
    question: "What was paid last month, to whom, and what went to the bank as WPS?", icon: Wallet,
  },
  {
    key: "employees", label: "Employee Register", href: "/hr",
    screen: "hr.employees", module: "hr", area: "People",
    question: "Who works here, on what salary, and under which company?", icon: Users,
  },

  // ===== Tax and statutory =====
  {
    key: "vat", label: "VAT Return (VAT 201)", href: "/finance/vat",
    screen: "finance.vat", module: "finance", area: "Tax and statutory",
    question: "What do we owe the FTA this quarter, box by box?", icon: Receipt,
  },
  {
    key: "corporate-tax", label: "Corporate Tax", href: "/finance/corporate-tax",
    screen: "finance.corptax", module: "finance", area: "Tax and statutory",
    question: "What corporate tax is due, and by when?", icon: Percent,
  },

  // ===== Records =====
  {
    key: "daybook", label: "Day Book", href: "/finance/daybook",
    screen: "finance.daybook", module: "finance", area: "Records",
    question: "Everything posted, in date order.", icon: BookOpen,
  },
  {
    key: "ledgers", label: "Ledgers & Statements", href: "/finance/ledgers",
    screen: "finance.ledgers", module: "finance", area: "Records",
    question: "Every movement on one account, or one customer's statement.", icon: ScrollText,
  },
];

/** The reports a user may open, given the screen keys they can view. */
export function visibleReports(allowedScreens: Iterable<string>, moduleKey?: string): ReportDef[] {
  const allow = new Set(allowedScreens);
  return REPORTS.filter((r) => allow.has(r.screen) && (!moduleKey || r.module === moduleKey));
}

/** Areas that actually have something in them, in the order declared above. */
export function groupReports(list: ReportDef[]): { area: string; reports: ReportDef[] }[] {
  return REPORT_AREAS.map((area) => ({ area, reports: list.filter((r) => r.area === area) }))
    .filter((g) => g.reports.length > 0);
}

/** Free-text search over the label and, deliberately, the question it answers. */
export function searchReports(list: ReportDef[], query: string): ReportDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const terms = q.split(/\s+/);
  return list.filter((r) => {
    const hay = `${r.label} ${r.question} ${r.area}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
