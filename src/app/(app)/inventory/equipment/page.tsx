import { Wrench, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import EquipmentForm from "@/components/inventory/EquipmentForm";
import CalibrationForm from "@/components/inventory/CalibrationForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { readSearch, matchAny } from "@/lib/search";
import { financePolicyFor } from "@/lib/accounts";
import {
  equipmentState, summariseCalibration, calibrationVerdict, rankEquipment,
  EQUIPMENT_STATUS_HELP, DEFAULT_WARNING_DAYS,
} from "@/lib/calibration";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Equipment and calibration (INV-12, INV-13, INV-17).
 *
 * Whether a tool can be used is worked out from its certificate every time this
 * page is drawn, never read from a stored flag. A flag somebody has to set when
 * a date passes is wrong on exactly the day it matters.
 */
export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; show?: string }>;
}) {
  await requireAccess("inventory.equipment");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const showAll = sp.show === "all";

  const rows = companyId
    ? await db.equipment.findMany({
        where: {
          companyId,
          ...(showAll ? {} : { isActive: true }),
          ...(matchAny(term, ["serialNo", "description", "category", "manufacturer", "model", "heldBy"]) ?? {}),
        },
        include: {
          calibrations: { orderBy: { calibratedOn: "desc" }, take: 1 },
          store: { select: { code: true } },
          job: { select: { code: true } },
        },
        orderBy: { serialNo: "asc" },
      })
    : [];

  // The same warning window the rest of the system uses for expiries.
  const policy = companyId ? await financePolicyFor(companyId) : null;
  const warningDays = policy?.expiryWarningDays || DEFAULT_WARNING_DAYS;

  const withLatest = rows.map((e) => ({ ...e, latest: e.calibrations[0] ?? null }));
  const totals = summariseCalibration(withLatest, new Date(), warningDays);
  const verdict = calibrationVerdict(withLatest, new Date(), warningDays);
  const ranked = rankEquipment(withLatest, new Date(), warningDays);

  const stores = companyId
    ? await db.store.findMany({ where: { companyId, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } })
    : [];
  const jobs = companyId
    ? await db.job.findMany({ where: { companyId, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } })
    : [];

  const card = "card p-5";

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Equipment & Calibration"
        subtitle={`as at ${fmt(new Date())}`}
      />

      <PageHeader
        title="Stores — Equipment & Calibration"
        subtitle="Every tool with a serial number, and whether its certificate is still good."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <EquipmentForm companyId={companyId} stores={stores} jobs={jobs} />}
        </div>
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <p className="mb-5 text-sm text-ink">{verdict}</p>

      {totals.expired > 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {totals.expired === 1 ? "One item is" : `${totals.expired} items are`} out of calibration.
          </span>{" "}
          They are blocked from use from today, with nobody having had to do anything. Anything measured with them
          since the certificate lapsed is worth checking, because a reading taken with an uncertified instrument is
          not a reading.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={card}>
          <div className="text-sm text-muted">Available</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-brand-green-700">{totals.available}</div>
          <div className="mt-0.5 text-xs text-muted">of {totals.equipment} on the register</div>
        </div>
        <div className={`${card} ${totals.expired > 0 ? "border-brand-gold/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {totals.expired > 0 && <AlertTriangle className="h-4 w-4 text-brand-gold" />}
            Out of calibration
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{totals.expired}</div>
          <div className="mt-0.5 text-xs text-muted">blocked from use</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Due within {warningDays} days</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{totals.expiringSoon}</div>
          <div className="mt-0.5 text-xs text-muted">still usable, book them in</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Away or never done</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">
            {totals.outForCalibration + totals.neverCalibrated}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {totals.outForCalibration} at the lab, {totals.neverCalibrated} never calibrated
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search serial, description, make or who has it" />
        <div className="flex items-center gap-2 text-sm">
          <a href={`/inventory/equipment?c=${companyId}`} className={!showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>In service</a>
          <span className="text-line">|</span>
          <a href={`/inventory/equipment?c=${companyId}&show=all`} className={showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>All</a>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Serial</th>
              <th className="px-4 py-2.5 font-medium">What it is</th>
              <th className="px-4 py-2.5 font-medium">Where</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Certificate to</th>
              <th className="px-4 py-2.5 font-medium">Can it be used</th>
              <th className="px-4 py-2.5 print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {rows.length === 0 && !term
                    ? "No equipment yet. Add the tools and instruments that carry a serial number."
                    : "Nothing matches."}
                </td>
              </tr>
            )}
            {ranked.map((e) => {
              const s = equipmentState(e, new Date(), warningDays);
              return (
                <tr key={e.id} className={s.expired ? "bg-brand-gold/5" : ""}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-heading">{e.serialNo}</td>
                  <td className="px-4 py-2.5 text-ink">
                    {e.description}
                    {(e.manufacturer || e.model) && (
                      <div className="text-xs text-muted">{[e.manufacturer, e.model].filter(Boolean).join(" ")}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                    {e.heldBy ? e.heldBy : e.job ? e.job.code : e.store ? e.store.code : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    <span title={EQUIPMENT_STATUS_HELP[e.status]} className="text-muted">{e.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    {!e.requiresCalibration ? (
                      <span className="text-muted/60" title="This one carries no certificate and needs none">not required</span>
                    ) : s.validTo ? (
                      <span className={s.expired ? "text-brand-gold" : s.expiringSoon ? "text-brand-gold" : "text-muted"}>
                        {fmt(s.validTo)}
                        {s.daysToExpiry !== null && (
                          <span className="block">
                            {s.daysToExpiry < 0
                              ? `${Math.abs(s.daysToExpiry)} days ago`
                              : `${s.daysToExpiry} days left`}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-brand-gold">never calibrated</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {s.available ? (
                      <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-brand-green-700">
                        {s.expiringSoon ? "yes, for now" : "yes"}
                      </span>
                    ) : (
                      <span className="text-brand-gold" title={s.reason}>{s.reason}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      {e.requiresCalibration && (
                        <CalibrationForm
                          equipmentId={e.id}
                          label={`${e.serialNo} — ${e.description}`}
                          months={e.calibrationMonths}
                        />
                      )}
                      <EquipmentForm
                        companyId={companyId}
                        stores={stores}
                        jobs={jobs}
                        row={{
                          id: e.id, serialNo: e.serialNo, description: e.description,
                          category: e.category, manufacturer: e.manufacturer, model: e.model,
                          status: e.status, requiresCalibration: e.requiresCalibration,
                          calibrationMonths: e.calibrationMonths, storeId: e.storeId,
                          jobId: e.jobId, heldBy: e.heldBy, notes: e.notes, isActive: e.isActive,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Whether a tool can be used is worked out from its certificate every time this page is drawn, never read
          from a stored flag. A flag somebody has to set when a date passes is wrong on exactly the day it matters,
          because nobody sets one on a Friday for a certificate that lapses on Saturday. Equipment away being
          calibrated, under repair or withdrawn is blocked too, whatever its paperwork says.
        </p>
      </div>
    </div>
  );
}
