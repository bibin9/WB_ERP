/**
 * Role-Based Access Control taxonomy + helpers.
 *
 * Access is granted per SCREEN (a specific page inside a module), not per whole module.
 * Permissions are stored per Role as JSON: { "<screenKey>": ["view","create","edit","delete","approve"] }
 * e.g. { "hr.employees": ["view","edit"], "hr.payroll": ["view"] }
 *
 * A legacy module-level key (e.g. "hr": ["view"]) is still honoured and treated as granting
 * that action to every screen in the module, so older data keeps working.
 */

export const MODULES: { key: string; label: string; href: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "companies", label: "Companies & Group", href: "/companies" },
  { key: "finance", label: "Finance", href: "/finance" },
  { key: "hr", label: "HR & Admin", href: "/hr" },
  { key: "approvals", label: "Approvals", href: "/approvals" },
  { key: "users", label: "Users & Roles", href: "/users" },
  { key: "inventory", label: "Inventory & SCM", href: "/inventory" },
  { key: "crm", label: "CRM & Estimation", href: "/crm" },
  { key: "projects", label: "Projects", href: "/projects" },
  { key: "hse", label: "HSE", href: "/hse" },
  { key: "audit", label: "Audit Log", href: "/audit" },
  { key: "settings", label: "Settings", href: "/settings" },
];

export type ScreenDef = { key: string; module: string; label: string; href: string };

/** Every access-controllable screen, grouped by module. Order here drives the editor UI. */
export const SCREENS: ScreenDef[] = [
  { key: "dashboard.home", module: "dashboard", label: "Dashboard", href: "/dashboard" },

  { key: "companies.list", module: "companies", label: "Companies & Group", href: "/companies" },

  { key: "finance.overview", module: "finance", label: "Overview & Journals", href: "/finance" },
  { key: "finance.daybook", module: "finance", label: "Day Book", href: "/finance/daybook" },
  { key: "finance.ledgers", module: "finance", label: "Ledgers", href: "/finance/ledgers" },
  { key: "finance.reports", module: "finance", label: "Reports (P&L / Balance Sheet)", href: "/finance/reports" },
  { key: "finance.vat", module: "finance", label: "VAT Report", href: "/finance/vat" },
  { key: "finance.tally", module: "finance", label: "Tally Sync", href: "/finance/tally" },

  { key: "hr.employees", module: "hr", label: "Employees", href: "/hr" },
  { key: "hr.onboarding", module: "hr", label: "Onboarding", href: "/hr/onboarding" },
  { key: "hr.payroll", module: "hr", label: "Payroll", href: "/hr/payroll" },
  { key: "hr.leave", module: "hr", label: "Leave", href: "/hr/leave" },
  { key: "hr.attendance", module: "hr", label: "Attendance & Muster", href: "/hr/attendance" },
  { key: "hr.certifications", module: "hr", label: "Certifications", href: "/hr/certifications" },
  { key: "hr.reports", module: "hr", label: "Compliance & Expiry", href: "/hr/reports" },
  { key: "hr.tasks", module: "hr", label: "Job Assignments", href: "/hr/tasks" },

  { key: "approvals.inbox", module: "approvals", label: "Approvals Inbox", href: "/approvals" },

  { key: "users.list", module: "users", label: "Users", href: "/users" },
  { key: "users.access", module: "users", label: "Roles & Access Control", href: "/settings/roles" },

  { key: "inventory.items", module: "inventory", label: "Inventory & SCM", href: "/inventory" },

  { key: "crm.leads", module: "crm", label: "CRM & Estimation", href: "/crm" },

  { key: "projects.list", module: "projects", label: "Projects", href: "/projects" },

  { key: "hse.register", module: "hse", label: "HSE", href: "/hse" },

  { key: "audit.log", module: "audit", label: "Audit Log", href: "/audit" },

  { key: "settings.general", module: "settings", label: "General Settings", href: "/settings" },
  { key: "settings.master", module: "settings", label: "Master Data", href: "/settings/master-data" },
  { key: "settings.approvals", module: "settings", label: "Approval Routes", href: "/settings/approvals" },
  { key: "settings.custom", module: "settings", label: "Custom Fields", href: "/settings/custom-fields" },
];

export const ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
export type Action = (typeof ACTIONS)[number];

export type PermMap = Record<string, string[]>;

const MODULE_KEYS = new Set(MODULES.map((m) => m.key));
const SCREEN_KEYS = new Set(SCREENS.map((s) => s.key));

export const screensForModule = (moduleKey: string): ScreenDef[] => SCREENS.filter((s) => s.module === moduleKey);
export const isScreenKey = (key: string) => SCREEN_KEYS.has(key);
export const isModuleKey = (key: string) => MODULE_KEYS.has(key);
/** The module a key belongs to ("hr.payroll" -> "hr", "hr" -> "hr"). */
export const moduleOf = (key: string): string | undefined =>
  key.includes(".") ? key.split(".")[0] : MODULE_KEYS.has(key) ? key : undefined;

/** Merge many permission maps (a user may hold several roles across companies). */
export function mergePerms(maps: PermMap[]): PermMap {
  const out: PermMap = {};
  for (const m of maps) {
    for (const [k, acts] of Object.entries(m || {})) {
      out[k] = Array.from(new Set([...(out[k] || []), ...acts]));
    }
  }
  return out;
}

export function parsePerms(json: string | null | undefined): PermMap {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

type AccessSession = { isAdmin: boolean; perms: PermMap };

/**
 * Can the current user perform an action?
 * `key` may be a screen key ("hr.payroll") or a module key ("hr").
 * - screen key: granted if the screen grants it, or a legacy module-level grant covers it.
 * - module key: granted if the module grants it (legacy) or ANY of its screens grants it.
 */
export function can(session: AccessSession | null | undefined, key: string, action: Action = "view"): boolean {
  if (!session) return false;
  if (session.isAdmin) return true;
  const perms = session.perms || {};
  if ((perms[key] || []).includes(action)) return true;

  if (SCREEN_KEYS.has(key)) {
    const mod = moduleOf(key);
    return !!mod && (perms[mod] || []).includes(action);
  }
  if (MODULE_KEYS.has(key)) {
    return screensForModule(key).some((s) => (perms[s.key] || []).includes(action));
  }
  return false;
}

/** The module keys a user may see (for the sidebar's top-level groups). */
export function visibleModules(session: AccessSession | null | undefined): string[] {
  if (!session) return [];
  if (session.isAdmin) return MODULES.map((m) => m.key);
  return MODULES.filter((m) => can(session, m.key, "view")).map((m) => m.key);
}

/** The screen keys a user may view (optionally within one module) — for sub-tab filtering. */
export function visibleScreens(session: AccessSession | null | undefined, moduleKey?: string): string[] {
  const list = moduleKey ? screensForModule(moduleKey) : SCREENS;
  if (!session) return [];
  if (session.isAdmin) return list.map((s) => s.key);
  return list.filter((s) => can(session, s.key, "view")).map((s) => s.key);
}
