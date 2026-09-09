import clsx from "clsx";
import { AlertTriangle, Users, Info } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { withDefaults, STATUTORY_POLICY } from "@/lib/hrpolicy";
import { workforceMix, diversityGap, mixVerdict, type WorkforcePerson } from "@/lib/workforce";

export const dynamic = "force-dynamic";

export default async function WorkforcePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("hr.workforce");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const company = accessible.find((c) => c.id === companyId);

  // Each company is its own MOHRE establishment with its own licence, so the
  // mix that matters is per company. A group percentage would be a number that
  // belongs to nobody, and somebody would plan hiring from it.
  const everyone = accessible.length
    ? await db.employee.findMany({
        where: { companyId: { in: accessible.map((c) => c.id) } },
        select: { id: true, companyId: true, nationality: true, employmentType: true, status: true, visaExpiry: true },
      })
    : [];

  const asPeople = (rows: typeof everyone): WorkforcePerson[] =>
    rows.map((e) => ({
      employeeId: e.id, nationality: e.nationality,
      employmentType: e.employmentType, status: e.status,
    }));

  const mine = everyone.filter((e) => e.companyId === companyId);
  const mix = workforceMix(asPeople(mine));

  const stored = companyId ? await db.hrPolicy.findUnique({ where: { companyId } }) : null;
  const policy = stored ? withDefaults(stored) : { ...STATUTORY_POLICY };
  const target = policy.maxNationalityShare;

  const gap = diversityGap(mix, target);
  const v = mixVerdict(mix, gap, target);
  const tone = {
    good: "border-brand-green/40 bg-brand-green/10 text-brand-green-700",
    watch: "border-brand-gold/40 bg-brand-gold/10 text-ink",
    bad: "border-red-300 bg-red-50 text-red-700",
  }[v.tone];

  // Visas of the largest nationality falling due: the least disruptive lever
  // there is, because not renewing moves the ratio without dismissing anybody.
  const in90 = new Date(Date.now() + 90 * 24 * 3600 * 1000);
  const expiringInLargest = mix.largest
    ? mine.filter(
        (e) =>
          e.status !== "Inactive" && e.employmentType !== "Supplied" &&
          (e.nationality ?? "").trim() === mix.largest!.nationality &&
          e.visaExpiry && e.visaExpiry <= in90,
      ).length
    : 0;

  // A one-line comparison across the group, so nobody has to click each company
  // to find the one that is over.
  const allCompanies = accessible.map((c) => {
    const m = workforceMix(asPeople(everyone.filter((e) => e.companyId === c.id)));
    return { code: c.code, name: c.name, id: c.id, mix: m };
  });

  return (
    <div>
      <div className="print-header mb-4 hidden border-b border-line pb-3 print:block">
        <div className="text-lg font-bold text-heading">Workforce mix — {company?.name ?? ""}</div>
        <div className="text-xs text-muted">Own employees only. Supplied labour excluded.</div>
      </div>

      <PageHeader
        title="HR — Workforce mix"
        subtitle="Nationality mix of your own employees, and what it would take to change it."
      />

      <HrTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <div className={clsx("mb-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", tone)}>
        {v.tone === "good" ? <Users className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
        <p className="font-medium">{v.text}</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label="Largest nationality"
          value={mix.largest ? `${mix.largest.share}%` : "—"}
          sub={mix.largest ? `${mix.largest.nationality} · ${mix.largest.count} ${mix.largest.count === 1 ? "person" : "people"}` : "none recorded"}
          accent={gap ? "red" : undefined}
        />
        <Tile label="Nationalities" value={String(mix.distinct)} sub={`across ${mix.headcount} own staff`} />
        <Tile label="Emirati" value={String(mix.emirati)} sub="counts for Nafis too" />
        <Tile
          label="Not recorded"
          value={String(mix.unrecorded)}
          sub={mix.unrecorded > 0 ? "the percentages are a range" : "every nationality is on file"}
          accent={mix.unrecorded > 0 ? "gold" : undefined}
        />
      </div>

      {gap && (
        <div className="card mb-5 overflow-hidden border-red-200">
          <div className="border-b border-line bg-red-50 px-5 py-3">
            <h2 className="font-semibold text-red-700">What would bring it under {gap.target}%</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <Lever value={String(gap.hire)} label={`more employees of other nationalities`} note="the number the next recruitment round has to find" />
            <Lever value={String(gap.reduce)} label={`fewer ${mix.largest?.nationality} nationals`} note="the same arithmetic, from the other direction" />
            <Lever
              value={String(expiringInLargest)}
              label={`${mix.largest?.nationality} visas expiring within 90 days`}
              note="not renewing moves the ratio without dismissing anybody"
            />
          </div>
        </div>
      )}

      <div className="card mb-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{company?.name ?? "This company"}</h2>
          <span className="text-xs text-muted">{mix.headcount} own employees</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Nationality</th>
                <th className="px-4 py-2.5 font-semibold">Share</th>
                <th className="px-4 py-2.5 text-right font-semibold">People</th>
                <th className="px-4 py-2.5 text-right font-semibold">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {mix.rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted">
                  No own employees on this company yet. Supplied labour is not counted here.
                </td></tr>
              )}
              {mix.rows.map((r) => {
                const over = !r.isUnrecorded && target > 0 && r.share > target;
                return (
                  <tr key={r.nationality} className={clsx(r.isUnrecorded && "bg-brand-gold/5")}>
                    <td className={clsx("px-4 py-2.5", r.isUnrecorded ? "text-muted" : "text-ink")}>{r.nationality}</td>
                    <td className="px-4 py-2.5">
                      <div className="h-2 w-full max-w-[16rem] overflow-hidden rounded-full bg-line">
                        <div
                          className={clsx("h-full rounded-full", over ? "bg-red-500" : r.isUnrecorded ? "bg-brand-gold" : "bg-brand-blue")}
                          style={{ width: `${Math.min(100, r.share)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-heading">{r.count}</td>
                    <td className={clsx("px-4 py-2.5 text-right tabular-nums", over ? "font-medium text-red-600" : "text-muted")}>{r.share}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {mix.unrecorded > 0 && mix.largest && (
          <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
            {mix.unrecorded} {mix.unrecorded === 1 ? "person has" : "people have"} no nationality on file, so{" "}
            {mix.largest.nationality} is between {mix.largest.share}% and {mix.largestWorstCase}%. Fill those in
            before quoting a figure to anybody.
          </p>
        )}
      </div>

      {allCompanies.length > 1 && (
        <div className="card mb-5 overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">Across the group</h2>
            <p className="mt-0.5 text-xs text-muted">
              Each company is its own establishment, so each is measured on its own. There is no group percentage.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-semibold">Company</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Own staff</th>
                  <th className="px-4 py-2.5 font-semibold">Largest nationality</th>
                  <th className="px-4 py-2.5 text-right font-semibold">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {allCompanies.map((c) => {
                  const over = c.mix.largest && target > 0 && c.mix.largest.share > target;
                  return (
                    <tr key={c.id} className={clsx(c.id === companyId && "bg-brand-paper/60")}>
                      <td className="px-4 py-2.5"><span className="font-medium text-ink">{c.code}</span> <span className="text-xs text-muted">{c.name}</span></td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-heading">{c.mix.headcount}</td>
                      <td className="px-4 py-2.5 text-ink">{c.mix.largest?.nationality ?? "—"}</td>
                      <td className={clsx("px-4 py-2.5 text-right tabular-nums", over ? "font-medium text-red-600" : "text-muted")}>
                        {c.mix.largest ? `${c.mix.largest.share}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card flex items-start gap-3 p-5">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <div className="text-sm text-muted">
          <p>
            <span className="font-medium text-ink">Own employees only.</span> Supplied labour is
            sponsored by the manpower supplier and sits on their establishment, not yours
            {mix.suppliedExcluded > 0 ? ` — ${mix.suppliedExcluded} ${mix.suppliedExcluded === 1 ? "worker is" : "workers are"} excluded here` : ""}.
            People who have left are excluded too.
          </p>
          <p className="mt-2">
            <span className="font-medium text-ink">The {target}% is yours, not ours.</span> MOHRE
            sets the diversity figure for establishment classification and revises it. This system
            does not assume what it is — the target is on HR Policy, and your PRO or typing centre is
            who to ask before changing it.
          </p>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "red" | "gold" }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={clsx(
        "mt-1 text-2xl font-bold tabular-nums",
        accent === "red" ? "text-red-600" : accent === "gold" ? "text-brand-gold" : "text-heading",
      )}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

function Lever({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="rounded-lg bg-brand-paper p-4">
      <div className="text-2xl font-bold tabular-nums text-heading">{value}</div>
      <div className="mt-0.5 text-sm text-ink">{label}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </div>
  );
}
