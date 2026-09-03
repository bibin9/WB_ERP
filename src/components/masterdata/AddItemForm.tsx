"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import { addMasterItem } from "@/app/(app)/settings/master-data/actions";

export default function AddItemForm({ type }: { type: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={async (fd) => { await addMasterItem(fd); ref.current?.reset(); }} className="flex items-center gap-2 px-5 py-3">
      <input type="hidden" name="type" value={type} />
      <input name="value" className="input h-8 flex-1 py-1 text-sm" placeholder={`Add ${type.toLowerCase()}…`} required />
      <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-brand-navy px-2.5 py-1.5 text-xs font-medium text-white"><Plus className="h-3.5 w-3.5" /> Add</button>
    </form>
  );
}
