"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { createCustomField } from "@/app/(app)/settings/custom-fields/actions";

export default function CustomFieldAdmin() {
  const ref = useRef<HTMLFormElement>(null);
  const [type, setType] = useState("text");
  return (
    <form ref={ref} action={async (fd) => { await createCustomField(fd); ref.current?.reset(); setType("text"); }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-brand-paper p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Field label</label>
        <input name="label" className="input h-9 w-48 py-1.5 text-sm" placeholder="e.g. Shirt size" required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Type</label>
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} className="input h-9 py-1.5 text-sm">
          <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown</option>
        </select>
      </div>
      {type === "select" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Options (comma-separated)</label>
          <input name="options" className="input h-9 w-56 py-1.5 text-sm" placeholder="Small, Medium, Large" />
        </div>
      )}
      <button type="submit" className="btn-primary h-9 py-1.5"><Plus className="h-4 w-4" /> Add field</button>
    </form>
  );
}
