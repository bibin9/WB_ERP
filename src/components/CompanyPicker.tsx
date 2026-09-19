"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * The company filter at the top of a screen.
 *
 * `allowAll` adds an "All companies" choice, for the group-wide screens
 * (People, Approvals, Overtime…) that show every company you belong to until
 * you pick one — see lib/company-scope.ts. Changing company goes back to the
 * first page, since page 7 of one company is not page 7 of another.
 */
export default function CompanyPicker({
  companies,
  current,
  allowAll = false,
  label = "Company books:",
}: {
  companies: { id: string; code: string; name: string }[];
  current: string;
  allowAll?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function change(id: string) {
    const q = new URLSearchParams(params.toString());
    if (id === "all") q.delete("c");
    else q.set("c", id);
    q.delete("p");
    const qs = q.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // A filter with one company in it has nothing to choose between.
  if (allowAll && companies.length < 2) return null;

  return (
    <div className="flex items-center gap-2 print:hidden">
      <span className="text-sm text-muted">{label}</span>
      <select value={current} onChange={(e) => change(e.target.value)} className="input h-9 w-auto py-1.5" aria-label="Company">
        {allowAll && <option value="all">All my companies</option>}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
        ))}
      </select>
    </div>
  );
}
