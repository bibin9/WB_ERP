import PageHeader from "@/components/PageHeader";
import RetentionRow from "@/components/settings/RetentionRow";
import { requireAccess } from "@/lib/guard";
import { canAdminister } from "@/lib/auth";
import { dueNow } from "@/lib/data-retention";

export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * How long each kind of record is kept — the answer an auditor asks for, and
 * the housekeeping that follows from it.
 *
 * Only logs appear here. Business records — invoices, journals, payroll,
 * attendance, stock movements — are never moved off the live tables, because
 * the reports read them years later; lib/retention.ts says so at length.
 */
export default async function RetentionPage() {
  const session = await requireAccess("settings.retention");
  const canEdit = await canAdminister();
  const rows = await dueNow(session.tenant.id);

  return (
    <div>
      <PageHeader
        title="Data Retention"
        subtitle="How long records are kept, and what happens to them afterwards."
      />

      <div className="card mb-5 border-l-4 border-l-brand-green p-5">
        <h2 className="font-semibold text-heading">What is not on this page</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Invoices, journal entries, payroll runs, attendance, settlements and stock movements are kept for
          as long as the system exists. They are never moved or removed by any setting here. A trial
          balance, a job cost report and an end-of-service calculation all read years of history, so moving
          those records would make the figures wrong — which costs far more than any screen is slowed by
          keeping them. What follows is the three logs that grow with every action and that nothing reports
          on.
        </p>
      </div>

      <div className="space-y-5">
        {rows.map((r) => (
          <RetentionRow
            key={r.policy.key}
            policy={r.policy}
            days={r.days}
            live={r.live}
            due={r.due}
            archived={r.archived}
            cutoff={DAY.format(r.cutoff)}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}
