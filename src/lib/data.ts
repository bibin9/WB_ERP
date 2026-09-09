import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Building2, Boxes, Users, Handshake,
  HardHat, ShieldCheck, Wallet, ClipboardList, Settings, UserCog, ScrollText,
  Database, KeyRound, LifeBuoy, LibraryBig,
} from "lucide-react";
import { activeTenant, type TenantCompany } from "@/config/tenant";
import { REPORTS } from "./reports";

/** Group companies come from the active tenant config (product / white-label). */
export const COMPANIES: TenantCompany[] = activeTenant.companies;
export type Company = TenantCompany;

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  phase: 1 | 2 | 3 | 4;
  module: string;
  /** Primary screen this nav entry opens (for screen-level visibility + landing). */
  screen: string;
  /** True for a whole-module entry (Finance/HR) that may land on any accessible screen. */
  moduleLanding?: boolean;
  /** Always visible regardless of permissions (e.g. Help). */
  alwaysShow?: boolean;
  /**
   * Visible if the user may open ANY of these screens.
   *
   * For an entry that is a directory rather than a screen of its own: it has no
   * permission to check, but showing it to somebody with nothing in it is a
   * menu item that opens onto a wall — and one that advertises that reports
   * exist without saying which, which is the opposite of what the rest of the
   * access control is careful to do.
   */
  requiresAny?: string[];
  group: string;
};

/** Sidebar sections in order. An empty label = a headerless workspace strip (not collapsible). */
export const NAV_GROUPS: { key: string; label: string }[] = [
  { key: "workspace", label: "" },
  { key: "finance", label: "Finance" },
  { key: "people", label: "Human Resources" },
  { key: "supply", label: "Sales & Supply Chain" },
  { key: "delivery", label: "Projects & Safety" },
  { key: "setup", label: "Setup & Administration" },
];

export const NAV: NavItem[] = [
  // Workspace
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, phase: 1, module: "dashboard", screen: "dashboard.home", group: "workspace" },
  { label: "Approvals", href: "/approvals", icon: ClipboardList, phase: 1, module: "approvals", screen: "approvals.inbox", group: "workspace" },
  // "All Reports", not "Reports", and the wording is doing work: Finance and HR
  // each have a Reports tab of their own, so three different places answered to
  // the same word. "All" says which one is the superset. It also matches the
  // "All reports" link at the end of every module tab strip, so the two ways in
  // read as the same destination.
  //
  // The screens come from the report registry rather than being listed here, so
  // a role that can open one report sees the entry and a role that can open none
  // does not — six of the seventeen roles fall in the second group.
  {
    label: "All Reports", href: "/reports", icon: LibraryBig, phase: 1,
    module: "reports", screen: "reports.centre", group: "workspace",
    requiresAny: [...new Set(REPORTS.map((r) => r.screen))],
  },
  // Finance (multi-screen module)
  { label: "Finance & Accounting", href: "/finance", icon: Wallet, phase: 1, module: "finance", screen: "finance.overview", moduleLanding: true, group: "finance" },
  // Human Resources (multi-screen module)
  { label: "HR & Admin", href: "/hr", icon: Users, phase: 1, module: "hr", screen: "hr.employees", moduleLanding: true, group: "people" },
  // Sales & Supply Chain
  { label: "CRM & Estimation", href: "/crm", icon: Handshake, phase: 2, module: "crm", screen: "crm.leads", group: "supply" },
  { label: "Inventory & SCM", href: "/inventory", icon: Boxes, phase: 2, module: "inventory", screen: "inventory.items", group: "supply" },
  // Projects & Safety
  { label: "Projects", href: "/projects", icon: HardHat, phase: 3, module: "projects", screen: "projects.list", group: "delivery" },
  { label: "HSE", href: "/hse", icon: ShieldCheck, phase: 3, module: "hse", screen: "hse.register", group: "delivery" },
  // Setup & Administration
  { label: "Companies & Group", href: "/companies", icon: Building2, phase: 1, module: "companies", screen: "companies.list", group: "setup" },
  { label: "Users & Roles", href: "/users", icon: UserCog, phase: 1, module: "users", screen: "users.list", group: "setup" },
  { label: "Access Control", href: "/settings/roles", icon: KeyRound, phase: 1, module: "users", screen: "users.access", group: "setup" },
  { label: "Master Data", href: "/settings/master-data", icon: Database, phase: 1, module: "settings", screen: "settings.master", group: "setup" },
  { label: "Audit Log", href: "/audit", icon: ScrollText, phase: 1, module: "audit", screen: "audit.log", group: "setup" },
  { label: "Settings", href: "/settings", icon: Settings, phase: 1, module: "settings", screen: "settings.general", group: "setup" },
  // Help — always available to everyone (top workspace strip)
  { label: "Help Center", href: "/help", icon: LifeBuoy, phase: 1, module: "help", screen: "help", alwaysShow: true, group: "workspace" },
];

export const PHASE_LABEL: Record<number, string> = {
  1: "Phase 1", 2: "Phase 2", 3: "Phase 3", 4: "Phase 4",
};
