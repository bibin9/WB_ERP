"use client";

import { useTransition } from "react";
import clsx from "clsx";

export default function ActiveToggle({
  isActive,
  action,
}: {
  isActive: boolean;
  action: (next: boolean) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => action(!isActive))}
      className={clsx(
        "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
        isActive ? "bg-brand-green/10 text-brand-green-700 hover:bg-brand-green/20" : "bg-line text-muted hover:bg-line/70"
      )}
      title="Click to toggle"
    >
      {isActive ? "Active" : "Inactive"}
    </button>
  );
}
