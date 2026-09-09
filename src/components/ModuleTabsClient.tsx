"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LibraryBig } from "lucide-react";
import { FINANCE_GROUPS, HR_GROUPS, allowedGroups, activeGroup } from "@/lib/moduletabs";

const SETS = { finance: FINANCE_GROUPS, hr: HR_GROUPS };

/**
 * The two-level tab strip. See lib/moduletabs.ts for why it is two levels.
 *
 * The company id rides along in the query string exactly as the old single row
 * did, so switching tabs does not silently switch you back to the first
 * company — which is the sort of thing that gets noticed a month later, on a
 * report that was quietly about the wrong entity.
 */
export default function ModuleTabsClient({
  module,
  companyId,
  allowed,
}: {
  module: keyof typeof SETS;
  companyId?: string;
  allowed: string[];
}) {
  const pathname = usePathname();
  const q = companyId ? `?c=${companyId}` : "";
  const groups = allowedGroups(SETS[module], allowed);
  const current = activeGroup(groups, pathname);
  const siblings = current && current.screens.length > 1 ? current.screens : [];

  return (
    <div className="mb-5 print:hidden">
      <div className="flex flex-wrap gap-1 border-b border-line">
        {groups.map((g) => {
          const active = current?.key === g.key;
          const Icon = g.icon;
          return (
            <Link
              key={g.key}
              href={`${g.screens[0].href}${q}`}
              className={clsx(
                "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                active ? "border-brand-green text-heading" : "border-transparent text-muted hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4" /> {g.label}
            </Link>
          );
        })}
        <span className="grow" />
        {/* Everything, across every module — for the person who came looking
            for a report rather than for this module. */}
        <Link
          href="/reports"
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted transition-colors hover:text-ink"
        >
          <LibraryBig className="h-4 w-4" /> All reports
        </Link>
      </div>

      {siblings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-2">
          {siblings.map((s) => {
            const active = pathname === s.href;
            const Icon = s.icon;
            return (
              <Link
                key={s.href}
                href={`${s.href}${q}`}
                className={clsx(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
                  active
                    ? "bg-brand-navy/5 font-medium text-heading"
                    : "text-muted hover:bg-brand-paper hover:text-ink",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {s.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
