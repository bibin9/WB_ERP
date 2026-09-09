import {
  LayoutGrid, BookOpen, ScrollText, FileBarChart, Receipt, RefreshCw, Users, Clock,
  HardHat, Building2, Scale, Banknote, Lock, Landmark, Percent, Settings2, PenLine,
  FolderOpen, UserPlus, Wallet, CalendarDays, CalendarCheck, BadgeCheck, UserMinus,
  ShieldAlert, ClipboardList, TrendingUp, Timer, type LucideIcon,
} from "lucide-react";

/**
 * The tabs across the top of a module, in two levels.
 *
 * Finance had sixteen tabs in one row, which wrapped onto three lines on a
 * laptop and was about to reach twenty-four as reports were added. A row that
 * long stops being navigation and becomes a list you read.
 *
 * So the top row is groups — seven of them for Finance — and a second, quieter
 * row appears only when the group you are in holds more than one screen. The
 * second row is never longer than five items, and single-screen groups
 * (Overview, Job Costing) show no second row at all.
 *
 * A dropdown menu would have kept it to one row, and was rejected: this is used
 * on phones on site, where a hover menu is a guess and a tap-to-open menu hides
 * where you are. Two short rows say where you are without being asked.
 */
export type TabScreen = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The RBAC screen key guarding it. */
  screen: string;
};

export type TabGroup = {
  key: string;
  label: string;
  icon: LucideIcon;
  screens: TabScreen[];
};

export const FINANCE_GROUPS: TabGroup[] = [
  {
    key: "overview", label: "Overview", icon: LayoutGrid,
    screens: [{ href: "/finance", label: "Overview", icon: LayoutGrid, screen: "finance.overview" }],
  },
  {
    key: "entry", label: "Entry", icon: PenLine,
    screens: [
      { href: "/finance/daybook", label: "Day Book", icon: BookOpen, screen: "finance.daybook" },
      { href: "/finance/ledgers", label: "Ledgers", icon: ScrollText, screen: "finance.ledgers" },
    ],
  },
  {
    key: "registers", label: "Registers", icon: FolderOpen,
    screens: [
      { href: "/finance/parties", label: "Parties", icon: Users, screen: "finance.parties" },
      { href: "/finance/cheques", label: "Cheques", icon: Banknote, screen: "finance.cheques" },
      { href: "/finance/retention", label: "Retention", icon: Lock, screen: "finance.retention" },
      { href: "/finance/bank-rec", label: "Bank Rec", icon: Landmark, screen: "finance.bankrec" },
      { href: "/finance/cost-centres", label: "Cost Centres", icon: Building2, screen: "finance.costcentres" },
    ],
  },
  {
    // Its own tab rather than one card inside Reports: the project managers are
    // in this screen every day, and a daily screen behind a second click is a
    // screen people stop opening.
    key: "jobs", label: "Job Costing", icon: HardHat,
    screens: [{ href: "/finance/jobs", label: "Job Costing", icon: HardHat, screen: "finance.jobs" }],
  },
  {
    key: "reports", label: "Reports", icon: FileBarChart,
    screens: [
      { href: "/finance/reports", label: "P&L / Balance Sheet", icon: FileBarChart, screen: "finance.reports" },
      { href: "/finance/trial-balance", label: "Trial Balance", icon: Scale, screen: "finance.reports" },
      { href: "/finance/outstanding", label: "Outstanding", icon: Clock, screen: "finance.outstanding" },
      { href: "/finance/cash-flow", label: "Cash Flow", icon: TrendingUp, screen: "finance.cashflow" },
    ],
  },
  {
    key: "tax", label: "Tax", icon: Percent,
    screens: [
      { href: "/finance/vat", label: "VAT", icon: Receipt, screen: "finance.vat" },
      { href: "/finance/corporate-tax", label: "Corporate Tax", icon: Percent, screen: "finance.corptax" },
    ],
  },
  {
    key: "setup", label: "Setup", icon: Settings2,
    screens: [
      { href: "/finance/settings", label: "Finance Settings", icon: Settings2, screen: "finance.settings" },
      { href: "/finance/tally", label: "Tally Sync", icon: RefreshCw, screen: "finance.tally" },
    ],
  },
];

export const HR_GROUPS: TabGroup[] = [
  {
    key: "people", label: "People", icon: Users,
    screens: [
      { href: "/hr", label: "Employees", icon: Users, screen: "hr.employees" },
      { href: "/hr/onboarding", label: "Onboarding", icon: UserPlus, screen: "hr.onboarding" },
      { href: "/hr/certifications", label: "Certifications", icon: BadgeCheck, screen: "hr.certifications" },
      { href: "/hr/separation", label: "Separation", icon: UserMinus, screen: "hr.separation" },
    ],
  },
  {
    key: "time", label: "Time", icon: CalendarCheck,
    screens: [
      { href: "/hr/attendance", label: "Attendance", icon: CalendarCheck, screen: "hr.attendance" },
      { href: "/hr/leave", label: "Leave", icon: CalendarDays, screen: "hr.leave" },
    ],
  },
  {
    key: "payroll", label: "Payroll", icon: Wallet,
    screens: [{ href: "/hr/payroll", label: "Payroll", icon: Wallet, screen: "hr.payroll" }],
  },
  {
    key: "reports", label: "Reports", icon: ShieldAlert,
    screens: [
      { href: "/hr/reports", label: "Compliance & Expiry", icon: ShieldAlert, screen: "hr.reports" },
      { href: "/hr/overtime", label: "Overtime", icon: Timer, screen: "hr.overtime" },
      { href: "/hr/manhours", label: "Manhours", icon: HardHat, screen: "hr.manhours" },
    ],
  },
  {
    key: "tasks", label: "Job Assignments", icon: ClipboardList,
    screens: [{ href: "/hr/tasks", label: "Job Assignments", icon: ClipboardList, screen: "hr.tasks" }],
  },
  {
    key: "setup", label: "HR Policy", icon: Scale,
    screens: [{ href: "/hr/policy", label: "HR Policy", icon: Scale, screen: "hr.policy" }],
  },
];

/** Drop screens this user may not open, then drop groups left with nothing. */
export function allowedGroups(groups: TabGroup[], allowedScreens: Iterable<string>): TabGroup[] {
  const allow = new Set(allowedScreens);
  return groups
    .map((g) => ({ ...g, screens: g.screens.filter((s) => allow.has(s.screen)) }))
    .filter((g) => g.screens.length > 0);
}

/**
 * Which group the current path is in.
 *
 * Longest matching href wins, so /finance/reports does not claim /finance.
 */
export function activeGroup(groups: TabGroup[], pathname: string): TabGroup | undefined {
  let best: { group: TabGroup; length: number } | undefined;
  for (const g of groups) {
    for (const s of g.screens) {
      const hit = pathname === s.href || pathname.startsWith(s.href + "/");
      if (hit && (!best || s.href.length > best.length)) best = { group: g, length: s.href.length };
    }
  }
  return best?.group;
}
