"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteRoute } from "@/app/(app)/settings/approvals/actions";

export default function DeleteRouteButton({ routeId }: { routeId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => deleteRoute(routeId))}
      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-muted hover:border-red-200 hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" /> Delete
    </button>
  );
}
