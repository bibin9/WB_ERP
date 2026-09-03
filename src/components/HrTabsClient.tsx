"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Users, ClipboardList, UserPlus, Wallet, CalendarDays, CalendarCheck, BadgeCheck, ShieldAlert } from "lucide-react";

const TABS = [
  { href: "/hr", label: "Employees", icon: Users, screen: "hr.employees" },
  { href: "/hr/onboarding", label: "Onboarding", icon: UserPlus, screen: "hr.onboarding" },
  { href: "/hr/payroll", label: "Payroll", icon: Wallet, screen: "hr.payroll" },
  { href: "/hr/leave", label: "Leave", icon: CalendarDays, screen: "hr.leave" },
  { href: "/hr/attendance", label: "Attendance", icon: CalendarCheck, screen: "hr.attendance" },
  { href: "/hr/certifications", label: "Certifications", icon: BadgeCheck, screen: "hr.certifications" },
  { href: "/hr/reports", label: "Compliance", icon: ShieldAlert, screen: "hr.reports" },
  { href: "/hr/tasks", label: "Job Assignments", icon: ClipboardList, screen: "hr.tasks" },
];

export default function HrTabsClient({ allowed }: { allowed: string[] }) {
  const pathname = usePathname();
  const allow = new Set(allowed);
  const tabs = TABS.filter((t) => allow.has(t.screen));
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={clsx(
              "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "border-brand-green text-brand-navy" : "border-transparent text-muted hover:text-ink"
            )}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
