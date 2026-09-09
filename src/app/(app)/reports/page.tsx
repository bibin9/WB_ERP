import { LibraryBig } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ReportCentre from "@/components/ReportCentre";
import { getSession } from "@/lib/auth";
import { visibleScreens } from "@/lib/rbac";
import { visibleReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

/**
 * Every report, across every module.
 *
 * There is no permission on this page and there does not need to be one: it
 * lists only the reports whose own screens the visitor may already open, so it
 * can reveal nothing they could not reach by typing the address. A separate
 * grant would be one more thing to forget to give somebody, and the symptom
 * would be an empty page rather than an error.
 */
export default async function ReportsPage() {
  const session = await getSession();
  if (!session) return null;

  const allowed = visibleScreens(session);
  const mine = visibleReports(allowed);

  // Only offer a module chip if the person can actually see something in it.
  const MODULE_LABELS: Record<string, string> = { finance: "Finance", hr: "People" };
  const modules = Object.entries(MODULE_LABELS)
    .filter(([key]) => mine.some((r) => r.module === key))
    .map(([key, label]) => ({ key, label }));

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Everything the system can tell you, in one place. Search by what you want to know, not by what it is called."
      />

      {mine.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-lg bg-brand-blue/5 p-4 text-sm text-muted">
          <LibraryBig className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
          <p>
            Each card says what question the report answers. You are shown the{" "}
            <span className="font-medium text-ink">{mine.length}</span> report
            {mine.length === 1 ? "" : "s"} your role can open — there may be more that you cannot.
          </p>
        </div>
      )}

      <ReportCentre keys={mine.map((r) => r.key)} modules={modules} />
    </div>
  );
}
