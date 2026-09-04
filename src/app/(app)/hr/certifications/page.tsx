import clsx from "clsx";
import { Star } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import GuardedDelete from "@/components/GuardedDelete";
import { CertForm, AppraisalForm } from "@/components/certifications/CertForms";
import { deleteCertification, deleteAppraisal } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";
const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function expiryState(d: Date | null): { label: string; cls: string } {
  if (!d) return { label: "No expiry", cls: "bg-line text-muted" };
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: "Expired", cls: "bg-red-50 text-red-600" };
  if (days <= 30) return { label: `Expires in ${days}d`, cls: "bg-brand-gold/15 text-brand-gold" };
  return { label: "Valid", cls: "bg-brand-green/10 text-brand-green-700" };
}
const catCls: Record<string, string> = {
  Competency: "bg-brand-navy/5 text-heading",
  Safety: "bg-brand-blue/10 text-brand-blue-600",
  Medical: "bg-red-50 text-red-600",
};

export default async function CertificationsPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAccess("hr.certifications");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const employees = companyId ? await db.employee.findMany({ where: { companyId, status: { not: "Inactive" } }, orderBy: { name: "asc" } }) : [];
  const empOpts = employees.map((e) => ({ id: e.id, label: `${e.empNo} — ${e.name}${e.employmentType === "Supplied" ? " (supplied)" : ""}` }));
  const certs = companyId
    ? await db.certification.findMany({ where: { companyId }, include: { employee: true }, orderBy: [{ expiryDate: "asc" }] })
    : [];
  const appraisals = companyId
    ? await db.appraisal.findMany({ where: { companyId }, include: { employee: true }, orderBy: { createdAt: "desc" }, take: 10 })
    : [];

  const expiringSoon = certs.filter((c) => c.expiryDate && expiryState(c.expiryDate).label !== "Valid").length;

  return (
    <div>
      <PageHeader title="HR & Admin — Certifications, Medical & Performance" subtitle="Competency & safety certifications, medical clearances (restricted) with expiry alerts, and appraisals." />
      <HrTabs />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      {expiringSoon > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-brand-gold/10 px-4 py-2 text-sm text-brand-gold">
          <span className="font-semibold">{expiringSoon}</span> certification(s) expired or expiring within 30 days.
        </div>
      )}

      {/* Certifications & medical */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Certifications & medical clearances</h2>
        <div className="mb-3"><CertForm employees={empOpts} /></div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Person</th><th className="px-4 py-2 font-semibold">Certificate / clearance</th>
              <th className="px-4 py-2 font-semibold">Category</th><th className="px-4 py-2 font-semibold">Expiry</th>
              <th className="px-4 py-2 font-semibold">Status</th><th className="px-4 py-2 text-right font-semibold"></th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {certs.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No certifications recorded yet.</td></tr>}
              {certs.map((c) => {
                const st = expiryState(c.expiryDate);
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-ink">{c.employee.name}</td>
                    <td className="px-4 py-2 text-ink">{c.name}</td>
                    <td className="px-4 py-2"><span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium", catCls[c.category])}>{c.category}</span></td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{fmt(c.expiryDate)}</td>
                    <td className="px-4 py-2"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span></td>
                    <td className="px-4 py-2 text-right"><GuardedDelete screen="hr.certifications" action={deleteCertification.bind(null, c.id)} label={`Delete "${c.name}"?`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Performance */}
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Performance appraisals</h2>
        <div className="mb-3"><AppraisalForm employees={empOpts} /></div>
        <div className="card divide-y divide-line">
          {appraisals.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No appraisals yet.</p>}
          {appraisals.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{a.employee.name} · {a.period}</div>
                {a.feedback && <div className="text-xs text-muted">{a.feedback}</div>}
                <div className="text-[11px] text-muted/70">by {a.reviewedBy}</div>
              </div>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((r) => (
                  <Star key={r} className={clsx("h-4 w-4", r <= a.rating ? "fill-brand-gold text-brand-gold" : "text-line")} />
                ))}
              </div>
              <GuardedDelete screen="hr.certifications" action={deleteAppraisal.bind(null, a.id)} label="Delete this appraisal?" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
