"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

export default function ConfirmDelete({
  action,
  label = "Delete this record?",
  compact = true,
}: {
  action: () => Promise<{ ok?: boolean; error?: string } | void>;
  label?: string;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function onClick() {
    if (!window.confirm(label)) return;
    setErr("");
    start(async () => {
      const res = await action();
      if (res && res.ok === false) setErr(res.error || "Could not delete");
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={onClick}
        disabled={pending}
        title="Delete"
        className={
          compact
            ? "grid h-8 w-8 place-items-center rounded text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            : "btn-ghost border border-line text-red-600 hover:border-red-200"
        }
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
