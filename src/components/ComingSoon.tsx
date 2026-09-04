import { Lock } from "lucide-react";
import PageHeader from "./PageHeader";

export default function ComingSoon({
  title,
  phase,
  note,
}: {
  title: string;
  phase: number;
  note?: string;
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={note ?? "Scheduled for a later delivery phase."} />
      <div className="card grid place-items-center gap-3 px-6 py-16 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-navy/5 text-heading">
          <Lock className="h-6 w-6" />
        </span>
        <div className="text-lg font-semibold text-ink">Coming in Phase {phase}</div>
        <p className="max-w-md text-sm text-muted">
          This module is part of Phase {phase} of the rollout. The Phase 1 foundation
          (multi-company, Finance, HR &amp; Admin, approvals) is built first.
        </p>
        <span className="mt-1 rounded-full bg-brand-gold/15 px-3 py-1 text-xs font-semibold text-brand-gold">
          Phase {phase}
        </span>
      </div>
    </div>
  );
}
