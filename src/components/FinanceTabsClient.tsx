"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LayoutGrid, BookOpen, ScrollText, FileBarChart, Receipt, RefreshCw } from "lucide-react";

const TABS = [
  { href: "/finance", label: "Overview", icon: LayoutGrid, screen: "finance.overview" },
  { href: "/finance/daybook", label: "Day Book", icon: BookOpen, screen: "finance.daybook" },
  { href: "/finance/ledgers", label: "Ledgers", icon: ScrollText, screen: "finance.ledgers" },
  { href: "/finance/reports", label: "Reports", icon: FileBarChart, screen: "finance.reports" },
  { href: "/finance/vat", label: "VAT", icon: Receipt, screen: "finance.vat" },
  { href: "/finance/tally", label: "Tally Sync", icon: RefreshCw, screen: "finance.tally" },
];

export default function FinanceTabsClient({ companyId, allowed }: { companyId: string; allowed: string[] }) {
  const pathname = usePathname();
  const q = companyId ? `?c=${companyId}` : "";
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
            href={`${t.href}${q}`}
            className={clsx(
              "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "border-brand-green text-heading" : "border-transparent text-muted hover:text-ink"
            )}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
