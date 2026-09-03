"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createRoute } from "@/app/(app)/settings/approvals/actions";

export default function AddRouteForm() {
  const [value, setValue] = useState("");
  return (
    <form
      action={async (fd) => {
        await createRoute(fd);
        setValue("");
      }}
      className="flex items-center gap-2"
    >
      <input
        name="docType"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="input h-9 w-56 py-1.5"
        placeholder="New document type…"
        required
      />
      <button type="submit" className="btn-primary h-9 py-1.5">
        <Plus className="h-4 w-4" /> Add route
      </button>
    </form>
  );
}
