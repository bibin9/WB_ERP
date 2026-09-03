"use client";

import { useTransition } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { moveStep, removeStep } from "@/app/(app)/settings/approvals/actions";

export default function StepControls({ stepId, canUp, canDown }: { stepId: string; canUp: boolean; canDown: boolean }) {
  const [pending, start] = useTransition();
  return (
    <span className="ml-1 inline-flex items-center gap-0.5">
      <button
        disabled={!canUp || pending}
        onClick={() => start(() => moveStep(stepId, "up"))}
        className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-line disabled:opacity-30"
        title="Move earlier"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        disabled={!canDown || pending}
        onClick={() => start(() => moveStep(stepId, "down"))}
        className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-line disabled:opacity-30"
        title="Move later"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        disabled={pending}
        onClick={() => start(() => removeStep(stepId))}
        className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
        title="Remove step"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
