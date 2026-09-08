"use client";

import { useState } from "react";
import { setCorporateTaxTRN } from "@/app/(app)/finance/corporate-tax/actions";

/**
 * The corporate tax registration number.
 *
 * It is not the VAT TRN, and a company can hold one without the other. It goes
 * on the return, so it is captured beside the return rather than hidden in a
 * settings screen where nobody would think to look for it.
 */
export default function CorporateTaxTRN({
  companyId,
  value,
}: {
  companyId: string;
  value: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <span className="text-xs text-muted">
        Corporate Tax TRN:{" "}
        <span className="font-mono text-ink">{value || "not recorded"}</span>{" "}
        <button onClick={() => setEditing(true)} className="text-brand-blue-600 underline print:hidden">
          {value ? "change" : "add"}
        </button>
      </span>
    );
  }

  return (
    <form
      action={async (fd) => {
        setError("");
        setSaving(true);
        const res = await setCorporateTaxTRN(fd);
        setSaving(false);
        if (res?.ok) setEditing(false);
        else setError(res?.error || "Could not save");
      }}
      className="flex flex-wrap items-center gap-2 print:hidden"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <label className="text-xs text-muted">Corporate Tax TRN</label>
      <input
        name="corporateTaxTRN"
        defaultValue={value ?? ""}
        placeholder="15 digits"
        className="input h-8 w-48 py-1 font-mono text-xs"
      />
      <button type="submit" disabled={saving} className="btn-primary h-8 px-3 py-0 text-xs">
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="btn-ghost h-8 px-3 py-0 text-xs">
        Cancel
      </button>
      {error && <span className="text-xs text-brand-gold">{error}</span>}
    </form>
  );
}
