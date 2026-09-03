"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { uploadDocument } from "@/app/(app)/hr/employees/actions";

const CATEGORIES = ["Photo", "Emirates ID", "Passport", "Visa", "Labour Card", "Certificate", "Contract", "Other"];

export default function DocumentUpload({ employeeId }: { employeeId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      ref={ref}
      action={async (fd) => { setError(""); setBusy(true); const r = await uploadDocument(fd); setBusy(false); if (r?.ok) ref.current?.reset(); else setError(r?.error || "Upload failed"); }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line bg-brand-paper p-3"
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Document type</label>
        <select name="category" className="input h-9 py-1.5 text-sm" defaultValue="Emirates ID">
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">File (max 10MB)</label>
        <input type="file" name="file" required className="block w-64 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-brand-navy file:px-3 file:py-1.5 file:text-white" />
      </div>
      <button type="submit" disabled={busy} className="btn-primary h-9 py-1.5 disabled:opacity-60">
        <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
