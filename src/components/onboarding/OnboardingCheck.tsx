"use client";

import { useTransition } from "react";
import clsx from "clsx";
import { toggleOnboardingItem } from "@/app/(app)/hr/onboarding/actions";

export default function OnboardingCheck({ id, label, done }: { id: string; label: string; done: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className={clsx("flex items-center gap-2 text-sm", pending && "opacity-60")}>
      <input
        type="checkbox"
        checked={done}
        onChange={(e) => { const v = e.target.checked; start(() => toggleOnboardingItem(id, v)); }}
        className="h-4 w-4 accent-[color:rgb(var(--brand-green))]"
      />
      <span className={clsx(done ? "text-muted line-through" : "text-ink")}>{label}</span>
    </label>
  );
}
