"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function CompanyPicker({
  companies,
  current,
}: {
  companies: { id: string; code: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function change(id: string) {
    const q = new URLSearchParams(params.toString());
    q.set("c", id);
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">Company books:</span>
      <select value={current} onChange={(e) => change(e.target.value)} className="input h-9 w-auto py-1.5">
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
        ))}
      </select>
    </div>
  );
}
